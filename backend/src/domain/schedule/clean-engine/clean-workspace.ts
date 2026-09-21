import type { ShiftMap } from "../../shift/types.js";
import { buildShiftMap } from "../../shift/default-shifts.js";
import { listParallelShiftCodes, listRequiredCoverageShiftCodes } from "../../shift/coverage-type.js";
import { canWork } from "../../rules/eligibility.js";
import { iterDays, addDays } from "../../rules/dates.js";
import { PAO_COVERAGE_SHIFTS } from "../../rules/constants.js";
import {
  DEFAULT_MOTOR_ROLE_CODES,
  isMotorPaoRole,
  type MotorRoleCodes,
} from "../../role/motor-codes.js";
import type {
  GeneratedAllocation,
  GeneratedAssignment,
  GenerationInput,
  GenerationInputEmployee,
} from "../generation-types.js";
import { normalizeOperationalLabel, isOperationalHardBlock, CROSS_MONTH_ND_LABEL } from "../operational-labels.js";
import { assignmentKey, type BlockedMap, type PlannedMap } from "../types.js";
import { MOTOR_VERSION_NEXT } from "../engine-metadata.js";
import { CleanAuditLog } from "./clean-audit.js";
import { motorRuleEnabled, motorShiftMaxConsecutivos, motorShiftMetaTurnos, motorShiftRuleEnabled } from "./clean-motor-rules.js";
import { motorShiftParamValue } from "../next-motor/next-motor-shift-params.js";
import {
  buildYearRateioExpectedContext,
  fairRateioExpectedForEmployee,
  fairRateioExpectedYearToDate,
  fairRateioTargetPerEmployee,
  yearRateioSaldo,
  MAX_MONTHLY_RATEIO_OVERSHOOT,
  type YearRateioMonthSnapshot,
} from "./clean-fair-rateio.js";
import {
  allowsIsolatedCoverageDay,
  employeePrefersShift,
  isBlockedOnlyByTurnSpacing,
  isT8PreferredPao,
  prefersRateioShift,
  primaryPreferredRateio,
  tryFillCoverageBlock,
} from "./clean-preferences.js";
import { isRateioTurnCode, type CleanEngineOptions } from "./clean-types.js";
import {
  applyInstructionShiftIfNeeded,
  baseShiftCode,
  isInInstructionOnDate,
  isInstructionShiftCode,
} from "../instruction-shift.js";
import {
  detectVacationFortnight,
  vacationDatesForEmployee,
  type VacationFortnight,
} from "./clean-vacation-fortnight.js";

function isProductiveAllocationLabel(label: string): boolean {
  const u = normalizeOperationalLabel(label).toUpperCase();
  if (u === "ND" || u === CROSS_MONTH_ND_LABEL.toUpperCase()) return true;
  if (u === "VOO" || u === "SIMULADOR" || u === "CMA" || u === "OUTRO") return true;
  if (u === "CURSO" || u === "CURSO ONLINE") return true;
  return false;
}
import type { CanWorkOptions } from "../../rules/eligibility.js";

export class CleanWorkspace {
  readonly input: GenerationInput;
  readonly shiftMap: ShiftMap;
  readonly days: string[];
  readonly paoEmployees: GenerationInputEmployee[];
  readonly options: CleanEngineOptions;
  readonly uuidToDomain: Map<string, number>;
  readonly domainToUuid: Map<number, string>;
  readonly roleByDomain: Map<number, string>;
  readonly motorRoleCodes: MotorRoleCodes;
  readonly coverageShiftCodes: string[];
  readonly allowedShiftCodes: Set<string>;
  readonly planned: PlannedMap = new Map();
  readonly blocked: BlockedMap = new Map();
  readonly historyPlanned: PlannedMap = new Map();
  readonly historyBlocked: BlockedMap = new Map();
  readonly allocations: GeneratedAllocation[] = [];
  readonly crossMonthPreAllocations: GeneratedAllocation[] = [];
  readonly audit = new CleanAuditLog();
  /** PAOs em férias quinzenais — metas e alocações só na quinzena livre. */
  readonly vacationFortnightByUuid = new Map<string, VacationFortnight>();
  readonly instructionByUuid = new Map<string, boolean>();
  /** Contador acumulado jan..(mês−1) — uuid → turnos rateio. */
  readonly yearRateioPriorByUuid = new Map<string, number>();
  /** N(m) por mês (histórico + mês corrente) para expected com quadro oscilante. */
  readonly yearRateioCountByMonth = new Map<number, number>();
  /** Meses do ano civil em que cada uuid entrou no pool de rateio. */
  readonly yearRateioActiveMonthsByUuid = new Map<string, Set<number>>();
  /**
   * Folga acima da meta mensal justa (0 na geração normal; 1..2 na EXTRA_COBERTURA).
   * Afeta teto de checkCanWork / fillCoverageGaps.
   */
  metaOvershootAllowance = 0;

  constructor(input: GenerationInput, options: CleanEngineOptions = {}) {
    this.input = input;
    this.options = options;
    this.shiftMap = buildShiftMap(input.shifts);
    this.days = iterDays(input.year, input.month);
    this.motorRoleCodes = input.motorRoleCodes ?? DEFAULT_MOTOR_ROLE_CODES;
    const allPaos = input.employees.filter((e) =>
      isMotorPaoRole(e.employee.role, this.motorRoleCodes),
    );
    const scope = options.scopeEmployeeUuids;
    this.paoEmployees =
      scope && scope.length > 0
        ? allPaos.filter((e) => scope.includes(e.uuid))
        : allPaos;
    this.uuidToDomain = new Map(input.employees.map((e) => [e.uuid, e.domainId]));
    this.domainToUuid = new Map(input.employees.map((e) => [e.domainId, e.uuid]));
    this.roleByDomain = new Map(
      input.employees.map((e) => [e.domainId, e.employee.role]),
    );
    this.coverageShiftCodes =
      options.coverageShiftCodes ?? this.resolveCoverageShiftCodes();
    const allowed =
      options.allowedShiftCodes ??
      (this.usesNextMotorRules() ? this.coverageShiftCodes : this.resolveCoverageShiftCodes());
    this.allowedShiftCodes = new Set(allowed.map((code) => code.toUpperCase()));
    // Flag bruto do cadastro — a checagem efetiva usa a janela de datas no dia.
    this.instructionByUuid = new Map(
      input.employees.map((e) => [e.uuid, Boolean(e.employee.inInstruction)]),
    );
    this.loadCrossMonthHistory();
    this.loadCrossMonthPreAllocationsFromInput();
    this.loadYearRateioPriorCounts();
    this.loadYearRateioExpectedContext();
    this.indexVacationFortnights();
  }

