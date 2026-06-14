import type { ShiftMap } from "../shift/types.js";
import { buildShiftMap } from "../shift/default-shifts.js";
import { listParallelShiftCodes } from "../shift/coverage-type.js";
import { canWork } from "../rules/eligibility.js";
import { consecutiveWorkCount, isProductiveWorkAllocationLabel } from "../rules/consecutive.js";
import { has12hRest } from "../rules/time.js";
import {
  IDEAL_PAO_REST_COUNT,
  MAX_CONSECUTIVE_WORK_DAYS,
  MAX_PAO_REST_COUNT,
  MIN_PAO_REST_COUNT,
  PAO_COVERAGE_SHIFTS,
  VACATION_TYPES,
} from "../rules/constants.js";
import { isOperationalHardBlock, normalizeOperationalLabel } from "./operational-labels.js";
import { listPaoMinShiftFillCodesFromWorkspace, listPaoRateioShiftCodesFromWorkspace } from "./pao-rateio-shifts.js";
import { assignmentKey, type BlockedMap, type PlannedMap } from "./types.js";
import { birthdayInMonth, FANI_LABEL } from "../rules/birthday.js";
import { addDays, iterDays, weekday } from "../rules/dates.js";
import { generationToScheduleContext } from "./generation-context.js";
import {
  DEFAULT_MOTOR_ROLE_CODES,
  isMotorApaoRole,
  isMotorPaoRole,
} from "../role/motor-codes.js";
import type {
  GeneratedAllocation,
  GeneratedAssignment,
  GenerationInput,
  GenerationInputEmployee,
} from "./generation-types.js";
import type { ScheduleContext, ValidationIssue } from "./types.js";
import { coverT6T7ByBlocks, wouldExceedT6T7BlockMax } from "./t6-t7-block-coverage.js";
import {
  correctMonoFolgasPedidas,
  type MonoFolgaAuditResult,
} from "./mono-folga-pedida.js";
import { countAllocatedTurns, computeTurnRateio, sortPaoByAssignedTurnBalance, sortPaoForCoverageCandidates } from "./real-schedule-turn-rateio.js";
import { sortPaoByOperationalPriority } from "./pao-operational-priority.js";
import {
  clearNdDayConflicts,
  hasNdOnGrid,
  isNdOverrideProtected,
  isNdPlacementBlocked,
} from "./schedule-grid-source.js";
import { isParallelOnlyPreferredPao } from "./employee-t6-t7-shift.js";
import {
  buildScheduleRateioContext,
  logRateioOverflow,
  recordRateioAssignment,
  recordRateioUnassignment,
  syncRateioCountsFromWorkspace,
  type ScheduleRateioContext,
} from "./schedule-rateio-context.js";
import {
  canAssignShiftWithRateio,
  toShiftCode,
} from "./assignment-eligibility.js";
import {
  employeeCanStartT8Block,
} from "./t8-block-limits.js";
import {
  maxConsecutiveWorkDays,
  workDatesFromWorkspace,
} from "./operational-audit.js";

export const GENERATOR_REST_LABELS = new Set([
  "FOLGA",
  "FOLGA SOCIAL",
  "FOLGA PEDIDA",
  "FOLGA ESCOLHIDA",
  "FOLGA AGRUPADA",
  "FOLGA ANIVERSÁRIO",
]);

export class GenerationWorkspace {
  readonly shiftMap: ShiftMap;
  readonly uuidToDomain: Map<string, number>;
  readonly domainToUuid: Map<number, string>;
  readonly roleByDomain: Map<number, string>;
  readonly planned: PlannedMap = new Map();
  readonly blocked: BlockedMap = new Map();
  /** Histórico do fim do mês anterior — não conta na cota mensal. */
  readonly historyPlanned: PlannedMap = new Map();
  readonly historyBlocked: BlockedMap = new Map();
  readonly allocations: GeneratedAllocation[] = [];
  /** Ocupações com janela de horário (ex.: simulador) para descanso 12h. */
  readonly timedOccupancies: Array<{
    employeeId: number;
    day: string;
    startTime: string;
    endTime: string;
  }> = [];
  readonly days: string[];
  readonly paoEmps: GenerationInputEmployee[];
  readonly apaoEmps: GenerationInputEmployee[];
  readonly motorRoleCodes: { pao: string; apao: string };
  readonly canWorkOpts: {
    shiftMap: ShiftMap;
    roleByEmployeeId: Map<number, string>;
    shiftRestrictions?: Map<number, Set<string>>;
    preferredShifts?: Map<number, Set<string>>;
    parallelShiftCodes?: Set<string>;
  };

  private coverageGapsCache: Array<{ date: string; shiftCode: string }> | null = null;
  private readonly employeeT6T7Lock = new Map<string, "T6" | "T7">();
  private readonly t8BlockComplete = new Set<string>();
  private readonly noFlightByUuid = new Map<string, Set<string>>();
  readonly birthdayWarnings: ValidationIssue[] = [];
  readonly noFlightWarnings: ValidationIssue[] = [];
  readonly monoFolgaWarnings: ValidationIssue[] = [];
  monoFolgaAudit: MonoFolgaAuditResult | null = null;

  /**
   * REAL_V1: folga comum (FOLGA) não é auto-alocada — apenas FS PAO e FA APAO.
   * Demais motores permanecem com comportamento legado.
   */
  realV1ManualCommonFolga = false;

  /** Motor dedicado APAO (Gerar escala APAO) — habilita FA + 6x1 sem afetar PAO REAL_V1. */
  apaoMotorEnabled = false;

  /** Fonte única de rateio — min/target/max e contadores de turnos. */
  rateioContext: ScheduleRateioContext | null = null;

  /** T8 isolado emergencial pós-dedup — preservado em repairIsolatedT8. */
  private readonly emergencyIsolatedT8Keys = new Set<string>();

  constructor(readonly input: GenerationInput) {
    this.shiftMap =
      input.shifts.length > 0
        ? Object.fromEntries(
            input.shifts.map((s) => [
              s.code,
              {
                startTime: s.startTime,
                endTime: s.endTime,
                role: s.role,
                noWeekends: Boolean(s.noWeekends),
              },
            ]),
          )
        : buildShiftMap();

    this.uuidToDomain = new Map(input.employees.map((e) => [e.uuid, e.domainId]));
    this.domainToUuid = new Map(input.employees.map((e) => [e.domainId, e.uuid]));
    this.roleByDomain = new Map(input.employees.map((e) => [e.domainId, e.employee.role]));
    this.motorRoleCodes = input.motorRoleCodes ?? DEFAULT_MOTOR_ROLE_CODES;
    this.days = iterDays(input.year, input.month);
    this.paoEmps = input.employees.filter((e) =>
      isMotorPaoRole(e.employee.role, this.motorRoleCodes),
    );
    this.apaoEmps = input.employees.filter((e) =>
      isMotorApaoRole(e.employee.role, this.motorRoleCodes),
    );
    this.canWorkOpts = {
      shiftMap: this.shiftMap,
      roleByEmployeeId: this.roleByDomain,
      shiftRestrictions: input.shiftRestrictions,
      preferredShifts: input.preferredShifts,
      parallelShiftCodes: new Set(listParallelShiftCodes(input.shifts)),
    };
    for (const row of input.noFlightDates ?? []) {
      const set = this.noFlightByUuid.get(row.employeeUuid) ?? new Set<string>();
      set.add(row.date);
      this.noFlightByUuid.set(row.employeeUuid, set);
    }
    this.seedCrossMonthHistory();
  }

  isNoFlightDay(uuid: string, day: string): boolean {
    return this.noFlightByUuid.get(uuid)?.has(day) ?? false;
  }

  isFullMonthNoFlight(uuid: string): boolean {
    const set = this.noFlightByUuid.get(uuid);
    if (!set || set.size === 0) return false;
    return this.days.every((d) => set.has(d));
  }

  countWorkDays(uuid: string): number {
    return countAllocatedTurns(this, uuid);
  }

  initRateioContext(): ScheduleRateioContext {
    this.rateioContext = buildScheduleRateioContext(this);
    return this.rateioContext;
  }

  ensureRateioContext(): ScheduleRateioContext {
    return this.rateioContext ?? this.initRateioContext();
  }

  markEmergencyIsolatedT8(uuid: string, day: string): void {
    this.emergencyIsolatedT8Keys.add(`${uuid}|${day}`);
  }

  isEmergencyIsolatedT8(uuid: string, day: string): boolean {
    return this.emergencyIsolatedT8Keys.has(`${uuid}|${day}`);
  }

  listEmergencyIsolatedT8Days(): Array<{ employeeUuid: string; date: string }> {
    return [...this.emergencyIsolatedT8Keys].map((key) => {
      const [employeeUuid, date] = key.split("|") as [string, string];
      return { employeeUuid, date };
    });
  }

  clearEmergencyIsolatedT8(uuid: string, day: string): void {
    this.emergencyIsolatedT8Keys.delete(`${uuid}|${day}`);
  }

  syncRateioContext(): void {
    if (this.rateioContext) {
      syncRateioCountsFromWorkspace(this, this.rateioContext);
    }
  }

  /** Indica se ainda existe PAO no pool principal abaixo do maxTurnCount. */
  hasPaoBelowMaxForRateio(excludeUuid?: string): boolean {
    if (!this.rateioContext) return false;
    const ctx = this.rateioContext;
    for (const c of this.paoEmps) {
      if (c.uuid === excludeUuid) continue;
      const cur = ctx.currentTurnCounts.get(c.uuid) ?? 0;
      const max = ctx.maxTurnCounts.get(c.uuid);
      if (max == null || cur < max) return true;
    }
    return false;
  }

  /** Turnos elegíveis para o PAO (exclui restrições permanentes). */
  allowedShiftsForEmployee(uuid: string, fallback?: readonly string[]): string[] {
    const shifts = fallback ?? listPaoRateioShiftCodesFromWorkspace(this);
    const did = this.uuidToDomain.get(uuid);
    if (!did) return [...shifts];
    const restricted = this.input.shiftRestrictions?.get(did);
    if (!restricted || restricted.size === 0) return [...shifts];
    return shifts.filter((code) => !restricted.has(code));
  }

  /** PAO com mês inteiro sem voo: tenta atingir meta de turnos do rateio. */
  ensureMinShiftsForFullMonthNoFlight(allowedShifts?: readonly string[]): void {
    const shifts = allowedShifts ?? listPaoMinShiftFillCodesFromWorkspace(this);
    this.noFlightWarnings.length = 0;
    const rateio = computeTurnRateio(this);
    const targetByUuid = new Map(rateio.entries.map((e) => [e.employeeUuid, e.turnTarget]));
    const prioritized = sortPaoByOperationalPriority(this, 0).filter(
      (c) => this.isFullMonthNoFlight(c.uuid) && !isParallelOnlyPreferredPao(this, c.uuid),
    );

    for (const c of prioritized) {
      const turnTarget = targetByUuid.get(c.uuid) ?? 0;
      const maxTurns = this.rateioContext?.maxTurnCounts.get(c.uuid);
      let count = countAllocatedTurns(this, c.uuid);
      const cap = maxTurns != null ? Math.min(turnTarget, maxTurns) : turnTarget;
      if (count >= cap) continue;

      const shiftsForEmployee = this.allowedShiftsForEmployee(c.uuid, shifts);
      if (shiftsForEmployee.length === 0) {
        this.noFlightWarnings.push({
          severity: "MÉDIA",
          level: "WARNING",
          type: "RESTRIÇÃO VOO MÊS INTEIRO",
          date: "",
          employee: c.employee.name,
          detail:
            "Funcionário com restrição de voo no mês inteiro e todos os turnos restritos — impossível alocar turnos.",
        });
        continue;
      }

      for (const day of this.days) {
        if (count >= cap) break;
        const did = this.uuidToDomain.get(c.uuid)!;
        if (this.planned.has(assignmentKey(did, day))) continue;
        if (this.allocations.some((a) => a.employeeUuid === c.uuid && a.date === day && a.label === "ND")) {
          continue;
        }
        for (const code of this.shiftOrderRespectingBlocks(c.uuid, day, shiftsForEmployee)) {
          if (this.tryAssignShift(c.uuid, day, code)) {
            count = countAllocatedTurns(this, c.uuid);
            break;
          }
        }
      }

      if (count < turnTarget) {
        this.noFlightWarnings.push({
          severity: "MÉDIA",
          level: "WARNING",
          type: "RESTRIÇÃO VOO MÊS INTEIRO",
          date: "",
          employee: c.employee.name,
          detail:
            `Funcionário com restrição de voo no mês inteiro não atingiu ${turnTarget} turno(s) (${count}/${turnTarget}).`,
        });
      }
    }
  }

