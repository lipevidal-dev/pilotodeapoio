import { addDays } from "../rules/dates.js";
import type { GenerationWorkspace } from "./generation-workspace.js";

/** Máximo de blocos T8/T8/ND por PAO no mês. */
export const MAX_T8_BLOCKS_PER_PAO_MONTH = 2;

function shiftOnDay(ws: GenerationWorkspace, uuid: string, day: string): string | undefined {
  return ws.toAssignments().find((a) => a.employeeUuid === uuid && a.date === day)?.shiftCode;
}

/** Conta blocos completos T8/T8 (cada bloco = 1). */
export function countT8BlocksForEmployee(ws: GenerationWorkspace, uuid: string): number {
  let blocks = 0;
  const seen = new Set<string>();

  for (const day of ws.days) {
    const key = `${uuid}|${day}`;
    if (seen.has(key)) continue;
    if (shiftOnDay(ws, uuid, day) !== "T8") continue;
    const next = addDays(day, 1);
    if (shiftOnDay(ws, uuid, next) === "T8") {
      blocks++;
      seen.add(key);
      seen.add(`${uuid}|${next}`);
    }
  }
  return blocks;
}

export function employeeAtT8BlockLimit(ws: GenerationWorkspace, uuid: string): boolean {
  return countT8BlocksForEmployee(ws, uuid) >= MAX_T8_BLOCKS_PER_PAO_MONTH;
}

/** PAO pode iniciar um novo bloco T8/T8/ND neste mês. */
export function employeeCanStartT8Block(
  ws: GenerationWorkspace,
  uuid: string,
  coverageEmergency = false,
): boolean {
  if (!employeeAtT8BlockLimit(ws, uuid)) return true;
  return coverageEmergency;
}