  private loadYearRateioPriorCounts(): void {
    const src = this.input.yearRateioPriorCounts;
    if (!src) return;
    for (const [uuid, count] of src) {
      if (typeof count === "number" && Number.isFinite(count) && count > 0) {
        this.yearRateioPriorByUuid.set(uuid, Math.floor(count));
      }
    }
  }

  /**
   * Monta N(m) oscilante + meses ativos por pessoa.
   * Meta do mês corrente sempre usa paoEmployees.length (pode ser ≠12).
   */
  private loadYearRateioExpectedContext(): void {
    const priorMonths: YearRateioMonthSnapshot[] = (this.input.yearRateioPriorMonths ?? []).map(
      (m) => ({
        month: m.month,
        employeeCount: m.employeeCount,
        employeeUuids: m.employeeUuids,
      }),
    );
    const ctx = buildYearRateioExpectedContext({
      year: this.input.year,
      currentMonth: this.input.month,
      currentEmployeeCount: this.paoEmployees.length,
      currentEmployeeUuids: this.paoEmployees.map((e) => e.uuid),
      priorMonths,
    });
    for (const [month, n] of ctx.employeeCountByMonth) {
      this.yearRateioCountByMonth.set(month, n);
    }
    for (const [uuid, months] of ctx.activeMonthsByUuid) {
      this.yearRateioActiveMonthsByUuid.set(uuid, months);
    }
  }

  private indexVacationFortnights(): void {
    for (const emp of this.input.employees) {
      const dates = vacationDatesForEmployee(this.input.vacationDays, emp.uuid);
      const fortnight = detectVacationFortnight(this.days, dates);
      if (fortnight) this.vacationFortnightByUuid.set(emp.uuid, fortnight);
    }
  }

  hasHalfMonthVacation(uuid: string): boolean {
    return this.vacationFortnightByUuid.has(uuid);
  }

  isEmployeeVacationDay(uuid: string, date: string): boolean {
    const did = this.uuidToDomain.get(uuid);
    if (did == null) return false;
    const label = this.getBlockLabel(did, date);
    return normalizeOperationalLabel(label ?? "").toUpperCase() === "FÉRIAS";
  }

  private loadCrossMonthPreAllocationsFromInput(): void {
    const lastDay = this.days[this.days.length - 1];
    if (!lastDay) return;
    const nextMonthStart = addDays(lastDay, 1);
    for (const lock of this.input.lockedAllocations) {
      if (lock.date < nextMonthStart) continue;
      const label = normalizeOperationalLabel(lock.label);
      const upper = label.toUpperCase();
      // T6/T7/T8 spillover de cobertura + ND CONTINUIDADE / FOLGA 6x1.
      if (isRateioTurnCode(upper) || upper === CROSS_MONTH_ND_LABEL.toUpperCase() || upper === "FOLGA") {
        this.crossMonthPreAllocations.push({
          employeeUuid: lock.employeeUuid,
          date: lock.date,
          label,
          startTime: lock.startTime,
          endTime: lock.endTime,
        });
      }
    }
  }

  addCrossMonthPreAllocations(rows: GeneratedAllocation[]): void {
    for (const row of rows) {
      const label = normalizeOperationalLabel(row.label).toUpperCase();
      const exists = this.crossMonthPreAllocations.some(
        (existing) =>
          existing.employeeUuid === row.employeeUuid &&
          existing.date === row.date &&
          normalizeOperationalLabel(existing.label).toUpperCase() === label,
      );
      if (!exists) this.crossMonthPreAllocations.push(row);
    }
  }

  getCrossMonthShiftOnDay(domainId: number, date: string): string | undefined {
    const uuid = this.domainToUuid.get(domainId);
    if (!uuid) return undefined;
    for (const row of this.crossMonthPreAllocations) {
      if (row.employeeUuid !== uuid || row.date !== date) continue;
      if (isRateioTurnCode(row.label)) return baseShiftCode(row.label);
    }
    return undefined;
  }

  getCrossMonthBlockLabel(domainId: number, date: string): string | undefined {
    const uuid = this.domainToUuid.get(domainId);
    if (!uuid) return undefined;
    for (const row of this.crossMonthPreAllocations) {
      if (row.employeeUuid !== uuid || row.date !== date) continue;
      const upper = row.label.toUpperCase();
      if (isRateioTurnCode(upper)) return undefined;
      return row.label;
    }
    return undefined;
  }

  /** Outro PAO já tem este turno rateio pré-alocado no mês seguinte. */
  otherPaoHasCrossMonthShift(date: string, shiftCode: string, excludeUuid: string): boolean {
    const normalized = baseShiftCode(shiftCode);
    for (const row of this.crossMonthPreAllocations) {
      if (row.date !== date || row.employeeUuid === excludeUuid) continue;
      if (baseShiftCode(row.label) !== normalized) continue;
      if (this.paoEmployees.some((p) => p.uuid === row.employeeUuid)) return true;
    }
    return false;
  }

  /** Dia do mês seguinte livre para spillover de cobertura (sem turno/bloqueio fixo). */
  isNextMonthDayFreeForCoverage(uuid: string, date: string): boolean {
    const did = this.uuidToDomain.get(uuid);
    if (did == null) return false;
    if (this.getCrossMonthShiftOnDay(did, date)) return false;
    if (this.getCrossMonthBlockLabel(did, date)) return false;
    return true;
  }

  isShiftAllowedForGeneration(shiftCode: string): boolean {
    if (!this.usesNextMotorRules()) return true;
    if (!isRateioTurnCode(shiftCode)) return true;
    const upper = shiftCode.toUpperCase();
    if (this.allowedShiftCodes.has(upper)) return true;
    // TI8 conta como T8 para elegibilidade do motor (cobertura usa baseShiftCode).
    const base = baseShiftCode(upper);
    return base !== upper && this.allowedShiftCodes.has(base);
  }

  private resolveCoverageShiftCodes(): string[] {
    const required = listRequiredCoverageShiftCodes(this.input.shifts);
    const fromCadastro = required.filter((code) =>
      (PAO_COVERAGE_SHIFTS as readonly string[]).includes(code.toUpperCase()),
    );
    if (fromCadastro.length > 0) return fromCadastro;
    return [...PAO_COVERAGE_SHIFTS];
  }

