import type { GenerationInputEmployee } from "../generation-types.js";
import {
  MIN_RATEIO_BLOCK_SIZE,
  requiredBlockSizeForShift,
} from "./clean-block-rules.js";
import { motorRuleEnabled, motorShiftRuleEnabled } from "./clean-motor-rules.js";
import {
  employeePrefersShift,
  getTurnAgrupamentoDays,
  getTurnSpacingDays,
  primaryPreferredRateio,
  tryPlacePreferredBlock,
} from "./clean-preferences.js";
import type { CleanWorkspace } from "./clean-workspace.js";
import {
  employeeCanReceiveMoreT8Blocks,
  tryCompleteT8Pair,
  tryPlaceT8Block,
} from "./clean-t8-blocks.js";

const PHASE = "DAILY";
const DAILY_SHIFT_ORDER = ["T8", "T6", "T7", "T9"] as const;
/**
 * Ordem de conclusão turno a turno no modo "só preferências" — reproduz o passo
 * a passo manual: fecha T8, depois T9, depois T6, por fim T7.
 */
const PREFERENCES_ONLY_SHIFT_ORDER = ["T8", "T9", "T6", "T7"] as const;

function dailyShiftCodes(ws: CleanWorkspace): string[] {
  const order = ws.options.preferencesOnly
    ? PREFERENCES_ONLY_SHIFT_ORDER
    : DAILY_SHIFT_ORDER;
  return order.filter(
    (code) => ws.coverageShiftCodes.includes(code) && ws.isShiftAllowedForGeneration(code),
  );
}

function prefsEnabled(ws: CleanWorkspace): boolean {
  return motorRuleEnabled(ws.options, "preferred_shifts");
}

/**
 * Candidatos da fase preferencial (DAILY):
 * - com preferred_shifts: só quem prefere o turno (ou sem preferência cadastrada)
 * - sem preferred_shifts: todos elegíveis
 * Ordenação: maior déficit de meta → menos turnos → senioridade.
 */
export function sortDailyAllocationCandidates(
  ws: CleanWorkspace,
  shiftCode: string,
  employees: GenerationInputEmployee[] = ws.paoEmployees,
  opts?: { preferOnly?: boolean },
): GenerationInputEmployee[] {
  const normalized = shiftCode.toUpperCase();
  const applyMeta =
    ws.usesNextMotorRules() && motorRuleEnabled(ws.options, "pao_meta_turnos");
  const usePrefs = prefsEnabled(ws);
  const preferOnly = opts?.preferOnly ?? false;

  const eligible = employees.filter((e) => {
    if (applyMeta && ws.isAtOrAboveTotalMetaTurnos(e.uuid)) return false;
    if (
      applyMeta &&
      motorShiftRuleEnabled(ws.options, "pao_meta_turnos", normalized) &&
      ws.countRateioTurnsForShift(e.uuid, normalized) >=
        ws.effectiveMetaTurnosForShift(e.uuid, normalized)
    ) {
      return false;
    }
    if (applyMeta && !ws.hasDiasTrabalhadosHeadroom(e.uuid, 1)) return false;
    return true;
  });

  const byDeficitThenSeniority = (
    a: GenerationInputEmployee,
    b: GenerationInputEmployee,
  ): number => {
    if (applyMeta) {
      const deficitCmp = ws.metaTurnosDeficit(b.uuid) - ws.metaTurnosDeficit(a.uuid);
      if (deficitCmp !== 0) return deficitCmp;
    }
    const countCmp = ws.countRateioTurns(a.uuid) - ws.countRateioTurns(b.uuid);
    if (countCmp !== 0) return countCmp;
    return (
      a.employee.seniority - b.employee.seniority ||
      a.employee.name.localeCompare(b.employee.name)
    );
  };

  if (!usePrefs) {
    return [...eligible].sort(byDeficitThenSeniority);
  }

  const prefersThis = (e: GenerationInputEmployee) =>
    employeePrefersShift(ws, e.domainId, normalized);
  const hasAnyPref = (e: GenerationInputEmployee) =>
    primaryPreferredRateio(ws, e.domainId) != null;

  // Preferentes do turno; sem preferência cadastrada podem entrar na fase preferencial.
  // Quem prefere OUTRO turno só na cobertura residual.
  const prefer = eligible.filter((e) => prefersThis(e) || !hasAnyPref(e));
  const others = eligible.filter((e) => hasAnyPref(e) && !prefersThis(e));

  prefer.sort(byDeficitThenSeniority);
  others.sort(byDeficitThenSeniority);

  if (preferOnly) return prefer;
  return [...prefer, ...others];
}

