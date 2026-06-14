import { addDays } from "../rules/dates.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { EmployeeBlockPlan } from "./demand-planning-types.js";
import {
  findSpacedConsecutiveSlot,
  idealBlockSpacing,
  listEmployeeAvailableDays,
} from "./motor-v3-planning.js";
import { wouldExceedT6T7BlockMax } from "./t6-t7-block-coverage.js";

export interface MaterializeResult {
  placedBlocks: number;
  failedBlocks: number;
  placedShifts: number;
}

function pickShiftCodeForBlock(
  ws: GenerationWorkspace,
  startDay: string,
  size: number,
): "T6" | "T7" {
  let t6Need = 0;
  let t7Need = 0;
  for (let i = 0; i < size; i++) {
    const day = addDays(startDay, i);
    if (!ws.hasPaoCoverage(day, "T6")) t6Need++;
    if (!ws.hasPaoCoverage(day, "T7")) t7Need++;
  }
  return t7Need > t6Need ? "T7" : "T6";
}

/** Etapa 6 V3 — Materializa blocos com espaçamento matemático Xf entre blocos. */
export function materializeBlockPlans(
  ws: GenerationWorkspace,
  plans: EmployeeBlockPlan[],
): MaterializeResult {
  let placedBlocks = 0;
  let failedBlocks = 0;
  let placedShifts = 0;

  for (const plan of plans) {
    const initialAvailable = listEmployeeAvailableDays(ws, plan.employeeUuid);
    const zf = plan.plannedBlocks.length;
    plan.blockSpacing = idealBlockSpacing(initialAvailable.length, zf);

    let blockIndex = 0;
    for (const block of plan.plannedBlocks) {
      const start = findSpacedConsecutiveSlot(
        ws,
        plan.employeeUuid,
        block.size,
        blockIndex,
        zf,
        initialAvailable,
      );
      blockIndex++;

      if (!start) {
        failedBlocks++;
        continue;
      }

      const code = pickShiftCodeForBlock(ws, start, block.size);
      block.shiftCode = code;

      let placed = true;
      for (let i = 0; i < block.size; i++) {
        const day = addDays(start, i);
        if (wouldExceedT6T7BlockMax(ws, plan.employeeUuid, day, code)) {
          placed = false;
          break;
        }
        if (!ws.tryAssignShift(plan.employeeUuid, day, code)) {
          placed = false;
          break;
        }
        placedShifts++;
      }

      if (!placed) {
        for (let i = 0; i < block.size; i++) {
          ws.unassignShift(plan.employeeUuid, addDays(start, i));
        }
        failedBlocks++;
        continue;
      }

      plan.executedBlocks.push({
        startDate: start,
        size: block.size,
        shiftCode: code,
        endDate: addDays(start, block.size - 1),
      });
      placedBlocks++;
    }
  }

  return { placedBlocks, failedBlocks, placedShifts };
}