  private loadCrossMonthHistory(): void {
    const hist = this.input.crossMonthHistory;
    if (!hist) return;
    for (const a of hist.assignments ?? []) {
      const did = this.uuidToDomain.get(a.employeeUuid);
      if (did == null) continue;
      this.historyPlanned.set(assignmentKey(did, a.date), a.shiftCode);
    }
    for (const al of hist.allocations ?? []) {
      const did = this.uuidToDomain.get(al.employeeUuid);
      if (did == null) continue;
      this.historyBlocked.set(assignmentKey(did, al.date), al.label);
    }
  }

  usesNextMotorRules(): boolean {
    return this.options.motorVersion === MOTOR_VERSION_NEXT;
  }

  private canWorkOpts() {
    const opts: Parameters<typeof canWork>[5] = {
      shiftMap: this.shiftMap,
      roleByEmployeeId: this.roleByDomain,
      shiftRestrictions: this.input.shiftRestrictions,
      preferredShifts: this.input.preferredShifts,
      parallelShiftCodes: new Set(listParallelShiftCodes(this.input.shifts)),
    };

    if (!this.usesNextMotorRules()) return opts;

    // maxConsecutiveWork é por turno (T6=5, T8=3…) — definido em checkCanWork.
    // NÃO usar Math.min entre turnos: isso forçava T6/T7 ao teto do T8 (=3)
    // e impedia blocos do agrupamento (ex.: 5 dias).

    opts.continuityBlocked = this.mergedBlockedForContinuity();

    return opts;
  }

  mergedPlannedSnapshot(): PlannedMap {
    const merged = this.mergedPlanned();
    for (const row of this.crossMonthPreAllocations) {
      const did = this.uuidToDomain.get(row.employeeUuid);
      if (did == null) continue;
      if (isRateioTurnCode(row.label)) {
        merged.set(assignmentKey(did, row.date), baseShiftCode(row.label));
      }
    }
    return merged;
  }

  getShiftOnDay(domainId: number, date: string): string | undefined {
    const key = assignmentKey(domainId, date);
    return this.planned.get(key) ?? this.historyPlanned.get(key);
  }

  getBlockLabel(domainId: number, date: string): string | undefined {
    const key = assignmentKey(domainId, date);
    return this.blocked.get(key) ?? this.historyBlocked.get(key);
  }

  checkCanWork(
    uuid: string,
    date: string,
    shiftCode: string,
    plannedOverride?: PlannedMap,
    overrides?: Partial<CanWorkOptions>,
  ): { ok: boolean; reason: string } {
    const emp = this.input.employees.find((e) => e.uuid === uuid);
    if (!emp) return { ok: false, reason: "funcionário não encontrado" };
    const employee = { ...emp.employee, id: emp.domainId };
    const opts: CanWorkOptions = { ...this.canWorkOpts(), ...overrides };
    const normalized = shiftCode.toUpperCase();
    if (
      this.usesNextMotorRules() &&
      motorRuleEnabled(this.options, "max_6_consecutive") &&
      opts.maxConsecutiveWork == null
    ) {
      opts.maxConsecutiveWork = motorShiftMaxConsecutivos(this.options, normalized, 6);
    }
    if (
      this.usesNextMotorRules() &&
      !opts.fcfPriorityBypass &&
      isRateioTurnCode(normalized)
    ) {
      if (
        motorRuleEnabled(this.options, "pao_meta_turnos") &&
        this.wouldExceedTotalMetaTurnos(uuid, 1)
      ) {
        const limit = this.effectiveTotalMetaForEmployee(uuid);
        return {
          ok: false,
          reason: `limite mensal de ${limit} turnos rateio (meta PAO)`,
        };
      }
      if (
        motorShiftRuleEnabled(this.options, "pao_meta_turnos", normalized) &&
        this.countRateioTurnsForShift(uuid, normalized) >=
          this.effectiveMetaTurnosForShift(uuid, normalized)
      ) {
        return {
          ok: false,
          reason: `meta de ${this.effectiveMetaTurnosForShift(uuid, normalized)} turno(s) ${normalized} atingida`,
        };
      }
      if (
        motorRuleEnabled(this.options, "pao_meta_dias_trabalhados") &&
        this.wouldExceedDiasTrabalhados(uuid, 1)
      ) {
        const limit = this.effectiveDiasTrabalhadosForEmployee(uuid);
        return {
          ok: false,
          reason: `limite mensal de ${limit} dias trabalhados (meta PAO)`,
        };
      }
    }
    return canWork(
      employee,
      date,
      shiftCode,
      this.mergedBlocked(),
      plannedOverride ?? this.mergedPlanned(),
      opts,
    );
  }

  effectiveMetaTurnosForShift(uuid: string, shiftCode: string): number {
    if (!this.usesNextMotorRules()) return Number.POSITIVE_INFINITY;
    if (!motorShiftRuleEnabled(this.options, "pao_meta_turnos", shiftCode)) {
      return Number.POSITIVE_INFINITY;
    }
    const base = motorShiftMetaTurnos(this.options, shiftCode, 20);
    if (this.hasHalfMonthVacation(uuid)) return Math.ceil(base / 2);
    return base;
  }

  /**
   * Teto mensal de turnos rateio do PAO.
   * Base: floor(demanda / nº de PAOs). Na fase EXTRA, soma metaOvershootAllowance (até +2).
   */
  effectiveTotalMetaForEmployee(uuid: string): number {
    if (!this.usesNextMotorRules()) return Number.POSITIVE_INFINITY;
    if (!motorRuleEnabled(this.options, "pao_meta_turnos")) return Number.POSITIVE_INFINITY;

    const did = this.uuidToDomain.get(uuid);
    if (did == null) return Number.POSITIVE_INFINITY;

    const fair = fairRateioTargetPerEmployee(
      this.days.length,
      this.coverageShiftCodes,
      this.paoEmployees.length,
    );
    const overshoot = Math.max(
      0,
      Math.min(MAX_MONTHLY_RATEIO_OVERSHOOT, Math.floor(this.metaOvershootAllowance)),
    );
    const base = fair + overshoot;
    if (this.hasHalfMonthVacation(uuid)) return Math.ceil(base / 2);
    return base;
  }

  /** Meta justa do mês sem overshoot (para auditoria / UI). */
  fairMonthlyMetaTurnos(): number {
    return fairRateioTargetPerEmployee(
      this.days.length,
      this.coverageShiftCodes,
      this.paoEmployees.length,
    );
  }

  priorYearRateioTurns(uuid: string): number {
    return this.yearRateioPriorByUuid.get(uuid) ?? 0;
  }