  /** Ordem de turnos para preenchimento sem estourar bloco T6/T7 (>5 dias). */
  private shiftOrderRespectingBlocks(
    uuid: string,
    day: string,
    allowed: readonly string[],
  ): string[] {
    const order: string[] = [];
    for (const code of allowed) {
      if (code === "T8" || !wouldExceedT6T7BlockMax(this, uuid, day, code)) {
        order.push(code);
      }
    }
    return order;
  }

  /** Corrige mono-folgas pedidas isoladas com folga adjacente quando viável. */
  correctMonoFolgasPedidas(): MonoFolgaAuditResult {
    const result = correctMonoFolgasPedidas(this);
    this.monoFolgaAudit = result;
    this.monoFolgaWarnings.length = 0;
    this.monoFolgaWarnings.push(...result.warnings);
    return result;
  }

  private seedCrossMonthHistory(): void {
    const hist = this.input.crossMonthHistory;
    if (!hist) return;

    for (const a of hist.assignments) {
      const did = this.uuidToDomain.get(a.employeeUuid);
      if (!did) continue;
      this.historyPlanned.set(assignmentKey(did, a.date), a.shiftCode);
    }
    for (const al of hist.allocations) {
      const did = this.uuidToDomain.get(al.employeeUuid);
      if (!did) continue;
      this.historyBlocked.set(assignmentKey(did, al.date), al.label);
    }
  }

  /** Turno planejado incluindo histórico anterior ao mês. */
  private shiftOnDay(did: number, day: string): string | undefined {
    const key = assignmentKey(did, day);
    return this.planned.get(key) ?? this.historyPlanned.get(key);
  }

  /** Mapa combinado para regras de continuidade (6x1, 12h, T8). */
  private mergedPlannedForContinuity(): PlannedMap {
    const merged = new Map(this.historyPlanned);
    for (const [k, v] of this.planned) merged.set(k, v);
    return merged;
  }

  /** Bloqueios produtivos e operacionais incluindo histórico anterior ao mês. */
  private mergedBlockedForContinuity(): BlockedMap {
    const merged = new Map(this.historyBlocked);
    for (const [k, v] of this.blocked) merged.set(k, v);
    return merged;
  }

  private consecutiveDaysBeforeMonth(uuid: string): number {
    const did = this.uuidToDomain.get(uuid);
    if (!did || this.days.length === 0) return 0;
    const merged = this.mergedPlannedForContinuity();
    const blocked = this.mergedBlockedForContinuity();
    let count = 0;
    let d = addDays(this.days[0], -1);
    while (
      merged.has(assignmentKey(did, d)) ||
      isProductiveWorkAllocationLabel(blocked.get(assignmentKey(did, d)))
    ) {
      count++;
      d = addDays(d, -1);
      if (count >= 6) break;
    }
    return count;
  }

  /**
   * Folga obrigatória no 1º dia quando o funcionário encerrou o mês anterior
   * com 6+ dias trabalhados consecutivos (continuidade 6x1 entre meses).
   */
  enforceMonthStart6x1FromPrevious(): void {
    if (this.days.length === 0) return;
    const firstDay = this.days[0]!;
    for (const ge of this.input.employees) {
      const role = ge.employee.role;
      if (role !== "PAO" && role !== "APAO") continue;
      if (this.consecutiveDaysBeforeMonth(ge.uuid) < MAX_CONSECUTIVE_WORK_DAYS) continue;
      const did = this.uuidToDomain.get(ge.uuid);
      if (!did) continue;
      const key = assignmentKey(did, firstDay);
      if (this.planned.has(key) || this.blocked.has(key)) continue;
      this.lockDay(ge.uuid, firstDay, "FOLGA");
    }
  }

  lockDay(
    uuid: string,
    day: string,
    label: string,
    track = true,
    times?: { startTime: string; endTime: string },
  ): void {
    const did = this.uuidToDomain.get(uuid);
    if (!did) return;
    this.blocked.set(assignmentKey(did, day), label);
    if (track) {
      this.allocations.push({
        employeeUuid: uuid,
        date: day,
        label,
        startTime: times?.startTime,
        endTime: times?.endTime,
      });
    }
    if (times?.startTime && times?.endTime) {
      this.timedOccupancies.push({
        employeeId: did,
        day,
        startTime: times.startTime,
        endTime: times.endTime,
      });
    }
    this.coverageGapsCache = null;
  }

  isLockedByAdmin(uuid: string, day: string): boolean {
    const key = `${uuid}|${day}`;
    if (this.input.lockedAllocations.some((l) => `${l.employeeUuid}|${l.date}` === key)) {
      return true;
    }
    const did = this.uuidToDomain.get(uuid);
    if (!did) return false;
    const label = this.blocked.get(assignmentKey(did, day));
    return label ? isOperationalHardBlock(label) : false;
  }

  tryAssignShift(uuid: string, day: string, code: string, coverageEmergency = false): boolean {
    if (coverageEmergency && this.canWorkOpts.parallelShiftCodes?.has(code.toUpperCase())) {
      return false;
    }
    if (this.isDayBlockedForShift(uuid, day)) return false;
    const did = this.uuidToDomain.get(uuid)!;
    const emp = this.input.employees.find((e) => e.uuid === uuid)!.employee;
    const shiftCode = toShiftCode(code);

    if (emp.role === "PAO" && shiftCode && this.rateioContext) {
      const ctx = this.rateioContext;
      const current = ctx.currentTurnCounts.get(uuid) ?? 0;
      const max = ctx.maxTurnCounts.get(uuid);
      const eligibility = canAssignShiftWithRateio({
        monthDays: this.days.length,
        day: this.days.indexOf(day) + 1,
        shift: shiftCode,
        employeeId: uuid,
        currentTurnCounts: ctx.currentTurnCounts,
        maxTurnCounts: ctx.maxTurnCounts,
        minTurnCounts: ctx.minTurnCounts,
        targetTurnCounts: ctx.targetTurnCounts,
        t6Counts: ctx.currentT6Counts,
        t7Counts: ctx.currentT7Counts,
        t8Counts: ctx.currentT8Counts,
        t9Counts: ctx.currentT9Counts,
        preferredShiftByEmployee: ctx.preferredShiftByEmployee,
        strictMaxTurnCount: true,
        allowEmergencyOverflow: coverageEmergency,
      });
      if (!eligibility.allowed) {
        if (!coverageEmergency && !this.hasPaoBelowMaxForRateio(uuid)) {
          return this.tryAssignShift(uuid, day, code, true);
        }
        return false;
      }
      if (
        coverageEmergency &&
        max !== undefined &&
        current >= max
      ) {
        logRateioOverflow(ctx, uuid, shiftCode, day);
      }
    }

    if (emp.role === "PAO" && !coverageEmergency) {
      const budget = this.workCount(uuid) + 1 + this.countNd(uuid) + IDEAL_PAO_REST_COUNT;
      if (budget > this.days.length) return false;
      const maxWork = this.maxWorkDaysForPao(uuid);
      if (maxWork != null && this.workCount(uuid) >= maxWork) return false;
    }
    const continuity = this.mergedPlannedForContinuity();
    const continuityBlocked = this.mergedBlockedForContinuity();
    const r = canWork(emp, day, code, this.blocked, continuity, {
      ...this.canWorkOpts,
      continuityBlocked,
      coverageEmergency,
    });
    if (!r.ok) return false;
    const rest12 = has12hRest(did, day, code, continuity, this.shiftMap, this.timedOccupancies);
    if (!rest12.ok) return false;
    this.planned.set(assignmentKey(did, day), code);
    if (shiftCode && this.rateioContext) {
      recordRateioAssignment(this.rateioContext, uuid, code);
    }
    this.coverageGapsCache = null;
    return true;
  }

  unassignShift(uuid: string, day: string, opts?: { bypassT8Protection?: boolean }): boolean {
    if (!opts?.bypassT8Protection && this.isT8BlockProtected(uuid, day)) return false;
    const did = this.uuidToDomain.get(uuid);
    if (!did) return false;
    const code = this.planned.get(assignmentKey(did, day));
    const ok = this.planned.delete(assignmentKey(did, day));
    if (ok) {
      if (code && this.rateioContext) {
        recordRateioUnassignment(this.rateioContext, uuid, code);
      }
      this.coverageGapsCache = null;
    }
    return ok;
  }

  workCount(uuid: string): number {
    const did = this.uuidToDomain.get(uuid)!;
    const parallel = new Set(listParallelShiftCodes(this.input.shifts));
    let n = 0;
    for (const [k, shiftCode] of this.planned.entries()) {
      if (!k.startsWith(`${did}|`)) continue;
      if (parallel.has(shiftCode.toUpperCase())) continue;
      n++;
    }
    return n;
  }

  hasPaoCoverage(day: string, code: string): boolean {
    return [...this.planned.entries()].some(
      ([k, sh]) =>
        k.endsWith(`|${day}`) && sh === code && this.roleByDomain.get(Number(k.split("|")[0])) === "PAO",
    );
  }

  /** Turno paralelo já alocado no dia (ex.: T9 — não interfere em T6/T7/T8). */
  hasParallelShiftOnDay(day: string, code: string): boolean {
    const normalized = code.toUpperCase();
    return [...this.planned.entries()].some(
      ([k, sh]) => k.endsWith(`|${day}`) && sh.toUpperCase() === normalized,
    );
  }

  /** PAO alocado no turno/dia (primeiro encontrado). */
  findPaoOnShift(day: string, code: string): string | undefined {
    for (const c of this.paoEmps) {
      const did = this.uuidToDomain.get(c.uuid);
      if (!did) continue;
      if (this.shiftOnDay(did, day) === code) return c.uuid;
    }
    return undefined;
  }

  /** Dias consecutivos do mesmo turno terminando em endDay (inclusive). */
  countConsecutiveShiftEnding(uuid: string, code: string, endDay: string): number {
    const did = this.uuidToDomain.get(uuid);
    if (!did) return 0;
    const daySet = new Set(this.days);
    let count = 0;
    let d = endDay;
    while (daySet.has(d)) {
      if (this.shiftOnDay(did, d) !== code) break;
      count++;
      d = addDays(d, -1);
    }
    return count;
  }

  listCoverageGaps(): Array<{ date: string; shiftCode: string }> {
    if (this.coverageGapsCache) return this.coverageGapsCache;
    const gaps: Array<{ date: string; shiftCode: string }> = [];
    for (const day of this.days) {
      for (const code of PAO_COVERAGE_SHIFTS) {
        if (!this.hasPaoCoverage(day, code)) {
          gaps.push({ date: day, shiftCode: code });
        }
      }
    }
    this.coverageGapsCache = gaps;
    return gaps;
  }

  clearCoverageGapsCache(): void {
    this.coverageGapsCache = null;
  }

  getEmployeeT6T7Lock(uuid: string): "T6" | "T7" | undefined {
    return this.employeeT6T7Lock.get(uuid);
  }

  setEmployeeT6T7Lock(uuid: string, code: "T6" | "T7"): void {
    this.employeeT6T7Lock.set(uuid, code);
  }

  /** Cobertura T6/T7 e T8 (somente blocos válidos). */
  coverPaoShiftsPrioritized(): number {
    return this.coverT6T7Only() + this.coverT8BlocksOnly();
  }