/** Headroom de capacidade (meta total / por turno / dias) — sem inflar com bloco artificial. */
function headroomForEmployee(
  ws: CleanWorkspace,
  emp: GenerationInputEmployee,
  shiftCode: string,
): number {
  const normalized = shiftCode.toUpperCase();
  const applyMeta = motorRuleEnabled(ws.options, "pao_meta_turnos");
  const perShiftLimit =
    applyMeta && motorShiftRuleEnabled(ws.options, "pao_meta_turnos", normalized)
      ? ws.effectiveMetaTurnosForShift(emp.uuid, normalized) -
        ws.countRateioTurnsForShift(emp.uuid, normalized)
      : Number.POSITIVE_INFINITY;
  const totalLimit = applyMeta
    ? ws.effectiveTotalMetaForEmployee(emp.uuid) - ws.countRateioTurns(emp.uuid)
    : Number.POSITIVE_INFINITY;
  const diasLimit = applyMeta
    ? ws.effectiveDiasTrabalhadosForEmployee(emp.uuid) - ws.countProductiveWorkDays(emp.uuid)
    : Number.POSITIVE_INFINITY;
  return Math.min(perShiftLimit, totalLimit, diasLimit);
}

/** Só o tamanho do agrupamento configurado (ex.: 5) — sem cair para 4/3. */
function blockSizesToTry(requiredSize: number, headroom: number): number[] {
  if (requiredSize <= 0) return [];
  if (headroom < requiredSize) return [];
  return [requiredSize];
}

function tryAllocateT8ForDay(ws: CleanWorkspace, date: string, preferOnly: boolean): boolean {
  if (!ws.isShiftAllowedForGeneration("T8")) return false;
  const candidates = sortDailyAllocationCandidates(ws, "T8", ws.paoEmployees, { preferOnly });
  for (const emp of candidates) {
    if (!employeeCanReceiveMoreT8Blocks(ws, emp.uuid)) continue;
    if (tryPlaceT8Block(ws, emp.uuid, date)) {
      ws.audit.record("COVERAGE_ASSIGNED", PHASE, "T8 bloco — preferência", {
        date,
        shiftCode: "T8",
        employeeUuid: emp.uuid,
        employeeName: emp.employee.name,
      });
      return true;
    }
    if (tryCompleteT8Pair(ws, emp.uuid, date, false)) {
      ws.audit.record("COVERAGE_ASSIGNED", PHASE, "T8 par completado — preferência", {
        date,
        shiftCode: "T8",
        employeeUuid: emp.uuid,
        employeeName: emp.employee.name,
      });
      return true;
    }
  }
  return false;
}

function tryAllocateRateioBlockForDay(
  ws: CleanWorkspace,
  date: string,
  shiftCode: string,
  preferOnly: boolean,
): boolean {
  const normalized = shiftCode.toUpperCase();
  const requiredSize = requiredBlockSizeForShift(
    normalized,
    getTurnAgrupamentoDays(ws, normalized),
  );
  const spacingDays = getTurnSpacingDays(ws, normalized);
  const candidates = sortDailyAllocationCandidates(ws, normalized, ws.paoEmployees, {
    preferOnly,
  });

  for (const emp of candidates) {
    const headroom = headroomForEmployee(ws, emp, normalized);
    const sizes =
      requiredSize >= MIN_RATEIO_BLOCK_SIZE
        ? blockSizesToTry(requiredSize, headroom)
        : headroom >= 1
          ? [1]
          : [];

    for (const size of sizes) {
      const placed = tryPlacePreferredBlock(
        ws,
        emp,
        normalized,
        date,
        size,
        spacingDays,
        PHASE,
        size, // não encolhe abaixo do agrupamento
      );
      if (placed >= size) {
        ws.audit.record("COVERAGE_ASSIGNED", PHASE, `bloco ${placed} dia(s) — preferência`, {
          date,
          shiftCode: normalized,
          employeeUuid: emp.uuid,
          employeeName: emp.employee.name,
        });
        return true;
      }
    }
  }
  return false;
}

function tryAllocateShiftForDay(
  ws: CleanWorkspace,
  date: string,
  shiftCode: string,
  preferOnly: boolean,
): boolean {
  if (ws.hasPaoCoverage(date, shiftCode)) return false;
  if (shiftCode.toUpperCase() === "T8") {
    return tryAllocateT8ForDay(ws, date, preferOnly);
  }
  return tryAllocateRateioBlockForDay(ws, date, shiftCode, preferOnly);
}