  /** Acumulado no ano = jan..(mês−1) + turnos já alocados neste mês. */
  accumulatedYearRateioTurns(uuid: string): number {
    return this.priorYearRateioTurns(uuid) + this.countRateioTurns(uuid);
  }

  /** Esperado YTD (jan..mês corrente) com N(m) oscilante e janela ativa da pessoa. */
  expectedYearRateioToDate(uuid?: string): number {
    if (uuid) {
      const active =
        this.yearRateioActiveMonthsByUuid.get(uuid) ??
        new Set<number>(this.paoEmployees.some((e) => e.uuid === uuid) ? [this.input.month] : []);
      return fairRateioExpectedForEmployee(
        this.input.year,
        this.input.month,
        this.coverageShiftCodes,
        this.yearRateioCountByMonth,
        active,
      );
    }
    return fairRateioExpectedYearToDate(
      this.input.year,
      this.input.month,
      this.coverageShiftCodes,
      this.yearRateioCountByMonth,
    );
  }

  /** Saldo do contador: mais negativo = prioridade para extras. */
  yearRateioSaldo(uuid: string): number {
    return yearRateioSaldo(
      this.priorYearRateioTurns(uuid),
      this.countRateioTurns(uuid),
      this.expectedYearRateioToDate(uuid),
    );
  }

  /** Alinhado ao `resolveEmployeeTurnoMeta` / scope-projection-summary. */
  wouldExceedTotalMetaTurnos(uuid: string, extraTurnos = 1): boolean {
    if (!this.usesNextMotorRules()) return false;
    if (!motorRuleEnabled(this.options, "pao_meta_turnos")) return false;
    const limit = this.effectiveTotalMetaForEmployee(uuid);
    if (!Number.isFinite(limit)) return false;
    return this.countRateioTurns(uuid) + extraTurnos > limit;
  }

  hasTotalMetaHeadroom(uuid: string, extraTurnos = 1): boolean {
    return !this.wouldExceedTotalMetaTurnos(uuid, extraTurnos);
  }

  isAtOrAboveTotalMetaTurnos(uuid: string): boolean {
    if (!this.usesNextMotorRules()) return false;
    if (!motorRuleEnabled(this.options, "pao_meta_turnos")) return false;
    const limit = this.effectiveTotalMetaForEmployee(uuid);
    if (!Number.isFinite(limit)) return false;
    return this.countRateioTurns(uuid) >= limit;
  }

  /** Quanto falta para a meta mensal de turnos (0 = no teto ou já cheio). */
  metaTurnosDeficit(uuid: string): number {
    if (!this.usesNextMotorRules()) return Number.POSITIVE_INFINITY;
    if (!motorRuleEnabled(this.options, "pao_meta_turnos")) return Number.POSITIVE_INFINITY;
    const limit = this.effectiveTotalMetaForEmployee(uuid);
    if (!Number.isFinite(limit)) return Number.POSITIVE_INFINITY;
    return Math.max(0, limit - this.countRateioTurns(uuid));
  }

  /** Bloco T8/T8/ND novo consome até 2 turnos + 1 dia produtivo (ND). */
  hasCapacityForNewT8Block(uuid: string): boolean {
    return this.hasTotalMetaHeadroom(uuid, 2) && this.hasDiasTrabalhadosHeadroom(uuid, 3);
  }

  /** Preferência: maior déficit de meta primeiro; cobertura residual: mais novo primeiro. */
  sortEmployeesForPreferredFill(employees: GenerationInputEmployee[]): GenerationInputEmployee[] {
    return [...employees].sort((a, b) => {
      const deficitCmp = this.metaTurnosDeficit(b.uuid) - this.metaTurnosDeficit(a.uuid);
      if (deficitCmp !== 0) return deficitCmp;
      return (
        a.employee.seniority - b.employee.seniority ||
        a.employee.name.localeCompare(b.employee.name)
      );
    });
  }

  /** Meta de dias produtivos (turnos + ND + voo + simulador + curso + CMA + outros). */
  effectiveDiasTrabalhadosForEmployee(uuid: string): number {
    if (!this.usesNextMotorRules()) return Number.POSITIVE_INFINITY;
    if (!motorRuleEnabled(this.options, "pao_meta_dias_trabalhados")) {
      return Number.POSITIVE_INFINITY;
    }

    const did = this.uuidToDomain.get(uuid);
    if (did == null) return Number.POSITIVE_INFINITY;

    const preferred = primaryPreferredRateio(this, did);
    if (!preferred) return Number.POSITIVE_INFINITY;

    const base = motorShiftParamValue(this.options.motorParams, preferred, "meta_dias_trabalhados");
    if (this.hasHalfMonthVacation(uuid)) return Math.ceil(base / 2);
    return base;
  }

  /** Contagem alinhada ao resumo operacional / scope-projection-summary. */
  countProductiveWorkDays(uuid: string): number {
    const did = this.uuidToDomain.get(uuid);
    if (did == null) return 0;

    let n = 0;
    for (const day of this.days) {
      const key = assignmentKey(did, day);
      if (this.planned.has(key) || this.historyPlanned.has(key)) {
        n++;
        continue;
      }
      const block = this.getBlockLabel(did, day);
      if (block && isProductiveAllocationLabel(block)) {
        n++;
        continue;
      }
      const hasProductiveAlloc = this.allocations.some(
        (a) =>
          a.employeeUuid === uuid &&
          a.date === day &&
          isProductiveAllocationLabel(a.label),
      );
      if (hasProductiveAlloc) n++;
    }
    return n;
  }

  wouldExceedDiasTrabalhados(uuid: string, extraDays = 1): boolean {
    if (!this.usesNextMotorRules()) return false;
    if (!motorRuleEnabled(this.options, "pao_meta_dias_trabalhados")) return false;
    const limit = this.effectiveDiasTrabalhadosForEmployee(uuid);
    if (!Number.isFinite(limit)) return false;
    return this.countProductiveWorkDays(uuid) + extraDays > limit;
  }

  hasDiasTrabalhadosHeadroom(uuid: string, extraDays = 1): boolean {
    return !this.wouldExceedDiasTrabalhados(uuid, extraDays);
  }

  /** Verifica teto de turnos rateio e dias produtivos antes de blocos T8/T8/ND. */
  wouldExceedPaoCapacity(uuid: string, extraTurnos: number, extraProductiveDays: number): boolean {
    if (extraTurnos > 0 && this.wouldExceedTotalMetaTurnos(uuid, extraTurnos)) return true;
    if (extraProductiveDays > 0 && this.wouldExceedDiasTrabalhados(uuid, extraProductiveDays)) {
      return true;
    }
    return false;
  }