  /** Cobertura seletiva T6 e/ou T7 por blocos consecutivos (modo por etapas). */
  coverPaoShiftsOnly(codes: readonly ("T6" | "T7")[]): number {
    const gaps = coverT6T7ByBlocks(this, codes);
    this.coverageGapsCache = null;
    return gaps;
  }

  /** Cobertura T6 e T7 por blocos consecutivos — nunca aloca T8 isolado. */
  coverT6T7Only(): number {
    const gaps = coverT6T7ByBlocks(this);
    this.coverageGapsCache = null;
    return gaps;
  }

  /** Cobertura T8 apenas via bloco T8/T8/ND indivisível. */
  coverT8BlocksOnly(): number {
    let gaps = 0;
    this.ensureRateioContext();
    const rateioEntries = computeTurnRateio(this).entries;
    for (let di = 0; di < this.days.length; di++) {
      const day = this.days[di];
      if (this.hasPaoCoverage(day, "T8")) continue;
      const rotated = sortPaoForCoverageCandidates(this, di, rateioEntries).filter((c) =>
        employeeCanStartT8Block(this, c.uuid, false),
      );
      if (!this.tryAssignT8Coverage(day, rotated)) {
        const emergencyPool = sortPaoForCoverageCandidates(this, di, rateioEntries).filter(
          (c) =>
            !isParallelOnlyPreferredPao(this, c.uuid) &&
            employeeCanStartT8Block(this, c.uuid, true),
        );
        if (!this.tryAssignT8Coverage(day, emergencyPool, true)) gaps++;
      }
    }
    this.coverageGapsCache = null;
    return gaps;
  }

  /** Dia bloqueado para turno (pré-alocação, folga, ND, férias…). */
  isDayBlockedForShift(uuid: string, day: string): boolean {
    const did = this.uuidToDomain.get(uuid);
    if (!did) return true;
    const label = this.blockLabelOnDay(did, day);
    if (!label) return false;
    const upper = normalizeOperationalLabel(label).toUpperCase();
    if (VACATION_TYPES.has(upper) || upper === "FÉRIAS") return true;
    if (GENERATOR_REST_LABELS.has(label) || label === "ND") return true;
    return isOperationalHardBlock(label);
  }

  /** Valida bloco T8/T8/ND a partir de startDay (D). */
  canPlaceT8Block(uuid: string, startDay: string, coverageEmergency = false): boolean {
    const did = this.uuidToDomain.get(uuid);
    if (!did || !this.days.includes(startDay)) return false;

    const d0 = startDay;
    const d1 = addDays(d0, 1);
    const d2 = addDays(d0, 2);
    if (!this.days.includes(d1)) return false;

    const existing0 = this.shiftOnDay(did, d0);
    const existing1 = this.shiftOnDay(did, d1);
    if (existing0 !== "T8" && existing1 !== "T8" && !employeeCanStartT8Block(this, uuid, coverageEmergency)) {
      return false;
    }

    for (const d of [d0, d1]) {
      if (this.isDayBlockedForShift(uuid, d)) return false;
    }
    if (this.days.includes(d2)) {
      if (this.isDayBlockedForShift(uuid, d2)) return false;
      if (this.planned.has(assignmentKey(did, d2)) || this.historyPlanned.has(assignmentKey(did, d2))) {
        return false;
      }
    } else if (isNdPlacementBlocked(this, uuid, d2)) {
      return false;
    }

    if (existing0 && existing0 !== "T8") return false;
    if (existing1 && existing1 !== "T8") return false;
    if (existing0 === "T8" && existing1 === "T8") return false;
    if (existing0 === "T8" && this.shiftOnDay(did, addDays(d0, -1)) === "T8") return false;

    const emp = this.input.employees.find((e) => e.uuid === uuid)!.employee;
    const continuity = this.mergedPlannedForContinuity();

    if (existing0 !== "T8") {
      const r0 = canWork(emp, d0, "T8", this.blocked, continuity, this.canWorkOpts);
      if (!r0.ok) return false;
      if (!has12hRest(did, d0, "T8", continuity, this.shiftMap).ok) return false;
    }

    const withFirst = new Map(continuity);
    withFirst.set(assignmentKey(did, d0), "T8");
    if (existing1 !== "T8") {
      const r1 = canWork(emp, d1, "T8", this.blocked, withFirst, this.canWorkOpts);
      if (!r1.ok) return false;
      if (!has12hRest(did, d1, "T8", withFirst, this.shiftMap).ok) return false;
    }

    if (this.planned.has(assignmentKey(did, d2)) || this.historyPlanned.has(assignmentKey(did, d2))) {
      return false;
    }
    return true;
  }

  /** Aloca bloco completo T8/T8/ND (ND pode cair fora do mês). */
  tryPlaceT8Block(uuid: string, startDay: string, coverageEmergency = false): boolean {
    if (!this.canPlaceT8Block(uuid, startDay, coverageEmergency)) return false;

    const did = this.uuidToDomain.get(uuid)!;
    const d0 = startDay;
    const d1 = addDays(d0, 1);
    const d2 = addDays(d0, 2);

    if (this.shiftOnDay(did, d0) !== "T8" && !this.tryAssignShift(uuid, d0, "T8")) return false;
    if (this.shiftOnDay(did, d1) !== "T8" && !this.tryAssignShift(uuid, d1, "T8")) {
      if (this.planned.get(assignmentKey(did, d0)) === "T8") this.unassignShift(uuid, d0);
      return false;
    }

    const hasNd =
      this.allocations.some((a) => a.employeeUuid === uuid && a.date === d2 && a.label === "ND") ||
      this.blockLabelOnDay(did, d2) === "ND";
    if (!hasNd) this.lockDay(uuid, d2, "ND");

    this.t8BlockComplete.add(uuid);
    this.coverageGapsCache = null;
    return true;
  }

  /** Completa par T8/T8 quando o primeiro dia já é T8. */
  tryCompleteT8Pair(uuid: string, secondDay: string, coverageEmergency = false): boolean {
    const did = this.uuidToDomain.get(uuid);
    if (!did || !this.days.includes(secondDay)) return false;

    const firstDay = addDays(secondDay, -1);
    if (this.shiftOnDay(did, firstDay) !== "T8") return false;
    if (this.shiftOnDay(did, addDays(firstDay, -1)) === "T8") return false;
    if (this.shiftOnDay(did, secondDay) === "T8") return false;
    if (this.isDayBlockedForShift(uuid, secondDay)) return false;

    const ndDay = addDays(secondDay, 1);
    if (this.days.includes(ndDay) && isNdPlacementBlocked(this, uuid, ndDay)) return false;
    if (this.planned.has(assignmentKey(did, ndDay)) || this.historyPlanned.has(assignmentKey(did, ndDay))) {
      return false;
    }

    const emp = this.input.employees.find((e) => e.uuid === uuid)!.employee;
    const continuity = this.mergedPlannedForContinuity();
    const r = canWork(emp, secondDay, "T8", this.blocked, continuity, {
      ...this.canWorkOpts,
      coverageEmergency,
    });
    if (!r.ok) return false;
    if (!has12hRest(did, secondDay, "T8", continuity, this.shiftMap).ok) return false;

    if (!this.tryAssignShift(uuid, secondDay, "T8", coverageEmergency)) return false;
    if (
      this.days.includes(ndDay) &&
      !hasNdOnGrid(this, uuid, ndDay)
    ) {
      clearNdDayConflicts(this, uuid, ndDay);
      this.lockDay(uuid, ndDay, "ND");
    } else if (!this.days.includes(ndDay)) {
      clearNdDayConflicts(this, uuid, ndDay);
      this.lockDay(uuid, ndDay, "ND");
    }
    this.coverageGapsCache = null;
    return true;
  }

  /** Cobertura T8 somente como bloco indivisível T8/T8/ND. */
  tryAssignT8Coverage(day: string, candidates?: GenerationInputEmployee[], coverageEmergency = false): boolean {
    const dayIndex = Math.max(0, this.days.indexOf(day));
    const defaultPool = (() => {
      this.ensureRateioContext();
      const entries = computeTurnRateio(this).entries;
      return sortPaoForCoverageCandidates(this, dayIndex, entries).filter(
        (c) =>
          !isParallelOnlyPreferredPao(this, c.uuid) &&
          (coverageEmergency || employeeCanStartT8Block(this, c.uuid, false)),
      );
    })();
    const pool = candidates ?? defaultPool;

    for (const c of pool) {
      if (this.tryCompleteT8Pair(c.uuid, day)) return true;
    }
    for (const c of pool) {
      if (this.tryPlaceT8Block(c.uuid, day, coverageEmergency)) return true;
    }
    const prev = addDays(day, -1);
    if (this.days.includes(prev)) {
      for (const c of pool) {
        if (this.tryPlaceT8Block(c.uuid, prev, coverageEmergency)) return true;
      }
    }
    return false;
  }

  private restDatesFor(uuid: string): string[] {
    return this.allocations
      .filter((a) => a.employeeUuid === uuid && GENERATOR_REST_LABELS.has(a.label))
      .map((a) => a.date);
  }

  private pickSpreadFolgaDay(uuid: string, candidates: string[]): string {
    if (candidates.length === 0) return candidates[0];
    return this.pickFolgaBlockDay(uuid, candidates) ?? candidates[0];
  }

  private freeDaysForPao(uuid: string): string[] {
    const did = this.uuidToDomain.get(uuid)!;
    return this.days.filter(
      (d) => !this.blocked.has(assignmentKey(did, d)) && !this.planned.has(assignmentKey(did, d)),
    );
  }

  private countPaoOffOnWeekend(sat: string): number {
    const dom = addDays(sat, 1);
    let off = 0;
    for (const c of this.paoEmps) {
      const did = c.domainId;
      const satOff =
        this.blocked.has(assignmentKey(did, sat)) || this.planned.has(assignmentKey(did, sat));
      const domOff =
        this.blocked.has(assignmentKey(did, dom)) || this.planned.has(assignmentKey(did, dom));
      if (satOff && domOff) off++;
    }
    return off;
  }

  /** FS no mês atual ou no histórico recente do mês anterior. */
  private hasFolgaSocialIncludingHistory(uuid: string): boolean {
    if (this.allocations.some((a) => a.employeeUuid === uuid && a.label === "FOLGA SOCIAL")) {
      return true;
    }
    const did = this.uuidToDomain.get(uuid);
    if (!did) return false;
    for (const [key, label] of this.historyBlocked) {
      if (key.startsWith(`${did}|`) && label === "FOLGA SOCIAL") return true;
    }
    return false;
  }

  /** FP sábado+domingo conta como FS; reserva par social quando ainda não existe. */
  planFolgaSocial(): void {
    for (const c of this.paoEmps) {
      for (const day of this.days) {
        if (weekday(day) !== 6) continue;
        const dom = addDays(day, 1);
        if (!this.days.includes(dom)) continue;
        const satFp = this.allocations.find(
          (a) => a.employeeUuid === c.uuid && a.date === day && a.label === "FOLGA PEDIDA",
        );
        const domFp = this.allocations.find(
          (a) => a.employeeUuid === c.uuid && a.date === dom && a.label === "FOLGA PEDIDA",
        );
        if (satFp && domFp) {
          satFp.label = "FOLGA SOCIAL";
          domFp.label = "FOLGA SOCIAL";
          const did = this.uuidToDomain.get(c.uuid)!;
          this.blocked.set(assignmentKey(did, day), "FOLGA SOCIAL");
          this.blocked.set(assignmentKey(did, dom), "FOLGA SOCIAL");
        }
      }

      if (!this.allowsAutoFolgaSocial()) continue;

      if (this.hasFolgaSocialIncludingHistory(c.uuid)) continue;

      const weekends = this.days.filter((d) => weekday(d) === 6 && this.days.includes(addDays(d, 1)));
      const maxOffPerWeekend = Math.max(0, this.paoEmps.length - 2);
      const ranked = [...weekends].sort((a, b) => {
        const offA = this.countPaoOffOnWeekend(a);
        const offB = this.countPaoOffOnWeekend(b);
        if (offA !== offB) return offA - offB;
        return this.days.indexOf(b) - this.days.indexOf(a);
      });

      for (const sat of ranked) {
        if (this.countPaoOffOnWeekend(sat) > maxOffPerWeekend) continue;
        const dom = addDays(sat, 1);
        const did = this.uuidToDomain.get(c.uuid)!;
        if (this.blocked.has(assignmentKey(did, sat)) || this.blocked.has(assignmentKey(did, dom))) {
          continue;
        }
        if (this.planned.has(assignmentKey(did, sat)) || this.planned.has(assignmentKey(did, dom))) {
          continue;
        }
        this.lockDay(c.uuid, sat, "FOLGA SOCIAL");
        this.lockDay(c.uuid, dom, "FOLGA SOCIAL");
        break;
      }
    }
  }