function tryPlaceOneT8BlockForEmployee(
  ws: CleanWorkspace,
  emp: GenerationInputEmployee,
): boolean {
  if (!ws.isShiftAllowedForGeneration("T8")) return false;
  if (!employeeCanReceiveMoreT8Blocks(ws, emp.uuid)) return false;
  for (const date of ws.days) {
    if (ws.hasPaoCoverage(date, "T8")) continue;
    if (tryPlaceT8Block(ws, emp.uuid, date)) {
      ws.audit.record("COVERAGE_ASSIGNED", PHASE, "T8 bloco — preferência (lista)", {
        date,
        shiftCode: "T8",
        employeeUuid: emp.uuid,
        employeeName: emp.employee.name,
      });
      return true;
    }
    if (tryCompleteT8Pair(ws, emp.uuid, date, false)) {
      ws.audit.record("COVERAGE_ASSIGNED", PHASE, "T8 par completado — preferência (lista)", {
        date,
        shiftCode: "T8",
        employeeUuid: emp.uuid,
        employeeName: emp.employee.name,
      });
      return true;
    }
  }
  return false;
}

function tryPlaceOneRateioBlockForEmployee(
  ws: CleanWorkspace,
  emp: GenerationInputEmployee,
  shiftCode: string,
): boolean {
  const normalized = shiftCode.toUpperCase();
  const requiredSize = requiredBlockSizeForShift(
    normalized,
    getTurnAgrupamentoDays(ws, normalized),
  );
  const spacingDays = getTurnSpacingDays(ws, normalized);
  const headroom = headroomForEmployee(ws, emp, normalized);
  const sizes =
    requiredSize >= MIN_RATEIO_BLOCK_SIZE
      ? blockSizesToTry(requiredSize, headroom)
      : headroom >= 1
        ? [1]
        : [];
  if (sizes.length === 0) return false;

  for (const date of ws.days) {
    if (ws.hasPaoCoverage(date, normalized)) continue;
    for (const size of sizes) {
      const placed = tryPlacePreferredBlock(
        ws,
        emp,
        normalized,
        date,
        size,
        spacingDays,
        PHASE,
        size,
      );
      if (placed >= size) {
        ws.audit.record("COVERAGE_ASSIGNED", PHASE, `bloco ${placed} dia(s) — preferência (lista)`, {
          date,
          shiftCode: normalized,
          employeeUuid: emp.uuid,
          employeeName: emp.employee.name,
        });
        return true;
      }
    }
  }
  return false;
}

/** Uma passagem na lista: tenta 1 bloco para este colaborador no turno. */
function tryPlaceOnePreferenceBlockForEmployee(
  ws: CleanWorkspace,
  emp: GenerationInputEmployee,
  shiftCode: string,
): boolean {
  if (shiftCode.toUpperCase() === "T8") {
    return tryPlaceOneT8BlockForEmployee(ws, emp);
  }
  return tryPlaceOneRateioBlockForEmployee(ws, emp, shiftCode);
}

/**
 * Modo "só preferências": fecha um turno por vez em RODÍZIO DE BLOCOS —
 * cada rodada percorre a lista de preferentes por senioridade e dá 1 bloco
 * a cada um; repete até ninguém mais caber. Reproduz o passo a passo manual:
 * Luccas pega o 1º bloco, Hélio o 2º, Felipe o 3º (~dia 12), e só então
 * a rodada volta ao início da lista.
 */
function fillPreferencesOnlyByShiftList(ws: CleanWorkspace, shifts: string[]): void {
  for (const shiftCode of shifts) {
    let progress = true;
    while (progress) {
      progress = false;
      const candidates = sortDailyAllocationCandidates(ws, shiftCode, ws.paoEmployees, {
        preferOnly: true,
      });
      for (const emp of candidates) {
        if (tryPlaceOnePreferenceBlockForEmployee(ws, emp, shiftCode)) {
          progress = true;
        }
      }
    }
  }
}

/**
 * Alocação diária unificada (motor NEXT) — fase preferencial:
 * só aloca quem prefere o turno (não preferenciais ficam para cobertura residual).
 */
export function fillDailyRateioAllocation(ws: CleanWorkspace): void {
  if (!ws.usesNextMotorRules()) return;

  const shifts = dailyShiftCodes(ws);
  if (shifts.length === 0) return;

  const preferOnly = prefsEnabled(ws);

  if (ws.options.preferencesOnly) {
    fillPreferencesOnlyByShiftList(ws, shifts);
    return;
  }

  let progress = true;
  while (progress) {
    progress = false;
    for (const date of ws.days) {
      for (const shiftCode of shifts) {
        if (tryAllocateShiftForDay(ws, date, shiftCode, preferOnly)) {
          progress = true;
        }
      }
    }
  }
}