  unassignPlannedDay(domainId: number, date: string): void {
    this.planned.delete(assignmentKey(domainId, date));
  }

  /** Remove pré-alocações geradas para o dia (mantém blocked/planned em sync). */
  removeAllocationForDay(employeeUuid: string, date: string): void {
    for (let i = this.allocations.length - 1; i >= 0; i -= 1) {
      const row = this.allocations[i];
      if (row?.employeeUuid === employeeUuid && row.date === date) {
        this.allocations.splice(i, 1);
      }
    }
  }

  clearBlock(domainId: number, date: string): void {
    const uuid = this.domainToUuid.get(domainId);
    this.blocked.delete(assignmentKey(domainId, date));
    if (uuid) this.removeAllocationForDay(uuid, date);
  }

  setBlockDay(uuid: string, date: string, label: string): void {
    const did = this.uuidToDomain.get(uuid);
    if (did == null) return;
    const key = assignmentKey(did, date);
    this.blocked.set(key, label);
    this.removeAllocationForDay(uuid, date);
    this.allocations.push({ employeeUuid: uuid, date, label });
  }

  isLockedRateioDay(employeeUuid: string, date: string): boolean {
    return this.input.lockedAllocations.some(
      (lock) =>
        lock.employeeUuid === employeeUuid &&
        lock.date === date &&
        isRateioTurnCode(normalizeOperationalLabel(lock.label)),
    );
  }

  /** Qualquer pré-alocação travada no dia (turno, ND, FOLGA, etc.). */
  isLockedAllocationDay(employeeUuid: string, date: string): boolean {
    return this.input.lockedAllocations.some(
      (lock) => lock.employeeUuid === employeeUuid && lock.date === date,
    );
  }

  private mergedPlanned(): PlannedMap {
    const merged = new Map(this.historyPlanned);
    for (const [key, code] of this.planned) merged.set(key, code);
    return merged;
  }

  mergedPlannedForContinuity(): PlannedMap {
    return this.mergedPlanned();
  }

  mergedBlockedForContinuity(): BlockedMap {
    const merged = new Map(this.historyBlocked);
    for (const [key, label] of this.blocked) merged.set(key, label);
    return merged;
  }

  private mergedBlocked(): BlockedMap {
    const merged = new Map(this.historyBlocked);
    for (const [key, label] of this.blocked) merged.set(key, label);
    return merged;
  }

  applyCalendarBlocks(): void {
    const phase = "CALENDAR";
    for (const v of this.input.vacationDays) {
      this.blockDay(v.employeeUuid, v.date, "FÉRIAS", phase, "APPLY_VACATION");
    }
    for (const o of this.input.approvedDayOff) {
      this.blockDay(o.employeeUuid, o.date, "FOLGA PEDIDA", phase, "APPLY_DAY_OFF");
    }
    for (const f of this.input.flightDays) {
      this.blockDay(f.employeeUuid, f.date, "VOO", phase, "APPLY_FLIGHT");
    }
  }

  applyLockedPreAllocations(): void {
    const phase = "LOCKED";
    for (const lock of this.input.lockedAllocations) {
      const label = normalizeOperationalLabel(lock.label);
      const upper = label.toUpperCase();
      const emp = this.input.employees.find((e) => e.uuid === lock.employeeUuid);
      if (!emp) {
        this.audit.record("APPLY_LOCKED", phase, `funcionário ${lock.employeeUuid} não encontrado`, {
          date: lock.date,
        });
        continue;
      }
      if (isRateioTurnCode(upper)) {
        this.assignShift(lock.employeeUuid, lock.date, upper, phase, "pré-alocação admin");
        continue;
      }
      this.blockDay(lock.employeeUuid, lock.date, label, phase, "APPLY_LOCKED");
      if (lock.startTime && lock.endTime) {
        this.allocations.push({
          employeeUuid: lock.employeeUuid,
          date: lock.date,
          label,
          startTime: lock.startTime,
          endTime: lock.endTime,
        });
      } else {
        this.allocations.push({
          employeeUuid: lock.employeeUuid,
          date: lock.date,
          label,
        });
      }
    }
  }

  private blockDay(
    employeeUuid: string,
    date: string,
    label: string,
    phase: string,
    kind: "APPLY_LOCKED" | "APPLY_VACATION" | "APPLY_DAY_OFF" | "APPLY_FLIGHT",
  ): void {
    const did = this.uuidToDomain.get(employeeUuid);
    if (did == null) return;
    this.blocked.set(assignmentKey(did, date), label);
    const emp = this.input.employees.find((e) => e.uuid === employeeUuid);
    this.audit.record(kind, phase, `bloqueio ${label}`, {
      date,
      employeeUuid,
      employeeName: emp?.employee.name,
    });
  }

  isEmployeeInInstruction(employeeUuid: string, date?: string): boolean {
    const emp = this.input.employees.find((e) => e.uuid === employeeUuid);
    if (!emp) return this.instructionByUuid.get(employeeUuid) ?? false;
    if (date) return isInInstructionOnDate(emp.employee, date);
    return this.instructionByUuid.get(employeeUuid) ?? false;
  }

  assignShift(
    employeeUuid: string,
    date: string,
    shiftCode: string,
    phase: string,
    reason: string,
  ): boolean {
    const emp = this.input.employees.find((e) => e.uuid === employeeUuid);
    if (!emp) return false;
    let normalized = shiftCode.toUpperCase();
    normalized = applyInstructionShiftIfNeeded(
      normalized,
      this.isEmployeeInInstruction(employeeUuid, date),
    );
    if (isRateioTurnCode(normalized) && !this.isShiftAllowedForGeneration(normalized)) {
      this.audit.record("COVERAGE_FAILED", phase, `turno ${normalized} desabilitado na configuração do motor`, {
        date,
        shiftCode: normalized,
        employeeUuid,
        employeeName: emp.employee.name,
      });
      return false;
    }
    const key = assignmentKey(emp.domainId, date);
    if (this.planned.has(key)) {
      this.audit.record("COVERAGE_FAILED", phase, "dia já ocupado", {
        date,
        shiftCode: normalized,
        employeeUuid,
        employeeName: emp.employee.name,
      });
      return false;
    }
    this.planned.set(key, normalized);
    this.audit.record("COVERAGE_ASSIGNED", phase, reason, {
      date,
      shiftCode: normalized,
      employeeUuid,
      employeeName: emp.employee.name,
    });
    return true;
  }