  allowsCommonFolgaAutoAllocation(): boolean {
    return !this.realV1ManualCommonFolga;
  }

  /** REAL_V1: motor aloca 1 par FS (sáb+dom) por PAO; FP no mesmo fim de semana promove para FS. */
  allowsAutoFolgaSocial(): boolean {
    return true;
  }

  /** REAL_V1: folgas agrupadas (APAO) e voos são manuais — motor só turnos (+ ND + FS). */
  allowsAutoFolgaSocialAndApaoRest(): boolean {
    return !this.realV1ManualCommonFolga;
  }

  /** Geração APAO dedicada ou fluxo legado completo. */
  allowsAutoApaoRest(): boolean {
    return this.apaoMotorEnabled || !this.realV1ManualCommonFolga;
  }

  private hasFolgaAgrupadaIncludingHistory(uuid: string): boolean {
    if (this.allocations.some((a) => a.employeeUuid === uuid && a.label === "FOLGA AGRUPADA")) {
      return true;
    }
    const did = this.uuidToDomain.get(uuid);
    if (!did) return false;
    for (const [key, label] of this.historyBlocked) {
      if (key.startsWith(`${did}|`) && label === "FOLGA AGRUPADA") return true;
    }
    return false;
  }

  /** Outro APAO já possui FA neste dia — não alocar FA duplicada. */
  private folgaAgrupadaTakenOnDate(day: string, exceptUuid?: string): boolean {
    return this.allocations.some(
      (a) =>
        a.date === day &&
        a.label === "FOLGA AGRUPADA" &&
        (exceptUuid == null || a.employeeUuid !== exceptUuid),
    );
  }

  /** FP sáb+dom promove para FA; reserva 1 par FA (sáb+dom ou dom+seg) por APAO. */
  planApaoFolgaAgrupada(): void {
    if (!this.allowsAutoApaoRest()) return;

    for (const c of this.apaoEmps) {
      for (const day of this.days) {
        if (weekday(day) !== 6) continue;
        const dom = addDays(day, 1);
        if (!this.days.includes(dom)) continue;
        const satFp = this.allocations.find(
          (a) => a.employeeUuid === c.uuid && a.date === day && a.label === "FOLGA PEDIDA",
        );
        const domFp = this.allocations.find(
          (a) => a.employeeUuid === c.uuid && a.date === dom && a.label === "FOLGA PEDIDA",
        );
        if (satFp && domFp) {
          if (this.folgaAgrupadaTakenOnDate(day) || this.folgaAgrupadaTakenOnDate(dom)) {
            continue;
          }
          satFp.label = "FOLGA AGRUPADA";
          domFp.label = "FOLGA AGRUPADA";
          const did = this.uuidToDomain.get(c.uuid)!;
          this.blocked.set(assignmentKey(did, day), "FOLGA AGRUPADA");
          this.blocked.set(assignmentKey(did, dom), "FOLGA AGRUPADA");
        }
      }

      if (this.hasFolgaAgrupadaIncludingHistory(c.uuid)) continue;

      const satWeekends = this.days.filter((d) => weekday(d) === 6 && this.days.includes(addDays(d, 1)));
      for (const sat of [...satWeekends].reverse()) {
        const dom = addDays(sat, 1);
        const did = this.uuidToDomain.get(c.uuid)!;
        if (this.folgaAgrupadaTakenOnDate(sat) || this.folgaAgrupadaTakenOnDate(dom)) {
          continue;
        }
        if (this.blocked.has(assignmentKey(did, sat)) || this.blocked.has(assignmentKey(did, dom))) {
          continue;
        }
        if (this.planned.has(assignmentKey(did, sat)) || this.planned.has(assignmentKey(did, dom))) {
          continue;
        }
        this.lockDay(c.uuid, sat, "FOLGA AGRUPADA");
        this.lockDay(c.uuid, dom, "FOLGA AGRUPADA");
        break;
      }

      if (this.hasFolgaAgrupadaIncludingHistory(c.uuid)) continue;

      const sundays = this.days.filter((d) => weekday(d) === 0 && this.days.includes(addDays(d, 1)));
      for (const sun of [...sundays].reverse()) {
        const mon = addDays(sun, 1);
        const did = this.uuidToDomain.get(c.uuid)!;
        if (this.folgaAgrupadaTakenOnDate(sun) || this.folgaAgrupadaTakenOnDate(mon)) {
          continue;
        }
        if (this.blocked.has(assignmentKey(did, sun)) || this.blocked.has(assignmentKey(did, mon))) {
          continue;
        }
        if (this.planned.has(assignmentKey(did, sun)) || this.planned.has(assignmentKey(did, mon))) {
          continue;
        }
        this.lockDay(c.uuid, sun, "FOLGA AGRUPADA");
        this.lockDay(c.uuid, mon, "FOLGA AGRUPADA");
        break;
      }
    }
  }

  /** Promove pares sáb+dom de folga para FS quando aplicável. */
  promotePaoWeekendPairsToFolgaSocial(): void {
    for (const c of this.paoEmps) {
      for (const day of this.days) {
        if (weekday(day) !== 6) continue;
        const dom = addDays(day, 1);
        if (!this.days.includes(dom)) continue;
        const satF = this.allocations.find(
          (a) => a.employeeUuid === c.uuid && a.date === day && GENERATOR_REST_LABELS.has(a.label),
        );
        const domF = this.allocations.find(
          (a) => a.employeeUuid === c.uuid && a.date === dom && GENERATOR_REST_LABELS.has(a.label),
        );
        if (satF && domF) {
          satF.label = "FOLGA SOCIAL";
          domF.label = "FOLGA SOCIAL";
          const did = this.uuidToDomain.get(c.uuid)!;
          this.blocked.set(assignmentKey(did, day), "FOLGA SOCIAL");
          this.blocked.set(assignmentKey(did, dom), "FOLGA SOCIAL");
          break;
        }
      }
    }
  }

  /** Distribui folgas restantes de forma espaçada no mês. */
  distributePaoFolgasSpread(): void {
    if (!this.allowsCommonFolgaAutoAllocation()) return;
    for (const c of this.paoEmps) {
      let safety = 0;
      while (this.countRest(c.uuid) < IDEAL_PAO_REST_COUNT && safety++ < IDEAL_PAO_REST_COUNT + 8) {
        const candidates = this.freeDaysForPao(c.uuid);
        if (candidates.length === 0) break;
        const picked = this.pickSpreadFolgaDay(c.uuid, candidates);
        this.lockDay(c.uuid, picked, "FOLGA");
      }
    }
  }

  /** Folgas somente em dias sem turno planejado (após cobertura). */
  allocatePaoRestDaysAfterCoverage(): void {
    if (this.allowsCommonFolgaAutoAllocation()) {
      for (const c of this.paoEmps) {
        let safety = 0;
        while (this.countRest(c.uuid) < IDEAL_PAO_REST_COUNT && safety++ < IDEAL_PAO_REST_COUNT + 5) {
          const candidates = this.freeDaysForPao(c.uuid);
          if (candidates.length === 0) break;
          const picked = this.pickSpreadFolgaDay(c.uuid, candidates);
          this.lockDay(c.uuid, picked, "FOLGA");
        }

        while (this.countRest(c.uuid) > MAX_PAO_REST_COUNT) {
          const folga = this.allocations.filter((a) => a.employeeUuid === c.uuid && a.label === "FOLGA");
          if (folga.length === 0) break;
          const rem = folga[folga.length - 1];
          const did = this.uuidToDomain.get(c.uuid)!;
          this.blocked.delete(assignmentKey(did, rem.date));
          this.allocations.splice(this.allocations.indexOf(rem), 1);
          this.coverageGapsCache = null;
        }
      }
    }

    this.promotePaoWeekendPairsToFolgaSocial();
  }

  /** Completa pares T8/T8 + ND sem remover cobertura existente. */
  reconcileT8BlocksAfterCoverage(): void {
    for (const c of this.paoEmps) {
      const did = c.domainId;
      const t8Days = this.days.filter((d) => this.planned.get(assignmentKey(did, d)) === "T8");

      for (const d of t8Days) {
        const d2 = addDays(d, 1);
        const d3 = addDays(d, 2);
        if (!this.days.includes(d2) || !this.days.includes(d3)) continue;
        if (this.planned.get(assignmentKey(did, d2)) === "T8") {
          const hasNd =
            this.allocations.some((a) => a.employeeUuid === c.uuid && a.date === d3 && a.label === "ND") ||
            this.blocked.get(assignmentKey(did, d3)) === "ND";
          if (!hasNd && !this.planned.has(assignmentKey(did, d3))) {
            this.lockDay(c.uuid, d3, "ND");
          }
          continue;
        }
        if (!this.planned.has(assignmentKey(did, d2)) && !this.blocked.has(assignmentKey(did, d2))) {
          if (this.tryAssignShift(c.uuid, d2, "T8")) {
            this.lockDay(c.uuid, d3, "ND");
          }
        }
      }

      const hasBlock = t8Days.some((d) => {
        const d2 = addDays(d, 1);
        return this.planned.get(assignmentKey(did, d2)) === "T8";
      });
      if (hasBlock) continue;

      for (const day of this.days) {
        const d2 = addDays(day, 1);
        const d3 = addDays(day, 2);
        if (!this.days.includes(d2) || !this.days.includes(d3)) continue;
        if (
          this.blocked.has(assignmentKey(did, day)) ||
          this.blocked.has(assignmentKey(did, d2)) ||
          this.blocked.has(assignmentKey(did, d3))
        ) {
          continue;
        }
        if (this.planned.has(assignmentKey(did, day)) || this.planned.has(assignmentKey(did, d2))) {
          continue;
        }
        if (this.tryAssignShift(c.uuid, day, "T8") && this.tryAssignShift(c.uuid, d2, "T8")) {
          this.lockDay(c.uuid, d3, "ND");
          break;
        }
        this.planned.delete(assignmentKey(did, day));
        this.planned.delete(assignmentKey(did, d2));
      }
    }
    this.coverageGapsCache = null;
  }

  countRest(uuid: string): number {
    return this.allocations.filter(
      (a) => a.employeeUuid === uuid && GENERATOR_REST_LABELS.has(a.label),
    ).length;
  }

  needsMoreFolgas(uuid: string): boolean {
    return this.countRest(uuid) < IDEAL_PAO_REST_COUNT;
  }

  canAddFolga(uuid: string): boolean {
    return this.countRest(uuid) < MAX_PAO_REST_COUNT;
  }

  /** Dia faz parte de bloco T8/T8 ou ND subsequente — não alterar. */
  isT8BlockProtected(uuid: string, day: string): boolean {
    const did = this.uuidToDomain.get(uuid);
    if (!did) return false;
    const code = this.shiftOnDay(did, day);
    if (code === "T8") {
      const prev = addDays(day, -1);
      const next = addDays(day, 1);
      const prevT8 = this.shiftOnDay(did, prev) === "T8";
      const nextT8 = this.shiftOnDay(did, next) === "T8";
      if (prevT8 || nextT8) return true;
    }
    const ndLabel =
      this.blocked.get(assignmentKey(did, day)) ??
      this.historyBlocked.get(assignmentKey(did, day));
    if (ndLabel === "ND") {
      const d1 = addDays(day, -2);
      const d2 = addDays(day, -1);
      return this.shiftOnDay(did, d1) === "T8" && this.shiftOnDay(did, d2) === "T8";
    }
    return false;
  }

