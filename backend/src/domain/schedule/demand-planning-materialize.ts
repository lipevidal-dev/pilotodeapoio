import { addDays } from "../rules/dates.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { EmployeeBlockPlan } from "./demand-planning-types.js";
import {
  blockDaysFromStart,
  confirmEmployeeT6T7Lock,
  pickShiftByCoverageGaps,
  resolveEmployeeT6T7Code,
  type T6T7ShiftCode,
} from "./employee-t6-t7-shift.js";
import {
  findSpacedConsecutiveSlot,
  idealBlockSpacing,
  listEmployeeAvailableDays,
} from "./motor-v3-planning.js";
import { blockAnchorDaysAfterMonoFolgaPedida } from "./mono-folga-pedida.js";
import { wouldExceedT6T7BlockMax } from "./t6-t7-block-coverage.js";
import {
  classifyNoSlotDiscardReason,
  classifyPlacementDiscardReason,
  type V3BlockMaterializeAuditCollector,
} from "./v3-block-materialize-audit.js";

export interface MaterializeBlockPlansOptions {
  audit?: V3BlockMaterializeAuditCollector;
}

export interface MaterializeResult {
  placedBlocks: number;
  failedBlocks: number;
  placedShifts: number;
}

function allowedT6T7Codes(ws: GenerationWorkspace, uuid: string): T6T7ShiftCode[] {
  return ws
    .allowedShiftsForEmployee(uuid, ["T6", "T7"])
    .map((c) => c.toUpperCase())
    .filter((c): c is T6T7ShiftCode => c === "T6" || c === "T7");
}

function pickCodesToTry(
  ws: GenerationWorkspace,
  uuid: string,
  blockDays: string[],
): T6T7ShiftCode[] {
  return [resolveEmployeeT6T7Code(ws, uuid, blockDays)];
}

function tryPlaceBlock(
  ws: GenerationWorkspace,
  uuid: string,
  start: string,
  size: number,
  blockDays: string[],
): T6T7ShiftCode | null {
  for (const code of pickCodesToTry(ws, uuid, blockDays)) {
    let placed = true;
    for (let i = 0; i < size; i++) {
      const day = addDays(start, i);
      if (wouldExceedT6T7BlockMax(ws, uuid, day, code)) {
        placed = false;
        break;
      }
      if (!ws.tryAssignShift(uuid, day, code)) {
        placed = false;
        break;
      }
    }
    if (placed) {
      confirmEmployeeT6T7Lock(ws, uuid, code);
      return code;
    }
    for (let i = 0; i < size; i++) {
      ws.unassignShift(uuid, addDays(start, i));
    }
  }
  return null;
}

/** Etapa 6 V3 — Materializa blocos com espaçamento Xf e turno homogêneo por funcionário. */
export function materializeBlockPlans(
  ws: GenerationWorkspace,
  plans: EmployeeBlockPlan[],
  options?: MaterializeBlockPlansOptions,
): MaterializeResult {
  const audit = options?.audit;
  let placedBlocks = 0;
  let failedBlocks = 0;
  let placedShifts = 0;

  for (const plan of plans) {
    const initialAvailable = listEmployeeAvailableDays(ws, plan.employeeUuid);
    audit?.beginEmployee(plan, initialAvailable.length);
    const zf = plan.plannedBlocks.length;
    plan.blockSpacing = idealBlockSpacing(initialAvailable.length, zf);

    if (plan.plannedBlocks.length > 0 && !plan.plannedBlocks[0]?.shiftCode) {
      const previewDays = blockDaysFromStart(ws.days[0] ?? "", Math.min(plan.target, 5));
      const locked = resolveEmployeeT6T7Code(ws, plan.employeeUuid, previewDays);
      for (const block of plan.plannedBlocks) {
        block.shiftCode = locked;
      }
    }

    let blockIndex = 0;
    const monoAnchors = blockAnchorDaysAfterMonoFolgaPedida(ws, plan.employeeUuid);
    for (const block of plan.plannedBlocks) {
      const start = findSpacedConsecutiveSlot(
        ws,
        plan.employeeUuid,
        block.size,
        blockIndex,
        zf,
        initialAvailable,
        blockIndex === 0 ? monoAnchors : undefined,
      );
      blockIndex++;

      if (!start) {
        failedBlocks++;
        const { reason, detail } = classifyNoSlotDiscardReason(
          ws,
          plan.employeeUuid,
          block.size,
          blockIndex - 1,
        );
        audit?.recordDiscarded(blockIndex - 1, block.size, reason, detail);
        continue;
      }

      const blockDays = blockDaysFromStart(start, block.size);
      const code = tryPlaceBlock(ws, plan.employeeUuid, start, block.size, blockDays);

      if (!code) {
        failedBlocks++;
        const { reason, detail } = classifyPlacementDiscardReason(
          ws,
          plan.employeeUuid,
          start,
          block.size,
        );
        audit?.recordDiscarded(blockIndex - 1, block.size, reason, detail);
        continue;
      }

      block.shiftCode = code;
      placedShifts += block.size;

      plan.executedBlocks.push({
        startDate: start,
        size: block.size,
        shiftCode: code,
        endDate: addDays(start, block.size - 1),
      });
      placedBlocks++;
      audit?.recordMaterialized(blockIndex - 1, block.size, start, code);
    }
  }

  return { placedBlocks, failedBlocks, placedShifts };
}

export function pickShiftCodeForEmployeeBlock(
  ws: GenerationWorkspace,
  uuid: string,
  startDay: string,
  size: number,
): T6T7ShiftCode {
  const days = blockDaysFromStart(startDay, size);
  return resolveEmployeeT6T7Code(ws, uuid, days);
}

/** @deprecated Use pickShiftCodeForEmployeeBlock — mantido para testes legados. */
export function pickShiftCodeForBlock(
  ws: GenerationWorkspace,
  uuid: string,
  startDay: string,
  size: number,
): T6T7ShiftCode {
  const allowed = allowedT6T7Codes(ws, uuid);
  if (allowed.length === 0) {
    return pickShiftByCoverageGaps(ws, blockDaysFromStart(startDay, size), ["T6", "T7"]);
  }
  return pickShiftCodeForEmployeeBlock(ws, uuid, startDay, size);
}