  tryAssign(employeeUuid: string, date: string, shiftCode: string, phase: string): boolean {
    return this.tryAssignWithReason(employeeUuid, date, shiftCode, phase).assigned;
  }

  tryAssignWithReason(
    employeeUuid: string,
    date: string,
    shiftCode: string,
    phase: string,
  ): { assigned: boolean; reason?: string } {
    const emp = this.input.employees.find((e) => e.uuid === employeeUuid);
    if (!emp) return { assigned: false, reason: "funcionário não encontrado" };
    if (!this.isShiftAllowedForGeneration(shiftCode)) {
      return { assigned: false, reason: `turno ${shiftCode.toUpperCase()} desabilitado na configuração do motor` };
    }
    const check = this.checkCanWork(employeeUuid, date, shiftCode);
    if (!check.ok) {
      this.audit.record("COVERAGE_ATTEMPT", phase, check.reason, {
        date,
        shiftCode,
        employeeUuid,
        employeeName: emp.employee.name,
      });
      return { assigned: false, reason: check.reason };
    }
    const assigned = this.assignShift(employeeUuid, date, shiftCode, phase, "elegível");
    return { assigned, reason: assigned ? undefined : "dia já ocupado" };
  }

  /** FCF prioritário: T9 (ou turno configurado) no dia da semana, ignora meta e preferência T9. */
  tryAssignFcfPriority(
    employeeUuid: string,
    date: string,
    shiftCode: string,
    phase: string,
  ): { assigned: boolean; reason?: string; skippedVacation?: boolean } {
    if (this.isEmployeeVacationDay(employeeUuid, date)) {
      return { assigned: false, skippedVacation: true, reason: "férias" };
    }
    const emp = this.input.employees.find((e) => e.uuid === employeeUuid);
    if (!emp) return { assigned: false, reason: "funcionário não encontrado" };
    if (!this.isShiftAllowedForGeneration(shiftCode)) {
      return {
        assigned: false,
        reason: `turno ${shiftCode.toUpperCase()} desabilitado na configuração do motor`,
      };
    }
    const key = assignmentKey(emp.domainId, date);
    if (this.planned.has(key)) {
      return { assigned: false, reason: "dia já ocupado" };
    }
    const check = this.checkCanWork(employeeUuid, date, shiftCode, undefined, {
      fcfPriorityBypass: true,
    });
    if (!check.ok) {
      return { assigned: false, reason: check.reason };
    }
    const assigned = this.assignShift(employeeUuid, date, shiftCode, phase, "FCF prioritário");
    return { assigned, reason: assigned ? undefined : "dia já ocupado" };
  }

  hasPaoCoverage(date: string, shiftCode: string): boolean {
    const normalized = shiftCode.toUpperCase();
    for (const [key, code] of this.planned) {
      const [didStr, day] = key.split("|");
      if (day !== date) continue;
      if (isInstructionShiftCode(code)) continue;
      if (baseShiftCode(code) !== normalized) continue;
      const role = this.roleByDomain.get(Number(didStr));
      if (role && isMotorPaoRole(role, this.motorRoleCodes)) return true;
    }
    return false;
  }

  /** Outro PAO já ocupa este turno rateio neste dia (evita T8 duplicado na cobertura). */
  isPaoRateioShiftTakenByOther(employeeUuid: string, date: string, shiftCode: string): boolean {
    const did = this.uuidToDomain.get(employeeUuid);
    if (did == null) return this.hasPaoCoverage(date, shiftCode);
    const normalized = shiftCode.toUpperCase();
    for (const [key, code] of this.planned) {
      const [didStr, day] = key.split("|");
      if (day !== date) continue;
      if (isInstructionShiftCode(code)) continue;
      if (baseShiftCode(code) !== normalized) continue;
      if (Number(didStr) === did) continue;
      const role = this.roleByDomain.get(Number(didStr));
      if (role && isMotorPaoRole(role, this.motorRoleCodes)) return true;
    }
    return false;
  }

  /** Cobertura: déficit de meta (puxar quem está abaixo) → mais novo primeiro no residual.
   * Na EXTRA (+overshoot): saldo do contador anual primeiro (mais negativo = prioridade). */
  sortCoverageCandidatesForShift(
    shiftCode: string,
    employees: GenerationInputEmployee[] = this.paoEmployees,
  ): GenerationInputEmployee[] {
    const normalized = shiftCode.toUpperCase();
    const usePref =
      this.usesNextMotorRules() && motorRuleEnabled(this.options, "preferred_shifts");
    const applyMeta =
      this.usesNextMotorRules() && motorRuleEnabled(this.options, "pao_meta_turnos");
    const useYearSaldo = applyMeta && this.metaOvershootAllowance > 0;

    const pool = applyMeta
      ? employees.filter((e) => !this.isAtOrAboveTotalMetaTurnos(e.uuid))
      : employees;

    const tieBreak = (
      a: GenerationInputEmployee,
      b: GenerationInputEmployee,
      oldestFirst: boolean,
    ): number => {
      if (useYearSaldo) {
        const saldoCmp = this.yearRateioSaldo(a.uuid) - this.yearRateioSaldo(b.uuid);
        if (saldoCmp !== 0) return saldoCmp;
      }

      if (applyMeta) {
        const deficitCmp = this.metaTurnosDeficit(b.uuid) - this.metaTurnosDeficit(a.uuid);
        if (deficitCmp !== 0) return deficitCmp;
      }

      const ta = this.countRateioTurnsForShift(a.uuid, normalized);
      const tb = this.countRateioTurnsForShift(b.uuid, normalized);
      if (ta !== tb) return ta - tb;

      const senCmp = oldestFirst
        ? a.employee.seniority - b.employee.seniority
        : b.employee.seniority - a.employee.seniority;
      if (senCmp !== 0) return senCmp;
      return a.employee.name.localeCompare(b.employee.name);
    };

    if (!usePref) {
      return [...pool].sort((a, b) => tieBreak(a, b, true));
    }

    const prefer = pool.filter((e) => employeePrefersShift(this, e.domainId, normalized));
    const others = pool.filter((e) => !employeePrefersShift(this, e.domainId, normalized));
    prefer.sort((a, b) => tieBreak(a, b, false));
    others.sort((a, b) => tieBreak(a, b, false));
    return [...prefer, ...others];
  }

  fillCoverageGaps(): void {
    this.fillCoverageGapsInternal("COVERAGE");
  }