  countNd(uuid: string): number {
    return this.allocations.filter((a) => a.employeeUuid === uuid && a.label === "ND").length;
  }

  /** Remove uma folga gerada (não protegida) para liberar o dia. */
  releaseOneGeneratorFolga(uuid: string, preferNear?: string): boolean {
    const folgas = this.allocations.filter(
      (a) =>
        a.employeeUuid === uuid &&
        a.label === "FOLGA" &&
        !this.isLockedByAdmin(uuid, a.date),
    );
    if (folgas.length === 0) return false;

    let target = folgas[0];
    if (preferNear) {
      const sorted = [...folgas].sort(
        (a, b) =>
          Math.abs(this.days.indexOf(a.date) - this.days.indexOf(preferNear)) -
          Math.abs(this.days.indexOf(b.date) - this.days.indexOf(preferNear)),
      );
      target = sorted[0];
    }

    const did = this.uuidToDomain.get(uuid)!;
    this.blocked.delete(assignmentKey(did, target.date));
    const idx = this.allocations.indexOf(target);
    if (idx >= 0) this.allocations.splice(idx, 1);
    this.coverageGapsCache = null;
    return true;
  }

  /** Remove ND gerado se não faz parte de bloco T8/T8 ativo. */
  releaseGeneratorNd(uuid: string, day: string): boolean {
    if (isNdOverrideProtected(this, uuid, day)) return false;
    const did = this.uuidToDomain.get(uuid)!;
    const d1 = addDays(day, -2);
    const d2 = addDays(day, -1);
    const block = this.shiftOnDay(did, d1) === "T8" && this.shiftOnDay(did, d2) === "T8";
    if (block) return false;

    const idx = this.allocations.findIndex(
      (a) => a.employeeUuid === uuid && a.date === day && a.label === "ND",
    );
    if (idx < 0) return false;
    this.blocked.delete(assignmentKey(did, day));
    this.allocations.splice(idx, 1);
    this.coverageGapsCache = null;
    return true;
  }

  /**
   * Reserva 10 folgas em dias livres antes da cobertura (PAO em férias parciais).
   */
  preallocatePaoFolgasBeforeCoverage(): void {
    for (const c of this.paoEmps) {
      const did = this.uuidToDomain.get(c.uuid)!;
      const candidates = this.days.filter(
        (d) =>
          !this.blocked.has(assignmentKey(did, d)) && !this.planned.has(assignmentKey(did, d)),
      );
      const blockedInMonth = this.days.length - candidates.length;
      if (blockedInMonth < 5) continue;
      if (candidates.length < IDEAL_PAO_REST_COUNT) continue;

      let safety = 0;
      for (const d of candidates) {
        if (this.countRest(c.uuid) >= IDEAL_PAO_REST_COUNT) break;
        if (safety++ > candidates.length + 2) break;
        if (this.blocked.has(assignmentKey(did, d))) continue;
        this.lockDay(c.uuid, d, "FOLGA");
      }
    }
    this.coverageGapsCache = null;
  }

  /** Limite de turnos só para PAO com muitos bloqueios operacionais (ex.: férias parciais). */
  maxWorkDaysForPao(uuid: string): number | null {
    const did = this.uuidToDomain.get(uuid)!;
    let hardBlocked = 0;
    for (const day of this.days) {
      const label = this.blocked.get(assignmentKey(did, day));
      if (!label) continue;
      if (GENERATOR_REST_LABELS.has(label) || label === "ND") continue;
      if (isOperationalHardBlock(label) || VACATION_TYPES.has(label.toUpperCase())) {
        hardBlocked++;
      }
    }
    if (hardBlocked < 5) return null;
    const free = this.days.filter((d) => !this.blocked.has(assignmentKey(did, d))).length;
    return Math.max(0, free - IDEAL_PAO_REST_COUNT);
  }

  applyHardBlocks(): void {
    const lastVacationByEmployee = new Map<string, string>();
    for (const v of this.input.vacationDays) {
      this.lockDay(v.employeeUuid, v.date, "FÉRIAS");
      const prev = lastVacationByEmployee.get(v.employeeUuid);
      if (!prev || v.date > prev) lastVacationByEmployee.set(v.employeeUuid, v.date);
    }
    if (this.allowsCommonFolgaAutoAllocation()) {
      for (const ret of this.input.vacationReturnDays ?? []) {
        const did = this.uuidToDomain.get(ret.employeeUuid);
        if (!did || !this.days.includes(ret.date)) continue;
        if (this.blocked.has(assignmentKey(did, ret.date))) continue;
        this.lockDay(ret.employeeUuid, ret.date, "FOLGA");
      }
      for (const [uuid, lastDay] of lastVacationByEmployee) {
        const returnDay = addDays(lastDay, 1);
        if (!this.days.includes(returnDay)) continue;
        const did = this.uuidToDomain.get(uuid);
        if (!did || this.blocked.has(assignmentKey(did, returnDay))) continue;
        this.lockDay(uuid, returnDay, "FOLGA");
      }
    }
    for (const fp of this.input.approvedDayOff) {
      this.lockDay(fp.employeeUuid, fp.date, "FOLGA PEDIDA");
    }
    for (const f of this.input.flightDays) {
      this.lockDay(f.employeeUuid, f.date, "VOO");
    }
    for (const la of this.input.lockedAllocations) {
      const label = normalizeOperationalLabel(la.label);
      const times =
        la.startTime && la.endTime && label.toUpperCase().includes("SIMULADOR")
          ? { startTime: la.startTime, endTime: la.endTime }
          : undefined;
      this.lockDay(la.employeeUuid, la.date, label, true, times);
    }
    this.applyBirthdayFolgas();
    this.applyPostFaniRestDays();
  }

  private blockLabelOnDay(did: number, day: string): string | undefined {
    const key = assignmentKey(did, day);
    return this.blocked.get(key) ?? this.historyBlocked.get(key);
  }

  /** Folga automática de aniversário (FANI) — após bloqueios de maior prioridade. */
  applyBirthdayFolgas(): void {
    for (const ge of this.input.employees) {
      const day = birthdayInMonth(ge.employee.birthDate, this.input.year, this.input.month);
      if (!day) continue;

      const did = this.uuidToDomain.get(ge.uuid);
      if (!did) continue;

      const existing = this.blockLabelOnDay(did, day);
      if (existing) {
        if (existing !== FANI_LABEL) {
          this.birthdayWarnings.push({
            severity: "MÉDIA",
            level: "WARNING",
            type: "FANI CONFLITO",
            date: day,
            employee: ge.employee.name,
            detail: `Aniversário em ${day} não gerou FANI — dia bloqueado por ${existing}.`,
          });
        }
        continue;
      }

      this.lockDay(ge.uuid, day, FANI_LABEL);
    }
  }

  /** Folga obrigatória no dia seguinte a FANI (continuidade entre meses). */
  applyPostFaniRestDays(): void {
    if (!this.allowsCommonFolgaAutoAllocation()) return;
    for (const ge of this.input.employees) {
      const did = this.uuidToDomain.get(ge.uuid);
      if (!did) continue;

      for (const day of this.days) {
        const prev = addDays(day, -1);
        if (this.blockLabelOnDay(did, prev) !== FANI_LABEL) continue;
        const key = assignmentKey(did, day);
        if (this.blocked.has(key)) continue;
        this.lockDay(ge.uuid, day, "FOLGA");
      }
    }
  }

  /** Bloqueios operacionais aplicados antes da cobertura automática. */
  operationalBlockCount(): number {
    return this.allocations.filter((a) => isOperationalHardBlock(a.label)).length;
  }

  /**
   * Planeja blocos T8/T8/ND rotacionando PAOs — somente blocos completos (ND pode ser cross-month).
   */
  planT8CoverageRotating(): void {
    if (this.paoEmps.length === 0) return;

    let blockIndex = 0;
    for (let i = 0; i < this.days.length; ) {
      const d0 = this.days[i];
      const order = sortPaoByAssignedTurnBalance(this);

      let placed = false;
      for (let attempt = 0; attempt < order.length; attempt++) {
        const c = order[(blockIndex + attempt) % order.length];
        if (this.tryPlaceT8Block(c.uuid, d0)) {
          blockIndex++;
          placed = true;
          const d1 = addDays(d0, 1);
          const nextIdx = this.days.indexOf(d1);
          i = nextIdx >= 0 ? nextIdx + 1 : i + 1;
          break;
        }
      }
      if (!placed) {
        blockIndex++;
        i++;
      }
    }
    this.coverageGapsCache = null;
  }

  /** @deprecated Prefer planT8CoverageRotating */
  planT8BlocksSequenced(): void {
    let cursor = 0;
    for (const c of this.paoEmps) {
      let placed = false;
      while (cursor <= this.days.length - 3) {
        const d0 = this.days[cursor];
        const d1 = this.days[cursor + 1];
        const d2 = this.days[cursor + 2];
        const did = c.domainId;

        if (
          this.blocked.has(assignmentKey(did, d0)) ||
          this.blocked.has(assignmentKey(did, d1)) ||
          this.blocked.has(assignmentKey(did, d2)) ||
          this.planned.has(assignmentKey(did, d0)) ||
          this.planned.has(assignmentKey(did, d1))
        ) {
          cursor++;
          continue;
        }

        if (this.tryAssignShift(c.uuid, d0, "T8") && this.tryAssignShift(c.uuid, d1, "T8")) {
          this.lockDay(c.uuid, d2, "ND");
          this.t8BlockComplete.add(c.uuid);
          cursor += 3;
          placed = true;
          break;
        }
        this.planned.delete(assignmentKey(did, d0));
        this.planned.delete(assignmentKey(did, d1));
        cursor++;
      }
      if (!placed) cursor = Math.min(cursor + 1, this.days.length - 1);
    }
    this.coverageGapsCache = null;
  }

  ensureNdForT8Pairs(): void {
    for (const c of this.paoEmps) {
      const did = c.domainId;
      for (const ndDay of this.days) {
        const d2 = addDays(ndDay, -1);
        const d1 = addDays(ndDay, -2);
        if (this.shiftOnDay(did, d1) !== "T8" || this.shiftOnDay(did, d2) !== "T8") continue;

        if (isNdPlacementBlocked(this, c.uuid, ndDay)) continue;

        clearNdDayConflicts(this, c.uuid, ndDay);

        if (!hasNdOnGrid(this, c.uuid, ndDay)) {
          this.lockDay(c.uuid, ndDay, "ND");
        }
      }
    }
    this.coverageGapsCache = null;
  }

  /** T9/paralelo no dia ND após T8/T8 — remove turno conflitante e garante ND. */
  reconcileNdAfterParallelShifts(): void {
    for (const c of this.paoEmps) {
      const did = c.domainId;
      for (const day of this.days) {
        const d2 = addDays(day, 1);
        if (!this.days.includes(d2)) continue;
        if (this.shiftOnDay(did, day) !== "T8" || this.shiftOnDay(did, d2) !== "T8") continue;
        const ndDay = addDays(d2, 1);
        if (!this.days.includes(ndDay)) continue;
        if (isNdPlacementBlocked(this, c.uuid, ndDay)) continue;
        clearNdDayConflicts(this, c.uuid, ndDay);
      }
    }
    this.ensureNdForT8Pairs();
  }

  /** Remove T8 isolado — não recria turno sem bloco válido. */
  repairIsolatedT8(): void {
    for (const c of this.paoEmps) {
      const did = c.domainId;
      for (const day of this.days) {
        if (this.shiftOnDay(did, day) !== "T8") continue;
        const prev = addDays(day, -1);
        const next = addDays(day, 1);
        const prevT8 = this.shiftOnDay(did, prev) === "T8";
        const nextT8 = this.shiftOnDay(did, next) === "T8";
        if (!prevT8 && !nextT8) {
          if (this.isEmergencyIsolatedT8(c.uuid, day)) continue;
          this.unassignShift(c.uuid, day);
        }
      }
    }
    this.coverageGapsCache = null;
  }

