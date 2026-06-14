import { addDays } from "../rules/dates.js";
import { isNdOverrideProtected } from "./schedule-grid-source.js";
import { computeTurnRateio, sortPaoForCoverageCandidates } from "./real-schedule-turn-rateio.js";
import { isParallelOnlyPreferredPao } from "./employee-t6-t7-shift.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { ValidationIssue } from "./types.js";

export interface T8GapRepairAudit {
  blocksPlaced: number;
  emergencyIsolated: number;
  gapsRemaining: number;
  warnings: ValidationIssue[];
}

function wouldDuplicateT8Coverage(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): boolean {
  const holder = ws.findPaoOnShift(day, "T8");
  return holder != null && holder !== uuid;
}

function canPlaceT8BlockAt(
  ws: GenerationWorkspace,
  uuid: string,
  startDay: string,
): boolean {
  const d1 = addDays(startDay, 1);
  if (!ws.days.includes(d1)) return false;
  if (wouldDuplicateT8Coverage(ws, uuid, startDay)) return false;
  if (wouldDuplicateT8Coverage(ws, uuid, d1)) return false;

  const ndDay = addDays(startDay, 2);
  if (ws.days.includes(ndDay)) {
    if (isNdOverrideProtected(ws, uuid, ndDay)) return false;
    const holder = ws.findPaoOnShift(ndDay, "T8");
    if (holder != null && holder !== uuid) return false;
  } else if (isNdOverrideProtected(ws, uuid, ndDay)) {
    return false;
  }

  return ws.canPlaceT8Block(uuid, startDay, true);
}

function t8RepairCandidates(ws: GenerationWorkspace, dayIndex: number) {
  const entries = computeTurnRateio(ws).entries;
  return sortPaoForCoverageCandidates(ws, dayIndex, entries).filter(
    (c) => !isParallelOnlyPreferredPao(ws, c.uuid),
  );
}

/** Tenta fechar gap T8 no dia D montando bloco T8/T8/ND válido. */
export function tryRepairT8GapWithBlock(
  ws: GenerationWorkspace,
  gapDay: string,
): boolean {
  if (ws.hasPaoCoverage(gapDay, "T8")) return true;

  const dayIndex = Math.max(0, ws.days.indexOf(gapDay));
  const candidates = t8RepairCandidates(ws, dayIndex);

  for (const c of candidates) {
    const uuid = c.uuid;

    if (canPlaceT8BlockAt(ws, uuid, gapDay) && ws.tryPlaceT8Block(uuid, gapDay, true)) {
      if (ws.hasPaoCoverage(gapDay, "T8")) return true;
    }

    const prev = addDays(gapDay, -1);
    if (
      ws.days.includes(prev) &&
      canPlaceT8BlockAt(ws, uuid, prev) &&
      ws.tryPlaceT8Block(uuid, prev, true) &&
      ws.hasPaoCoverage(gapDay, "T8")
    ) {
      return true;
    }

    if (ws.days.includes(prev) && ws.tryCompleteT8Pair(uuid, gapDay, true)) {
      if (ws.hasPaoCoverage(gapDay, "T8")) return true;
    }
  }

  return ws.hasPaoCoverage(gapDay, "T8");
}

function tryEmergencyIsolatedT8(
  ws: GenerationWorkspace,
  gapDay: string,
  warnings: ValidationIssue[],
): boolean {
  if (ws.hasPaoCoverage(gapDay, "T8")) return true;

  const dayIndex = Math.max(0, ws.days.indexOf(gapDay));
  const candidates = t8RepairCandidates(ws, dayIndex);

  const tryPool = [
    ...candidates,
    ...ws.paoEmps.filter(
      (c) =>
        !isParallelOnlyPreferredPao(ws, c.uuid) &&
        !candidates.some((x) => x.uuid === c.uuid),
    ),
  ];

  for (const c of tryPool) {
    if (wouldDuplicateT8Coverage(ws, c.uuid, gapDay)) continue;
    if (ws.isDayBlockedForShift(c.uuid, gapDay)) continue;
    if (!ws.tryAssignShift(c.uuid, gapDay, "T8", true)) continue;

    ws.markEmergencyIsolatedT8(c.uuid, gapDay);

    warnings.push({
      severity: "MÉDIA",
      level: "WARNING",
      type: "RATEIO_T8_EMERGENCY_ISOLATED",
      date: gapDay,
      employee: c.employee.name,
      detail:
        `T8 isolado emergencial em ${gapDay} para ${c.employee.name} — ` +
        "bloco T8/T8/ND impossível após dedup.",
    });
    return true;
  }

  return false;
}

/** Fecha gaps T8 pós-dedup — bloco completo preferencial, isolado só como último recurso. */
export function repairT8GapsAfterDedup(ws: GenerationWorkspace): T8GapRepairAudit {
  ws.ensureRateioContext();

  const warnings: ValidationIssue[] = [];
  let blocksPlaced = 0;
  let emergencyIsolated = 0;

  for (let pass = 0; pass < 3; pass++) {
    let progress = false;
    for (const day of ws.days) {
      if (ws.hasPaoCoverage(day, "T8")) continue;

      const before = ws.toAssignments().length;
      if (tryRepairT8GapWithBlock(ws, day)) {
        if (ws.toAssignments().length > before) {
          blocksPlaced++;
        }
        progress = true;
        continue;
      }

      if (tryEmergencyIsolatedT8(ws, day, warnings)) {
        emergencyIsolated++;
        progress = true;
      }
    }
    if (!progress) break;
  }

  return {
    blocksPlaced,
    emergencyIsolated,
    gapsRemaining: ws.listCoverageGaps().filter((g) => g.shiftCode === "T8").length,
    warnings,
  };
}