  /**
   * Fase EXTRA_COBERTURA: libera até +1 e depois +2 acima da meta mensal justa,
   * priorizando quem está abaixo no contador acumulado do ano.
   * `afterRound` roda com o overshoot ainda ativo (ex.: cobertura T8).
   */
  fillCoverageGapsExtra(afterRound?: () => void): void {
    if (!this.usesNextMotorRules()) return;
    if (!motorRuleEnabled(this.options, "pao_meta_turnos")) return;

    for (let allowance = 1; allowance <= MAX_MONTHLY_RATEIO_OVERSHOOT; allowance++) {
      if (this.listCoverageGaps().length === 0) break;
      this.metaOvershootAllowance = allowance;
      this.audit.record(
        "COVERAGE_ATTEMPT",
        "EXTRA_COBERTURA",
        `rodada +${allowance} acima da meta justa (contador anual)`,
        {},
      );
      this.fillCoverageGapsInternal("EXTRA_COBERTURA");
      afterRound?.();
    }
    this.metaOvershootAllowance = 0;
  }

  private fillCoverageGapsInternal(phase: string): void {
    const excludeT8PrefFromT6T7 =
      this.usesNextMotorRules() && motorRuleEnabled(this.options, "preferred_shifts");

    for (const date of this.days) {
      for (const shiftCode of this.coverageShiftCodes) {
        if (this.hasPaoCoverage(date, shiftCode)) {
          this.audit.record("SKIP_ALREADY_COVERED", phase, "cobertura existente", {
            date,
            shiftCode,
          });
          continue;
        }

        const normalized = shiftCode.toUpperCase();
        if (normalized === "T8" && this.usesNextMotorRules()) {
          continue;
        }

        const applyTotalMeta =
          this.usesNextMotorRules() &&
          motorRuleEnabled(this.options, "pao_meta_turnos");
        const applyPerShiftMeta =
          applyTotalMeta &&
          motorShiftRuleEnabled(this.options, "pao_meta_turnos", normalized) &&
          // Na EXTRA não bloqueia por meta por turno — só o teto total com overshoot.
          this.metaOvershootAllowance <= 0;
        const applyDiasMeta =
          this.usesNextMotorRules() &&
          motorRuleEnabled(this.options, "pao_meta_dias_trabalhados");
        const candidates = this.sortedCandidates(date, shiftCode)
          .filter((c) => {
            if (applyPerShiftMeta) {
              if (
                this.countRateioTurnsForShift(c.uuid, normalized) >=
                this.effectiveMetaTurnosForShift(c.uuid, normalized)
              ) {
                return false;
              }
            }
            if (applyTotalMeta) {
              if (this.countRateioTurns(c.uuid) >= this.effectiveTotalMetaForEmployee(c.uuid)) {
                return false;
              }
            }
            if (applyDiasMeta && !this.hasDiasTrabalhadosHeadroom(c.uuid, 1)) {
              return false;
            }
            return true;
          })
          .filter((c) => {
            if (!excludeT8PrefFromT6T7) return true;
            if (normalized !== "T6" && normalized !== "T7") return true;
            return !isT8PreferredPao(this, c.uuid);
          });

        let assigned = false;
        const nextMotor = this.usesNextMotorRules();
        // T6/T7 no NEXT: bloco do agrupamento. Na EXTRA, permite isolado para fechar o resto.
        const allowIsolate =
          !nextMotor ||
          allowsIsolatedCoverageDay(normalized) ||
          phase === "EXTRA_COBERTURA";

        if (nextMotor && !allowIsolate) {
          assigned = tryFillCoverageBlock(this, date, shiftCode, phase, candidates);
        } else if (nextMotor && phase === "EXTRA_COBERTURA") {
          // Tenta bloco completo primeiro; se não couber, dia isolado.
          assigned = tryFillCoverageBlock(this, date, shiftCode, phase, candidates);
        }

        if (!assigned && allowIsolate) {
          for (const c of candidates) {
            if (
              motorShiftRuleEnabled(this.options, "pao_espacamento_turnos", normalized) &&
              prefersRateioShift(this, c.domainId, normalized) &&
              isBlockedOnlyByTurnSpacing(this, c.domainId, date, normalized)
            ) {
              continue;
            }
            if (this.tryAssign(c.uuid, date, shiftCode, phase)) {
              assigned = true;
              break;
            }
          }
        }

        if (
          !assigned &&
          motorShiftRuleEnabled(this.options, "pao_espacamento_turnos", normalized)
        ) {
          if (nextMotor && !allowIsolate) {
            assigned = tryFillCoverageBlock(this, date, shiftCode, phase, candidates, {
              bypassSpacing: true,
            });
            if (!assigned) {
              assigned = tryFillCoverageBlock(this, date, shiftCode, phase, candidates, {
                bypassSpacing: true,
                anyCandidate: true,
              });
            }
          } else if (allowIsolate) {
            for (const c of candidates) {
              if (
                !prefersRateioShift(this, c.domainId, normalized) ||
                !isBlockedOnlyByTurnSpacing(this, c.domainId, date, normalized)
              ) {
                continue;
              }
              if (this.tryAssign(c.uuid, date, shiftCode, phase)) {
                assigned = true;
                this.audit.record(
                  "COVERAGE_ASSIGNED",
                  phase,
                  "cobertura com exceção de espaçamento",
                  {
                    date,
                    shiftCode: normalized,
                    employeeUuid: c.uuid,
                    employeeName: c.employee.name,
                  },
                );
                break;
              }
            }
            if (!assigned) {
              for (const c of candidates) {
                if (this.tryAssign(c.uuid, date, shiftCode, phase)) {
                  assigned = true;
                  this.audit.record(
                    "COVERAGE_ASSIGNED",
                    phase,
                    "cobertura com exceção de espaçamento (qualquer candidato)",
                    {
                      date,
                      shiftCode: normalized,
                      employeeUuid: c.uuid,
                      employeeName: c.employee.name,
                    },
                  );
                  break;
                }
              }
            }
          }
        }

        if (!assigned) {
          const reasons =
            candidates.length > 0
              ? nextMotor && !allowIsolate
                ? `nenhum bloco ≥ agrupamento elegível entre ${candidates.length} candidato(s)`
                : `nenhum PAO elegível entre ${candidates.length} candidato(s)`
              : "nenhum PAO cadastrado";
          this.audit.record("COVERAGE_FAILED", phase, reasons, { date, shiftCode });
        }
      }
    }
  }

  private sortedCandidates(_date: string, shiftCode: string): GenerationInputEmployee[] {
    return this.sortCoverageCandidatesForShift(shiftCode);
  }