  planT8Blocks(): void {
    for (const c of this.paoEmps) {
      const did = c.domainId;
      const hasT8 = [...this.planned.entries()].some(
        ([k, sh]) => k.startsWith(`${did}|`) && sh === "T8",
      );
      if (hasT8) continue;

      for (const day of this.days) {
        const d2 = addDays(day, 1);
        const d3 = addDays(day, 2);
        if (!this.days.includes(d2) || !this.days.includes(d3)) continue;

        if (
          this.blocked.has(assignmentKey(did, day)) ||
          this.blocked.has(assignmentKey(did, d2)) ||
          this.blocked.has(assignmentKey(did, d3))
        ) {
          continue;
        }
        if (this.planned.has(assignmentKey(did, day)) || this.planned.has(assignmentKey(did, d2))) {
          continue;
        }

        if (this.tryAssignShift(c.uuid, day, "T8") && this.tryAssignShift(c.uuid, d2, "T8")) {
          this.lockDay(c.uuid, d3, "ND");
          break;
        }
        this.planned.delete(assignmentKey(did, day));
        this.planned.delete(assignmentKey(did, d2));
      }
    }
  }

  reservePaoRestDays(): void {
    for (const c of this.paoEmps) {
      let safety = 0;
      while (this.countRest(c.uuid) < IDEAL_PAO_REST_COUNT && safety++ < IDEAL_PAO_REST_COUNT + 5) {
        const candidates = this.days.filter((d) => {
          const did = this.uuidToDomain.get(c.uuid)!;
          if (this.blocked.has(assignmentKey(did, d)) || this.planned.has(assignmentKey(did, d))) {
            return false;
          }
          if (VACATION_TYPES.has(this.blocked.get(assignmentKey(did, d)) ?? "")) return false;
          return true;
        });
        if (candidates.length === 0) break;

        let picked = candidates[0];
        for (const d of candidates) {
          const prev = addDays(d, -1);
          const next = addDays(d, 1);
          const pair =
            this.allocations.some(
              (a) => a.employeeUuid === c.uuid && a.date === prev && GENERATOR_REST_LABELS.has(a.label),
            ) ||
            this.allocations.some(
              (a) => a.employeeUuid === c.uuid && a.date === next && GENERATOR_REST_LABELS.has(a.label),
            );
          if (pair) {
            picked = d;
            break;
          }
        }
        this.lockDay(c.uuid, picked, "FOLGA");
      }

      while (this.countRest(c.uuid) > MAX_PAO_REST_COUNT) {
        const folga = this.allocations.filter((a) => a.employeeUuid === c.uuid && a.label === "FOLGA");
        if (folga.length === 0) break;
        const rem = folga[folga.length - 1];
        const did = this.uuidToDomain.get(c.uuid)!;
        this.blocked.delete(assignmentKey(did, rem.date));
        this.allocations.splice(this.allocations.indexOf(rem), 1);
      }
    }

    for (const c of this.paoEmps) {
      for (const day of this.days) {
        if (weekday(day) !== 6) continue;
        const dom = addDays(day, 1);
        if (!this.days.includes(dom)) continue;
        const satF = this.allocations.find(
          (a) => a.employeeUuid === c.uuid && a.date === day && GENERATOR_REST_LABELS.has(a.label),
        );
        const domF = this.allocations.find(
          (a) => a.employeeUuid === c.uuid && a.date === dom && GENERATOR_REST_LABELS.has(a.label),
        );
        if (satF && domF) {
          satF.label = "FOLGA SOCIAL";
          domF.label = "FOLGA SOCIAL";
          const did = this.uuidToDomain.get(c.uuid)!;
          this.blocked.set(assignmentKey(did, day), "FOLGA SOCIAL");
          this.blocked.set(assignmentKey(did, dom), "FOLGA SOCIAL");
          break;
        }
      }
    }
  }

  coverPaoShifts(shiftCodes: readonly string[] = PAO_COVERAGE_SHIFTS): number {
    let gaps = 0;
    for (const day of this.days) {
      for (const code of shiftCodes) {
        if (this.hasPaoCoverage(day, code)) continue;

        const candidates = sortPaoByAssignedTurnBalance(this);
        let placed = false;
        for (const c of candidates) {
          if (
            this.tryAssignShift(c.uuid, day, code) ||
            this.tryAssignShift(c.uuid, day, code, true)
          ) {
            placed = true;
            break;
          }
        }
        if (!placed) gaps++;
      }
    }
    return gaps;
  }

  finalizePaoFolgaCounts(): void {
    for (const c of this.paoEmps) {
      while (this.countRest(c.uuid) > MAX_PAO_REST_COUNT) {
        const folga = this.allocations.filter(
          (a) =>
            a.employeeUuid === c.uuid &&
            a.label === "FOLGA" &&
            !this.isLockedByAdmin(c.uuid, a.date),
        );
        if (folga.length === 0) break;
        const rem = folga[folga.length - 1];
        const did = this.uuidToDomain.get(c.uuid)!;
        this.blocked.delete(assignmentKey(did, rem.date));
        this.allocations.splice(this.allocations.indexOf(rem), 1);
      }

      if (this.allowsCommonFolgaAutoAllocation()) {
        let safety = 0;
        while (this.countRest(c.uuid) < IDEAL_PAO_REST_COUNT && safety++ < 30) {
          const did = c.domainId;
          const workDays = this.days.filter((d) => {
            const code = this.planned.get(assignmentKey(did, d));
            return code === "T6" || code === "T7";
          });
          let freed = false;
          const spreadWorkDays = [...workDays].sort(
            (a, b) => this.days.indexOf(b) - this.days.indexOf(a),
          );
          for (const d of spreadWorkDays) {
            const code = this.planned.get(assignmentKey(did, d))!;
            if (!this.canRemoveAssignment(c.uuid, d, code)) continue;
            this.unassignShift(c.uuid, d);
            this.lockDay(c.uuid, d, "FOLGA");
            freed = true;
            break;
          }
          if (!freed) break;
        }
      }
    }
    this.coverageGapsCache = null;
  }

  ensureExactTenFolgasPerPao(): void {
    if (!this.allowsCommonFolgaAutoAllocation()) return;
    for (const c of this.paoEmps) {
      let safety = 0;
      while (this.countRest(c.uuid) < IDEAL_PAO_REST_COUNT && safety++ < 40) {
        const empty = this.emptyDaysForPao(c.uuid);
        const picked = this.pickFolgaBlockDay(c.uuid, empty);
        if (picked && this.tryAssignFolgaOnDay(c.uuid, picked)) continue;
        if (this.tryAssignFolgaBlock(c.uuid, 4)) continue;
        if (this.tryAssignFolgaBlock(c.uuid, 3)) continue;
        if (this.tryAssignFolgaBlock(c.uuid, 2)) continue;
        if (this.freeWorkDaysForFolgaBlock(c.uuid, 2)) continue;
        if (this.freeWorkDaysForFolgaBlock(c.uuid, 1)) continue;
        break;
      }
    }
    this.coverageGapsCache = null;
  }

  private canRemoveAssignment(uuid: string, day: string, shiftCode: string): boolean {
    if (this.isT8BlockProtected(uuid, day)) return false;
    const did = this.uuidToDomain.get(uuid)!;
    this.planned.delete(assignmentKey(did, day));
    const gap = !this.hasPaoCoverage(day, shiftCode);
    if (!gap) {
      this.planned.set(assignmentKey(did, day), shiftCode);
      return true;
    }
    for (const other of this.paoEmps) {
      if (other.uuid === uuid) continue;
      if (this.tryAssignShift(other.uuid, day, shiftCode)) {
        return true;
      }
    }
    this.planned.set(assignmentKey(did, day), shiftCode);
    return false;
  }

  private apaoCountOnDay(day: string): number {
    return [...this.planned.entries()].filter(
      ([k]) =>
        k.endsWith(`|${day}`) && this.roleByDomain.get(Number(k.split("|")[0])) === "APAO",
    ).length;
  }

  private consecutiveWorkDays(uuid: string, day: string): number {
    const did = this.uuidToDomain.get(uuid)!;
    return consecutiveWorkCount(
      did,
      day,
      this.mergedPlannedForContinuity(),
      this.mergedBlockedForContinuity(),
    );
  }

  private workedPreviousDay(uuid: string, day: string): boolean {
    const did = this.uuidToDomain.get(uuid)!;
    const prev = addDays(day, -1);
    if (this.shiftOnDay(did, prev) !== undefined) return true;
    return isProductiveWorkAllocationLabel(this.blockLabelOnDay(did, prev));
  }

