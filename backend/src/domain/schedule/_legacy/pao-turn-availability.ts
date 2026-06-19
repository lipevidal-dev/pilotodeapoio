import { VACATION_TYPES } from "../../rules/constants.js";
import { FANI_LABEL } from "../../rules/birthday.js";
import { normalizeOperationalLabel, isOperationalHardBlock } from "../operational-labels.js";
import type { GenerationWorkspace } from "./generation-workspace.js";

/** Cadastros operacionais — bloqueiam turno no dia, mas não reduzem meta proporcional. */
const RATEIO_NEUTRAL_CADASTRO = new Set([
  "CURSO",
  "CURSO ONLINE",
  "SIMULADOR",
  "CMA",
  "OUTRO",
]);

export interface ProportionalTurnTargets {
  minTurnCounts: Map<string, number>;
  targetTurnCounts: Map<string, number>;
  maxTurnCounts: Map<string, number>;
  availableDaysByEmployee: Map<string, number>;
  relativeAvailabilityByEmployee: Map<string, number>;
  poolAverageAvailableDays: number;
  baseAverageTurns: number;
}

/** Dia indisponível para meta de turnos (férias, FP, FANI, pré-alocação fixa, bloqueio operacional). */
export function isCalendarUnavailableForRateio(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return true;

  const lockedLabel = ws.input.lockedAllocations.find(
    (l) => l.employeeUuid === uuid && l.date === day,
  )?.label;
  const label = ws.blocked.get(`${did}|${day}`) ?? lockedLabel;

  if (!label) {
    return ws.input.vacationDays.some((v) => v.employeeUuid === uuid && v.date === day);
  }

  const upper = normalizeOperationalLabel(label).toUpperCase();
  if (RATEIO_NEUTRAL_CADASTRO.has(upper)) return false;
  if (VACATION_TYPES.has(upper) || upper === "FÉRIAS") return true;
  if (upper.includes("FOLGA PEDIDA") || upper === "FP") return true;
  if (upper.includes("FOLGA ANIVERS") || upper === "FANI" || label === FANI_LABEL) return true;
  return isOperationalHardBlock(label);
}

export function countCalendarAvailableDaysForRateio(
  ws: GenerationWorkspace,
  uuid: string,
): number {
  let n = 0;
  for (const day of ws.days) {
    if (!isCalendarUnavailableForRateio(ws, uuid, day)) n++;
  }
  return n;
}

/**
 * Metas min/target/max proporcionais à disponibilidade calendário.
 * A soma dos targets ≈ totalDemand quando relativo usa média do pool.
 */
export function computeProportionalTurnTargets(
  ws: GenerationWorkspace,
  poolUuids: readonly string[],
  totalDemand: number,
): ProportionalTurnTargets {
  const availableDaysByEmployee = new Map<string, number>();
  const relativeAvailabilityByEmployee = new Map<string, number>();
  const minTurnCounts = new Map<string, number>();
  const targetTurnCounts = new Map<string, number>();
  const maxTurnCounts = new Map<string, number>();

  if (poolUuids.length === 0) {
    return {
      minTurnCounts,
      targetTurnCounts,
      maxTurnCounts,
      availableDaysByEmployee,
      relativeAvailabilityByEmployee,
      poolAverageAvailableDays: 0,
      baseAverageTurns: 0,
    };
  }

  const baseAverageTurns = totalDemand / poolUuids.length;

  for (const uuid of poolUuids) {
    availableDaysByEmployee.set(uuid, countCalendarAvailableDaysForRateio(ws, uuid));
  }

  const totalAvailable = [...availableDaysByEmployee.values()].reduce((a, b) => a + b, 0);
  const poolAverageAvailableDays =
    poolUuids.length > 0 ? totalAvailable / poolUuids.length : 0;

  for (const uuid of poolUuids) {
    const available = availableDaysByEmployee.get(uuid) ?? 0;
    const relative =
      poolAverageAvailableDays > 0 ? available / poolAverageAvailableDays : 1;
    relativeAvailabilityByEmployee.set(uuid, relative);

    const meta = baseAverageTurns * relative;
    targetTurnCounts.set(uuid, meta);
    minTurnCounts.set(uuid, Math.max(0, Math.floor(meta) - 1));
    maxTurnCounts.set(uuid, Math.ceil(meta));
  }

  return {
    minTurnCounts,
    targetTurnCounts,
    maxTurnCounts,
    availableDaysByEmployee,
    relativeAvailabilityByEmployee,
    poolAverageAvailableDays,
    baseAverageTurns,
  };
}