  countRateioTurns(uuid: string): number {
    const did = this.uuidToDomain.get(uuid);
    if (did == null) return 0;
    let n = 0;
    for (const [key, code] of this.planned) {
      const [oid] = key.split("|");
      if (Number(oid) !== did) continue;
      if (isRateioTurnCode(code)) n++;
    }
    return n;
  }

  countRateioTurnsForShift(uuid: string, shiftCode: string): number {
    const did = this.uuidToDomain.get(uuid);
    if (did == null) return 0;
    const normalized = shiftCode.toUpperCase();
    let n = 0;
    for (const [key, code] of this.planned) {
      const [oid] = key.split("|");
      if (Number(oid) !== did) continue;
      if (baseShiftCode(code) === normalized) n++;
    }
    return n;
  }

  /** Dia já tem turno gerado ou bloqueio (férias, folga pedida, ND, etc.). */
  isEmployeeDayOccupied(domainId: number, date: string): boolean {
    const key = assignmentKey(domainId, date);
    return this.planned.has(key) || this.blocked.has(key);
  }

  applyT8NdRule(): void {
    const phase = "T8_ND";
    for (const emp of this.paoEmployees) {
      const did = emp.domainId;
      for (const date of this.days) {
        const prev = addDays(date, -1);
        const mergedPlanned = this.mergedPlanned();
        const t8Today = mergedPlanned.get(assignmentKey(did, date))?.toUpperCase() === "T8";
        const t8Prev = mergedPlanned.get(assignmentKey(did, prev))?.toUpperCase() === "T8";
        if (!t8Today || !t8Prev) continue;

        const ndDate = addDays(date, 1);
        if (!this.days.includes(ndDate)) continue;

        const ndKey = assignmentKey(did, ndDate);
        const existingShift = this.planned.get(ndKey);
        if (existingShift) {
          if (this.isLockedRateioDay(emp.uuid, ndDate)) {
            this.audit.record("T8_ND_BLOCKED", phase, `pré-alocação ${existingShift} em ${ndDate}`, {
              date: ndDate,
              employeeUuid: emp.uuid,
              employeeName: emp.employee.name,
            });
            continue;
          }
          this.planned.delete(ndKey);
          this.audit.record("T8_ND_REQUIRED", phase, `remove ${existingShift} — ND obrigatório após T8/T8`, {
            date: ndDate,
            shiftCode: existingShift,
            employeeUuid: emp.uuid,
            employeeName: emp.employee.name,
          });
        }
        const existingBlock = this.blocked.get(ndKey);
        if (existingBlock) {
          const blockLabel = normalizeOperationalLabel(existingBlock).toUpperCase();
          const ndOverridesBlock =
            blockLabel === "FOLGA PEDIDA" ||
            blockLabel === "FOLGA SOCIAL" ||
            blockLabel === "FOLGA";
          if (isOperationalHardBlock(existingBlock) && !ndOverridesBlock) {
            this.audit.record("T8_ND_BLOCKED", phase, `dia ${ndDate} bloqueado: ${existingBlock}`, {
              date: ndDate,
              employeeUuid: emp.uuid,
              employeeName: emp.employee.name,
            });
            continue;
          }
          this.blocked.delete(ndKey);
          this.audit.record("T8_ND_REQUIRED", phase, `remove bloqueio ${existingBlock} — ND após T8/T8`, {
            date: ndDate,
            employeeUuid: emp.uuid,
            employeeName: emp.employee.name,
          });
        }

        if (this.getBlockLabel(did, ndDate)?.toUpperCase() === "ND") continue;

        this.audit.record("T8_ND_REQUIRED", phase, "par T8/T8 detectado — ND obrigatório", {
          date: ndDate,
          employeeUuid: emp.uuid,
          employeeName: emp.employee.name,
        });
        this.setBlockDay(emp.uuid, ndDate, "ND");
        this.audit.record("T8_ND_APPLIED", phase, "ND alocado após par T8/T8", {
          date: ndDate,
          employeeUuid: emp.uuid,
          employeeName: emp.employee.name,
        });
      }
    }
    this.scrubOrphanNdAllocations();
  }

  /**
   * Remove ND sem par T8/T8 imediatamente anterior (inclui histórico cross-month).
   * Evita ND “aleatório” / consecutivos após remoção de T8 isolado ou regeneração parcial.
   */
  scrubOrphanNdAllocations(): void {
    const phase = "T8_ND";
    for (const emp of this.paoEmployees) {
      const did = emp.domainId;
      for (const day of this.days) {
        const label = this.blocked.get(assignmentKey(did, day));
        if (!label) continue;
        const upper = normalizeOperationalLabel(label).toUpperCase();
        if (upper !== "ND" && upper !== CROSS_MONTH_ND_LABEL.toUpperCase()) continue;
        // Não remove ND travado por pré-alocação / cross-month.
        if (this.isLockedAllocationDay(emp.uuid, day)) continue;
        const prev = addDays(day, -1);
        const prev2 = addDays(day, -2);
        const merged = this.mergedPlannedSnapshot();
        const t8Prev = merged.get(assignmentKey(did, prev))?.toUpperCase() === "T8";
        const t8Prev2 = merged.get(assignmentKey(did, prev2))?.toUpperCase() === "T8";
        if (t8Prev && t8Prev2) continue;
        this.clearBlock(did, day);
        this.audit.record(
          "T8_ND_BLOCKED",
          phase,
          "ND órfão removido — exige par T8/T8 no dia anterior",
          {
            date: day,
            employeeUuid: emp.uuid,
            employeeName: emp.employee.name,
          },
        );
      }
    }
  }

  listCoverageGaps(): Array<{ date: string; shiftCode: string }> {
    const gaps: Array<{ date: string; shiftCode: string }> = [];
    for (const date of this.days) {
      for (const shiftCode of this.coverageShiftCodes) {
        if (!this.hasPaoCoverage(date, shiftCode)) {
          gaps.push({ date, shiftCode });
        }
      }
    }
    return gaps;
  }

  toAssignments(): GeneratedAssignment[] {
    const out: GeneratedAssignment[] = [];
    for (const [key, shiftCode] of this.planned) {
      const [didStr, date] = key.split("|");
      const uuid = this.domainToUuid.get(Number(didStr));
      if (!uuid) continue;
      out.push({ employeeUuid: uuid, date, shiftCode });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.employeeUuid.localeCompare(b.employeeUuid));
  }

  toAllocations(): GeneratedAllocation[] {
    const lastDay = this.days[this.days.length - 1];
    if (!lastDay) return [...this.allocations];
    return this.allocations.filter((row) => row.date <= lastDay);
  }
}