  /** Turnos APAO ativos cadastrados (APAO ou BOTH), em ordem operacional. */
  activeApaoShiftCodes(): string[] {
    const fallback = ["T2", "T3", "T4", "T1"];
    const fromInput = this.input.shifts
      .filter((s) => s.active !== false && (s.role === "APAO" || s.role === "BOTH"))
      .map((s) => s.code.toUpperCase());
    const codes =
      fromInput.length > 0
        ? fromInput
        : Object.entries(this.shiftMap)
            .filter(([, info]) => info.role === "APAO" || info.role === "BOTH")
            .map(([code]) => code.toUpperCase());
    if (codes.length === 0) return fallback;
    return [...codes].sort((a, b) => {
      const ia = fallback.indexOf(a);
      const ib = fallback.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
  }

  private apaoShiftCount(uuid: string, code: string): number {
    const did = this.uuidToDomain.get(uuid)!;
    let n = 0;
    for (const day of this.days) {
      if (this.planned.get(assignmentKey(did, day)) === code) n++;
    }
    return n;
  }

  isApaoDayEmpty(uuid: string, day: string): boolean {
    const did = this.uuidToDomain.get(uuid);
    if (!did) return false;
    return !this.planned.has(assignmentKey(did, day)) && !this.blocked.has(assignmentKey(did, day));
  }

  private apaoCanWorkOnDay(c: GenerationInputEmployee, day: string): boolean {
    if (this.consecutiveWorkDays(c.uuid, day) >= 6) return false;
    const continuity = this.mergedPlannedForContinuity();
    const continuityBlocked = this.mergedBlockedForContinuity();
    for (const code of this.activeApaoShiftCodes()) {
      if (
        canWork(c.employee, day, code, this.blocked, continuity, {
          ...this.canWorkOpts,
          continuityBlocked,
        }).ok
      ) {
        return true;
      }
    }
    return false;
  }

  private compareApaoForDay(
    a: GenerationInputEmployee,
    b: GenerationInputEmployee,
    day: string,
  ): number {
    const aContinue =
      this.workedPreviousDay(a.uuid, day) && this.consecutiveWorkDays(a.uuid, day) > 0;
    const bContinue =
      this.workedPreviousDay(b.uuid, day) && this.consecutiveWorkDays(b.uuid, day) > 0;

    if (aContinue && !bContinue) return -1;
    if (bContinue && !aContinue) return 1;

    if (aContinue && bContinue) {
      return (
        this.consecutiveWorkDays(b.uuid, day) - this.consecutiveWorkDays(a.uuid, day) ||
        this.workCount(a.uuid) - this.workCount(b.uuid)
      );
    }

    return (
      this.workCount(a.uuid) - this.workCount(b.uuid) ||
      a.employee.seniority - b.employee.seniority
    );
  }

  /** APAO em blocos 6x1 — continua bloco ativo; troca só após folga obrigatória. */
  assignApaoWithPao(): void {
    const apaoShiftPriority = this.activeApaoShiftCodes();
    for (const day of this.days) {
      if (!this.hasPaoCoverage(day, "T6")) continue;
      if (this.apaoCountOnDay(day) >= 1) continue;

      const candidates = this.apaoEmps
        .filter((c) => this.apaoCanWorkOnDay(c, day))
        .sort((a, b) => this.compareApaoForDay(a, b, day));

      for (const c of candidates) {
        const ordered = [...apaoShiftPriority].sort(
          (a, b) => this.apaoShiftCount(c.uuid, a) - this.apaoShiftCount(c.uuid, b),
        );
        for (const code of ordered) {
          if (this.tryAssignShift(c.uuid, day, code)) break;
        }
        if (this.apaoCountOnDay(day) >= 1) break;
      }
    }
  }

  /** Folga obrigatória APAO após 6 dias trabalhados (6x1). */
  allocateApaoRestDays(): void {
    if (!this.allowsAutoApaoRest()) return;
    for (const c of this.apaoEmps) {
      let workStreak = this.consecutiveDaysBeforeMonth(c.uuid);
      for (const day of this.days) {
        const did = c.domainId;
        const working = Boolean(this.planned.get(assignmentKey(did, day)));
        const resting = this.allocations.some(
          (a) =>
            a.employeeUuid === c.uuid &&
            a.date === day &&
            GENERATOR_REST_LABELS.has(a.label),
        );

        if (working) {
          workStreak++;
          if (workStreak >= 6) {
            for (let offset = 1; offset <= 2; offset++) {
              const restDay = addDays(day, offset);
              if (!this.days.includes(restDay)) continue;
              if (!this.isApaoDayEmpty(c.uuid, restDay)) continue;
              if (this.tryAssignApaoFolga(c.uuid, restDay)) {
                workStreak = 0;
                break;
              }
            }
          }
        } else if (resting) {
          workStreak = 0;
        } else if (workStreak >= 6 && this.isApaoDayEmpty(c.uuid, day)) {
          if (this.tryAssignApaoFolga(c.uuid, day)) workStreak = 0;
        }
      }
    }
    this.coverageGapsCache = null;
  }

  private tryAssignApaoFolga(uuid: string, day: string): boolean {
    if (!this.isApaoDayEmpty(uuid, day)) return false;
    if (weekday(day) === 6) {
      const dom = addDays(day, 1);
      if (
        this.days.includes(dom) &&
        this.isApaoDayEmpty(uuid, dom) &&
        !this.folgaAgrupadaTakenOnDate(day) &&
        !this.folgaAgrupadaTakenOnDate(dom)
      ) {
        this.lockDay(uuid, day, "FOLGA AGRUPADA");
        this.lockDay(uuid, dom, "FOLGA AGRUPADA");
        return true;
      }
    }
    if (weekday(day) === 0) {
      const sat = addDays(day, -1);
      if (
        this.days.includes(sat) &&
        this.isApaoDayEmpty(uuid, sat) &&
        !this.folgaAgrupadaTakenOnDate(sat) &&
        !this.folgaAgrupadaTakenOnDate(day)
      ) {
        this.lockDay(uuid, sat, "FOLGA AGRUPADA");
        this.lockDay(uuid, day, "FOLGA AGRUPADA");
        return true;
      }
      const mon = addDays(day, 1);
      if (
        this.days.includes(mon) &&
        this.isApaoDayEmpty(uuid, mon) &&
        !this.folgaAgrupadaTakenOnDate(day) &&
        !this.folgaAgrupadaTakenOnDate(mon)
      ) {
        this.lockDay(uuid, day, "FOLGA AGRUPADA");
        this.lockDay(uuid, mon, "FOLGA AGRUPADA");
        return true;
      }
    }
    if (!this.allowsCommonFolgaAutoAllocation()) return false;
    this.lockDay(uuid, day, "FOLGA");
    return true;
  }

  isPaoDayEmpty(uuid: string, day: string): boolean {
    const did = this.uuidToDomain.get(uuid);
    if (!did) return false;
    return !this.planned.has(assignmentKey(did, day)) && !this.blocked.has(assignmentKey(did, day));
  }

  emptyDaysForPao(uuid: string): string[] {
    return this.days.filter((d) => this.isPaoDayEmpty(uuid, d));
  }

  explainEmptyPaoDay(uuid: string, day: string): string {
    const emp = this.input.employees.find((e) => e.uuid === uuid)!.employee;
    const did = this.uuidToDomain.get(uuid)!;
    const reasons: string[] = [];

    if (this.countRest(uuid) < IDEAL_PAO_REST_COUNT) {
      return "faltam folgas para completar 10 — dia livre sem folga alocada";
    }

    for (const code of PAO_COVERAGE_SHIFTS) {
      const r = canWork(emp, day, code, this.blocked, this.planned, this.canWorkOpts);
      if (!r.ok) {
        reasons.push(`${code}: ${r.reason}`);
        continue;
      }
      const rest = has12hRest(did, day, code, this.planned, this.shiftMap);
      if (!rest.ok) reasons.push(`${code}: ${rest.reason}`);
    }

    const budget = this.workCount(uuid) + 1 + this.countNd(uuid) + IDEAL_PAO_REST_COUNT;
    if (budget > this.days.length) {
      reasons.push("cota mensal esgotada (turnos+ND+folgas)");
    }
    const maxWork = this.maxWorkDaysForPao(uuid);
    if (maxWork != null && this.workCount(uuid) >= maxWork) {
      reasons.push(`limite de ${maxWork} turnos (mês parcialmente bloqueado)`);
    }

    if (reasons.length === 0) {
      return "nenhuma opção válida após verificação de elegibilidade";
    }
    return reasons.slice(0, 3).join("; ");
  }

  private folgaRunLengthIfAdded(uuid: string, day: string): number {
    const restDates = new Set(this.restDatesFor(uuid));
    restDates.add(day);
    let run = 1;
    let d = addDays(day, -1);
    while (restDates.has(d)) {
      run++;
      d = addDays(d, -1);
    }
    d = addDays(day, 1);
    while (restDates.has(d)) {
      run++;
      d = addDays(d, 1);
    }
    return run;
  }

  private scoreFolgaCandidate(uuid: string, day: string): number {
    const restDates = new Set(this.restDatesFor(uuid));
    const did = this.uuidToDomain.get(uuid)!;
    const prev = addDays(day, -1);
    const next = addDays(day, 1);
    let score = 0;

    const runLen = this.folgaRunLengthIfAdded(uuid, day);
    if (runLen >= 4) score += 50;
    else if (runLen === 3) score += 38;
    else if (runLen === 2) score += 18;
    else score -= 45;

    if (restDates.has(prev) || restDates.has(next)) score += 12;
    if (restDates.has(addDays(day, -2)) || restDates.has(addDays(day, 2))) score += 5;

    const prevBusy =
      this.planned.has(assignmentKey(did, prev)) || this.blocked.has(assignmentKey(did, prev));
    const nextBusy =
      this.planned.has(assignmentKey(did, next)) || this.blocked.has(assignmentKey(did, next));
    if (!restDates.has(prev) && !restDates.has(next) && prevBusy && nextBusy) score -= 25;

    if (weekday(day) === 6 || weekday(day) === 0) score += 6;

    const restIdx = [...restDates].map((d) => this.days.indexOf(d)).filter((i) => i >= 0);
    const dayIdx = this.days.indexOf(day);
    if (restIdx.length > 0) {
      const minGap = Math.min(...restIdx.map((ri) => Math.abs(dayIdx - ri)));
      score += Math.min(minGap, 6);
    } else {
      score += dayIdx * 0.1;
    }
    return score;
  }

  private pickFolgaBlockDay(uuid: string, candidates: string[]): string | null {
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => this.scoreFolgaCandidate(uuid, b) - this.scoreFolgaCandidate(uuid, a))[0];
  }

  private folgaLabelForDay(uuid: string, day: string): string {
    if (weekday(day) === 6) {
      const dom = addDays(day, 1);
      if (this.days.includes(dom) && this.isPaoDayEmpty(uuid, dom)) {
        return "FOLGA SOCIAL";
      }
    }
    if (weekday(day) === 0) {
      const sat = addDays(day, -1);
      if (this.days.includes(sat) && this.isPaoDayEmpty(uuid, sat)) {
        return "FOLGA SOCIAL";
      }
    }
    return "FOLGA";
  }

  /** Remove ND órfão — não preenche com turno artificial. */
  cleanupOrphanNd(): void {
    for (const c of this.paoEmps) {
      for (const al of [...this.allocations].filter(
        (a) => a.employeeUuid === c.uuid && a.label === "ND",
      )) {
        this.releaseGeneratorNd(c.uuid, al.date);
      }
    }
    this.coverageGapsCache = null;
  }

  private tryAssignFolgaBlock(uuid: string, size: number): boolean {
    if (size < 2) return false;
    const empty = [...this.emptyDaysForPao(uuid)].sort(
      (a, b) => this.days.indexOf(a) - this.days.indexOf(b),
    );
    for (let i = 0; i <= empty.length - size; i++) {
      const block = empty.slice(i, i + size);
      let consecutive = true;
      for (let j = 1; j < block.length; j++) {
        if (addDays(block[j - 1], 1) !== block[j]) {
          consecutive = false;
          break;
        }
      }
      if (!consecutive) continue;
      const score = block.reduce((n, d) => n + this.scoreFolgaCandidate(uuid, d), 0);
      if (score < 0) continue;
      for (const d of block) {
        if (!this.isPaoDayEmpty(uuid, d)) return false;
      }
      for (const d of block) {
        this.lockDay(uuid, d, "FOLGA");
      }
      return true;
    }
    return false;
  }

  private freeWorkDaysForFolgaBlock(uuid: string, size: number): boolean {
    const did = this.uuidToDomain.get(uuid)!;
    const workDays = this.days.filter((d) => {
      const code = this.planned.get(assignmentKey(did, d));
      return code === "T6" || code === "T7";
    });
    for (let i = 0; i <= workDays.length - size; i++) {
      const block = workDays.slice(i, i + size);
      let consecutive = true;
      for (let j = 1; j < block.length; j++) {
        if (addDays(block[j - 1], 1) !== block[j]) {
          consecutive = false;
          break;
        }
      }
      if (!consecutive) continue;
      const codes = block.map((d) => this.planned.get(assignmentKey(did, d))!);
      if (!codes.every((c) => c === "T6" || c === "T7")) continue;
      let ok = true;
      for (let j = 0; j < block.length; j++) {
        if (!this.canRemoveAssignment(uuid, block[j], codes[j])) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (let j = 0; j < block.length; j++) {
        this.unassignShift(uuid, block[j]);
        this.lockDay(uuid, block[j], "FOLGA");
      }
      return true;
    }
    return false;
  }

  private tryAssignNextFolga(uuid: string): boolean {
    if (!this.allowsCommonFolgaAutoAllocation()) return false;
    const empty = this.emptyDaysForPao(uuid);
    const picked = this.pickFolgaBlockDay(uuid, empty);
    if (picked && this.tryAssignFolgaOnDay(uuid, picked)) return true;
    if (this.tryAssignFolgaBlock(uuid, 4)) return true;
    if (this.tryAssignFolgaBlock(uuid, 3)) return true;
    if (this.tryAssignFolgaBlock(uuid, 2)) return true;
    return false;
  }

  private tryAssignFolgaOnDay(uuid: string, day: string): boolean {
    const label = this.folgaLabelForDay(uuid, day);
    if (label === "FOLGA SOCIAL") {
      const sat = weekday(day) === 6 ? day : addDays(day, -1);
      const dom = addDays(sat, 1);
      if (!this.isPaoDayEmpty(uuid, sat) || !this.isPaoDayEmpty(uuid, dom)) return false;
      this.lockDay(uuid, sat, "FOLGA SOCIAL");
      this.lockDay(uuid, dom, "FOLGA SOCIAL");
      return true;
    }
    if (!this.allowsCommonFolgaAutoAllocation()) return false;
    this.lockDay(uuid, day, "FOLGA");
    return true;
  }

  /** Aloca folgas faltantes em dias disponíveis; não preenche disponível com turno. */
  fillUnclassifiedPaoDays(): void {
    if (!this.allowsCommonFolgaAutoAllocation()) return;
    for (const c of this.paoEmps) {
      while (this.needsMoreFolgas(c.uuid) && this.canAddFolga(c.uuid)) {
        if (!this.tryAssignNextFolga(c.uuid)) break;
      }
    }
  }

  /**
   * Completa agenda PAO: cobertura T6/T7 + folgas (T8 só via bloco planejado).
   * Dias disponíveis permanecem livres para voo.
   */
  completePaoAgenda(): void {
    let progress = true;
    let safety = 0;

    while (progress && safety++ < 12) {
      progress = false;

      for (const day of this.days) {
        for (const code of ["T6", "T7"] as const) {
          if (this.hasPaoCoverage(day, code)) continue;
          const candidates = [...this.paoEmps]
            .filter((c) => this.isPaoDayEmpty(c.uuid, day))
            .filter((c) => !wouldExceedT6T7BlockMax(this, c.uuid, day, code))
            .sort(
              (a, b) =>
                this.workCount(a.uuid) - this.workCount(b.uuid) ||
                a.employee.seniority - b.employee.seniority,
            );
          for (const c of candidates) {
            if (this.tryAssignShift(c.uuid, day, code)) {
              progress = true;
              break;
            }
          }
        }
      }

      if (this.allowsCommonFolgaAutoAllocation()) {
        for (const c of this.paoEmps) {
          while (this.needsMoreFolgas(c.uuid) && this.canAddFolga(c.uuid)) {
            if (!this.tryAssignNextFolga(c.uuid)) break;
            progress = true;
          }
        }
      }
    }

    if (this.allowsCommonFolgaAutoAllocation()) {
      for (const c of this.paoEmps) {
        if (this.needsMoreFolgas(c.uuid) && this.canAddFolga(c.uuid)) {
          this.tryAssignNextFolga(c.uuid);
        }
      }
    }

    this.coverageGapsCache = null;
  }

  /** APAO não pode ter dia vazio — turno ativo ou folga/bloqueio. */
  completeApaoAgenda(): void {
    for (const day of this.days) {
      for (const c of this.apaoEmps) {
        if (!this.isApaoDayEmpty(c.uuid, day)) continue;
        if (this.hasPaoCoverage(day, "T6") && this.apaoCanWorkOnDay(c, day)) {
          const codes = this.activeApaoShiftCodes();
          for (const code of codes) {
            if (this.tryAssignShift(c.uuid, day, code)) break;
          }
        }
        if (this.isApaoDayEmpty(c.uuid, day)) {
          if (!this.allowsAutoApaoRest()) continue;
          if (!this.tryAssignApaoFolga(c.uuid, day) && this.allowsCommonFolgaAutoAllocation()) {
            this.lockDay(c.uuid, day, "FOLGA");
          }
        }
      }
    }
    this.coverageGapsCache = null;
  }

  /** Garante APAO 6x1 — remove 7º turno consecutivo e insere folga. */
  enforceApaoSixByOne(): void {
    for (const c of this.apaoEmps) {
      const did = c.domainId;
      for (const day of this.days) {
        if (this.planned.get(assignmentKey(did, day)) !== undefined) {
          const before = consecutiveWorkCount(
            did,
            day,
            this.mergedPlannedForContinuity(),
            this.mergedBlockedForContinuity(),
          );
          if (before >= 6) {
            this.unassignShift(c.uuid, day);
            if (this.isApaoDayEmpty(c.uuid, day) && this.allowsAutoApaoRest()) {
              if (!this.tryAssignApaoFolga(c.uuid, day) && this.allowsCommonFolgaAutoAllocation()) {
                this.lockDay(c.uuid, day, "FOLGA");
              }
            }
          }
        }
      }
    }
    this.coverageGapsCache = null;
  }

  /** Carrega turnos já persistidos (pós-geração) no workspace. */
  seedAssignments(rows: GeneratedAssignment[]): void {
    for (const a of rows) {
      const did = this.uuidToDomain.get(a.employeeUuid);
      if (!did) continue;
      this.planned.set(assignmentKey(did, a.date), a.shiftCode);
    }
    this.coverageGapsCache = null;
  }

  /** Aplica VOO nos dias disponíveis dos PAOs (não sobrescreve bloqueios). */
  applyFlightsToAvailablePaoDays(): GeneratedAllocation[] {
    const created: GeneratedAllocation[] = [];
    for (const c of this.paoEmps) {
      for (const day of this.days) {
        if (this.isNoFlightDay(c.uuid, day)) continue;
        const did = this.uuidToDomain.get(c.uuid)!;
        const hasAssignment = this.planned.has(assignmentKey(did, day));
        const hasAllocation = this.allocations.some((a) => a.employeeUuid === c.uuid && a.date === day);
        if (hasAssignment || hasAllocation) continue;
        this.lockDay(c.uuid, day, "VOO");
        created.push({ employeeUuid: c.uuid, date: day, label: "VOO" });
      }
    }
    this.coverageGapsCache = null;
    return created;
  }

  listAvailableForFlight(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const c of this.paoEmps) {
      out.set(c.uuid, this.emptyDaysForPao(c.uuid));
    }
    return out;
  }

  /** VOO pré-cadastrado no input — não removível pelo balanceador. */
  isInputFlightDay(uuid: string, day: string): boolean {
    return this.input.flightDays.some((f) => f.employeeUuid === uuid && f.date === day);
  }

  /** Remove VOO gerado pelo motor (não input/admin). */
  tryRemoveMotorVoo(uuid: string, day: string): boolean {
    if (this.isInputFlightDay(uuid, day)) return false;
    if (
      this.input.lockedAllocations.some(
        (l) =>
          l.employeeUuid === uuid &&
          l.date === day &&
          normalizeOperationalLabel(l.label).toUpperCase() === "VOO",
      )
    ) {
      return false;
    }
    const idx = this.allocations.findIndex(
      (a) =>
        a.employeeUuid === uuid &&
        a.date === day &&
        normalizeOperationalLabel(a.label).toUpperCase() === "VOO",
    );
    if (idx < 0) return false;
    this.allocations.splice(idx, 1);
    const did = this.uuidToDomain.get(uuid)!;
    const key = assignmentKey(did, day);
    if (normalizeOperationalLabel(this.blocked.get(key) ?? "").toUpperCase() === "VOO") {
      this.blocked.delete(key);
    }
    this.coverageGapsCache = null;
    return true;
  }

  /** Realoca VOO motor para PAO elegível no mesmo dia. */
  tryRelocateMotorVoo(fromUuid: string, day: string): boolean {
    if (this.isInputFlightDay(fromUuid, day)) return false;
    if (
      !this.allocations.some(
        (a) =>
          a.employeeUuid === fromUuid &&
          a.date === day &&
          normalizeOperationalLabel(a.label).toUpperCase() === "VOO",
      )
    ) {
      return false;
    }
    const dayIndex = Math.max(0, this.days.indexOf(day));
    for (const other of sortPaoByOperationalPriority(this, dayIndex)) {
      if (other.uuid === fromUuid) continue;
      if (this.isNoFlightDay(other.uuid, day)) continue;
      if (!this.isPaoDayEmpty(other.uuid, day)) continue;
      if (this.isInputFlightDay(other.uuid, day)) continue;
      if (!this.tryRemoveMotorVoo(fromUuid, day)) return false;
      this.lockDay(other.uuid, day, "VOO");
      return true;
    }
    return false;
  }

  /** Remove turno T6/T7 preservando cobertura (não toca T8/ND). */
  tryRemoveShiftPreservingCoverage(uuid: string, day: string): boolean {
    const did = this.uuidToDomain.get(uuid);
    if (!did) return false;
    const code = this.planned.get(assignmentKey(did, day));
    if (!code || code === "T8") return false;
    if (this.isT8BlockProtected(uuid, day)) return false;

    if (this.rateioContext) {
      recordRateioUnassignment(this.rateioContext, uuid, code);
    }
    this.planned.delete(assignmentKey(did, day));
    if (this.hasPaoCoverage(day, code)) {
      this.coverageGapsCache = null;
      return true;
    }

    const ctx = this.rateioContext;
    const substitutes = [...this.paoEmps]
      .filter((c) => c.uuid !== uuid)
      .sort((a, b) => {
        if (ctx) {
          const curA = ctx.currentTurnCounts.get(a.uuid) ?? 0;
          const curB = ctx.currentTurnCounts.get(b.uuid) ?? 0;
          if (curA !== curB) return curA - curB;
        }
        return (
          maxConsecutiveWorkDays(workDatesFromWorkspace(this, a.uuid)) -
            maxConsecutiveWorkDays(workDatesFromWorkspace(this, b.uuid)) ||
          this.workCount(a.uuid) - this.workCount(b.uuid) ||
          a.employee.seniority - b.employee.seniority
        );
      });

    for (const other of substitutes) {
      if (this.wouldExceedMaxConsecAfterDay(other.uuid, day)) continue;
      if (this.tryAssignShift(other.uuid, day, code)) {
        this.coverageGapsCache = null;
        return true;
      }
    }

    this.planned.set(assignmentKey(did, day), code);
    if (this.rateioContext) {
      recordRateioAssignment(this.rateioContext, uuid, code);
    }
    return false;
  }

  /** Insere folga usando estratégias do motor (bloco ou liberar turno). */
  tryBalanceInsertFolga(uuid: string): boolean {
    if (!this.allowsCommonFolgaAutoAllocation()) return false;
    if (this.countRest(uuid) >= MIN_PAO_REST_COUNT) return false;
    const empty = this.emptyDaysForPao(uuid);
    const picked = this.pickFolgaBlockDay(uuid, empty);
    if (picked && this.tryAssignFolgaOnDay(uuid, picked)) return true;
    if (this.tryAssignFolgaBlock(uuid, 2)) return true;
    if (this.freeWorkDaysForFolgaBlock(uuid, 1)) return true;
    return false;
  }

  /** Quebra sequência longa inserindo folga no dia indicado. */
  tryBreakMaxConsecutiveStreak(uuid: string, middleDay: string): boolean {
    if (this.isPaoDayEmpty(uuid, middleDay)) {
      return this.tryAssignFolgaOnDay(uuid, middleDay);
    }
    const hasMotorVoo = this.allocations.some(
      (a) =>
        a.employeeUuid === uuid &&
        a.date === middleDay &&
        normalizeOperationalLabel(a.label).toUpperCase() === "VOO" &&
        !this.isInputFlightDay(uuid, middleDay),
    );
    if (hasMotorVoo && this.tryRemoveMotorVoo(uuid, middleDay)) {
      if (this.canAddFolga(uuid)) return this.tryAssignFolgaOnDay(uuid, middleDay);
      return true;
    }
    if (this.tryRemoveShiftPreservingCoverage(uuid, middleDay)) {
      if (this.canAddFolga(uuid) && this.allowsCommonFolgaAutoAllocation()) {
        this.lockDay(uuid, middleDay, "FOLGA");
      }
      return true;
    }
    return false;
  }

  private wouldExceedMaxConsecAfterDay(uuid: string, day: string): boolean {
    const dates = workDatesFromWorkspace(this, uuid);
    dates.push(day);
    return maxConsecutiveWorkDays(dates) > MAX_CONSECUTIVE_WORK_DAYS;
  }

  /** Revalida integridade T8/T8/ND após ajustes do balanceador (sem realocar blocos inteiros). */
  revalidateCoverageAfterBalance(): void {
    this.ensureNdForT8Pairs();
    this.coverageGapsCache = null;
  }

  toAssignments(): GeneratedAssignment[] {
    const out: GeneratedAssignment[] = [];
    for (const [key, code] of this.planned) {
      const [didStr, day] = key.split("|");
      const uuid = this.domainToUuid.get(Number(didStr));
      if (!uuid) continue;
      out.push({ employeeUuid: uuid, date: day, shiftCode: code });
    }
    return out;
  }

  toScheduleContext(): ScheduleContext {
    return generationToScheduleContext(
      this.input,
      this.toAssignments(),
      this.allocations,
      this.listEmergencyIsolatedT8Days(),
    );
  }
}
