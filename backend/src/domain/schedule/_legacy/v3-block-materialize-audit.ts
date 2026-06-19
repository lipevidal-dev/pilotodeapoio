import { addDays } from "../../rules/dates.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { EmployeeBlockPlan } from "./demand-planning-types.js";
import {
  listEmployeeAvailableDays,
  isT8NdBlockDay,
} from "./motor-v3-planning.js";
import { wouldExceedT6T7BlockMax } from "./t6-t7-block-coverage.js";
import { assignmentKey } from "../types.js";
import { resolveEmployeeT6T7Code, blockDaysFromStart } from "./employee-t6-t7-shift.js";
import type { TryAssignShiftRejectReason } from "./try-assign-shift-detailed.js";

export type V3BlockDiscardReason =
  | "BLOCK_SPACING"
  | "NO_SLOT_FOUND"
  | "REST_CONSTRAINT"
  | "T8_CONFLICT"
  | "OTHER";

export interface V3DiscardedBlockRecord {
  blockIndex: number;
  plannedSize: number;
  reason: V3BlockDiscardReason;
  detail?: string;
  /** Data retornada por findSpacedConsecutiveSlot (null se slot não encontrado). */
  attemptedStartDate: string | null;
  /** Maior sequência consecutiva livre no calendário no momento do descarte. */
  maxConsecutiveFree: number;
  /** Tamanho do bloco (= sequência requerida). */
  requiredSequence: number;
  /** Retorno literal de findSpacedConsecutiveSlot. */
  findSpacedConsecutiveSlotResult: string | null;
  /** Retorno de tryPlaceBlock: código T6/T7, null se falhou, NOT_CALLED se slot ausente. */
  tryPlaceBlockResult: string | null;
  /** Primeiro passo que falhou dentro de tryPlaceBlock. */
  tryPlaceBlockFailureStep?: string;
  /** Motivo canônico quando tryAssignShift recusa. */
  tryAssignRejectReason?: TryAssignShiftRejectReason;
  /** Detalhe textual do motivo (canWork, 12h, rateio, etc.). */
  tryAssignRejectDetails?: string;
}

export interface V3MaterializedBlockRecord {
  blockIndex: number;
  plannedSize: number;
  startDate: string;
  shiftCode: string;
}

export interface V3EmployeeBlockMaterializeAudit {
  employeeUuid: string;
  employeeName: string;
  targetShifts: number;
  availableDaysAtStart: number;
  plannedBlocks: number;
  materializedBlocks: number;
  discardedBlocks: number;
  plannedShifts: number;
  materializedShifts: number;
  discardedShifts: number;
  discardReasons: Partial<Record<V3BlockDiscardReason, number>>;
  discarded: V3DiscardedBlockRecord[];
  materialized: V3MaterializedBlockRecord[];
}

export interface V3BlockMaterializeAudit {
  employees: V3EmployeeBlockMaterializeAudit[];
  totals: {
    plannedBlocks: number;
    materializedBlocks: number;
    discardedBlocks: number;
    plannedShifts: number;
    materializedShifts: number;
    discardedShifts: number;
  };
}

function maxConsecutiveAvailable(ws: GenerationWorkspace, uuid: string): number {
  let max = 0;
  let streak = 0;
  for (const day of ws.days) {
    if (canPlaceForAudit(ws, uuid, day)) {
      streak++;
      max = Math.max(max, streak);
    } else {
      streak = 0;
    }
  }
  return max;
}

/** Maior sequência consecutiva livre — exportado para trace de descarte. */
export function measureMaxConsecutiveFreeDays(ws: GenerationWorkspace, uuid: string): number {
  return maxConsecutiveAvailable(ws, uuid);
}

export interface V3BlockDiscardTraceInput {
  attemptedStartDate: string | null;
  findSpacedConsecutiveSlotResult: string | null;
  tryPlaceBlockResult: string | null;
  tryPlaceBlockFailureStep?: string;
  tryAssignRejectReason?: TryAssignShiftRejectReason;
  tryAssignRejectDetails?: string;
}

export function buildBlockDiscardTrace(
  ws: GenerationWorkspace,
  uuid: string,
  blockSize: number,
  input: V3BlockDiscardTraceInput,
): Pick<
  V3DiscardedBlockRecord,
  | "attemptedStartDate"
  | "maxConsecutiveFree"
  | "requiredSequence"
  | "findSpacedConsecutiveSlotResult"
  | "tryPlaceBlockResult"
  | "tryPlaceBlockFailureStep"
  | "tryAssignRejectReason"
  | "tryAssignRejectDetails"
> {
  return {
    attemptedStartDate: input.attemptedStartDate,
    maxConsecutiveFree: measureMaxConsecutiveFreeDays(ws, uuid),
    requiredSequence: blockSize,
    findSpacedConsecutiveSlotResult: input.findSpacedConsecutiveSlotResult,
    tryPlaceBlockResult: input.tryPlaceBlockResult,
    tryPlaceBlockFailureStep: input.tryPlaceBlockFailureStep,
    tryAssignRejectReason: input.tryAssignRejectReason,
    tryAssignRejectDetails: input.tryAssignRejectDetails,
  };
}

function canPlaceForAudit(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  if (ws.isDayBlockedForShift(uuid, day)) return false;
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return false;
  return !ws.planned.has(assignmentKey(did, day));
}

function windowHasT8Conflict(ws: GenerationWorkspace, uuid: string, start: string, size: number): boolean {
  for (let i = 0; i < size; i++) {
    const day = addDays(start, i);
    if (isT8NdBlockDay(ws, uuid, day)) return true;
    const did = ws.uuidToDomain.get(uuid);
    if (did && ws.planned.get(assignmentKey(did, day)) === "T8") return true;
  }
  return false;
}

function anyWindowBlockedOnlyByT8(ws: GenerationWorkspace, uuid: string, size: number): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (did == null) return false;

  const maxStart = Math.max(0, ws.days.length - size);
  let sawT8Block = false;
  let sawOtherBlock = false;

  for (let di = 0; di <= maxStart; di++) {
    let ok = true;
    let t8InWindow = false;
    for (let j = 0; j < size; j++) {
      const day = ws.days[di + j]!;
      if (isT8NdBlockDay(ws, uuid, day) || ws.planned.get(assignmentKey(did, day)) === "T8") {
        t8InWindow = true;
        ok = false;
        break;
      }
      if (!canPlaceForAudit(ws, uuid, day)) {
        ok = false;
        break;
      }
    }
    if (ok) return false;
    if (t8InWindow) sawT8Block = true;
    else sawOtherBlock = true;
  }

  return sawT8Block && !sawOtherBlock;
}

/** Classifica motivo quando findSpacedConsecutiveSlot retorna null. */
export function classifyNoSlotDiscardReason(
  ws: GenerationWorkspace,
  uuid: string,
  size: number,
  blockIndex: number,
): { reason: V3BlockDiscardReason; detail: string } {
  const availableNow = listEmployeeAvailableDays(ws, uuid);
  if (availableNow.length < size) {
    return {
      reason: "NO_SLOT_FOUND",
      detail: `dias livres=${availableNow.length}, bloco=${size}`,
    };
  }

  const maxRun = maxConsecutiveAvailable(ws, uuid);
  if (maxRun < size) {
    if (anyWindowBlockedOnlyByT8(ws, uuid, size)) {
      return {
        reason: "T8_CONFLICT",
        detail: `maior sequência=${maxRun}, bloco=${size}, T8/ND fragmenta calendário`,
      };
    }
    return {
      reason: "BLOCK_SPACING",
      detail: `maior sequência=${maxRun}, bloco=${size}, calendário fragmentado`,
    };
  }

  if (blockIndex > 0) {
    return {
      reason: "BLOCK_SPACING",
      detail: `bloco ${blockIndex + 1}: sequência existe (${maxRun}) mas slot espaçado indisponível após blocos anteriores`,
    };
  }

  return {
    reason: "OTHER",
    detail: `sequência=${maxRun}, dias livres=${availableNow.length}, slot não encontrado`,
  };
}

/** Classifica motivo quando tryPlaceBlock falha após slot encontrado. */
export function classifyPlacementDiscardReason(
  ws: GenerationWorkspace,
  uuid: string,
  start: string,
  size: number,
): { reason: V3BlockDiscardReason; detail: string } {
  if (windowHasT8Conflict(ws, uuid, start, size)) {
    return { reason: "T8_CONFLICT", detail: `janela ${start} (+${size - 1}d) conflita T8/ND` };
  }

  for (let i = 0; i < size; i++) {
    const day = addDays(start, i);
    if (ws.isLockedByAdmin(uuid, day)) {
      return { reason: "REST_CONSTRAINT", detail: `pré-alocação admin em ${day}` };
    }
    if (ws.isDayBlockedForShift(uuid, day)) {
      return { reason: "REST_CONSTRAINT", detail: `dia bloqueado para turno em ${day}` };
    }
  }

  const blockDays = blockDaysFromStart(start, size);
  const code = resolveEmployeeT6T7Code(ws, uuid, blockDays);
  for (let i = 0; i < size; i++) {
    const day = addDays(start, i);
    if (wouldExceedT6T7BlockMax(ws, uuid, day, code)) {
      return { reason: "REST_CONSTRAINT", detail: `excederia bloco T6/T7 max em ${day} (${code})` };
    }
  }

  return {
    reason: "REST_CONSTRAINT",
    detail: `tryAssignShift falhou (${code}, ${start}, ${size}d) — canWork/12h/folgas/rateio`,
  };
}

export class V3BlockMaterializeAuditCollector {
  private readonly byEmployee = new Map<string, V3EmployeeBlockMaterializeAudit>();
  private currentUuid: string | null = null;

  beginEmployee(plan: EmployeeBlockPlan, availableDaysAtStart: number): void {
    this.currentUuid = plan.employeeUuid;
    this.byEmployee.set(plan.employeeUuid, {
      employeeUuid: plan.employeeUuid,
      employeeName: plan.name,
      targetShifts: plan.target,
      availableDaysAtStart,
      plannedBlocks: plan.plannedBlocks.length,
      materializedBlocks: 0,
      discardedBlocks: 0,
      plannedShifts: plan.plannedBlocks.reduce((n, b) => n + b.size, 0),
      materializedShifts: 0,
      discardedShifts: 0,
      discardReasons: {},
      discarded: [],
      materialized: [],
    });
  }

  recordMaterialized(blockIndex: number, plannedSize: number, start: string, shiftCode: string): void {
    const row = this.row();
    if (!row) return;
    row.materializedBlocks++;
    row.materializedShifts += plannedSize;
    row.materialized.push({ blockIndex, plannedSize, startDate: start, shiftCode });
  }

  recordDiscarded(
    ws: GenerationWorkspace,
    blockIndex: number,
    plannedSize: number,
    reason: V3BlockDiscardReason,
    detail: string | undefined,
    trace: V3BlockDiscardTraceInput,
  ): void {
    const row = this.row();
    if (!row) return;
    row.discardedBlocks++;
    row.discardedShifts += plannedSize;
    row.discardReasons[reason] = (row.discardReasons[reason] ?? 0) + 1;
    row.discarded.push({
      blockIndex,
      plannedSize,
      reason,
      detail,
      ...buildBlockDiscardTrace(ws, this.currentUuid!, plannedSize, trace),
    });
  }

  buildReport(): V3BlockMaterializeAudit {
    const employees = [...this.byEmployee.values()].sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName, "pt-BR"),
    );
    const totals = employees.reduce(
      (acc, e) => {
        acc.plannedBlocks += e.plannedBlocks;
        acc.materializedBlocks += e.materializedBlocks;
        acc.discardedBlocks += e.discardedBlocks;
        acc.plannedShifts += e.plannedShifts;
        acc.materializedShifts += e.materializedShifts;
        acc.discardedShifts += e.discardedShifts;
        return acc;
      },
      {
        plannedBlocks: 0,
        materializedBlocks: 0,
        discardedBlocks: 0,
        plannedShifts: 0,
        materializedShifts: 0,
        discardedShifts: 0,
      },
    );
    return { employees, totals };
  }

  private row(): V3EmployeeBlockMaterializeAudit | undefined {
    if (!this.currentUuid) return undefined;
    return this.byEmployee.get(this.currentUuid);
  }
}

export function formatV3BlockMaterializeAudit(audit: V3BlockMaterializeAudit): string {
  const lines: string[] = [
    "===== V3 BLOCK MATERIALIZE AUDIT =====",
    "PLANNED_BLOCKS | MATERIALIZED_BLOCKS | DISCARDED_BLOCKS (por funcionário)",
    "Nome | Target | Disp | Plan | Mat | Desc | PlanTurnos | MatTurnos | DescTurnos",
  ];

  for (const e of audit.employees) {
    lines.push(
      `${e.employeeName} | ${e.targetShifts} | ${e.availableDaysAtStart} | ${e.plannedBlocks} | ${e.materializedBlocks} | ${e.discardedBlocks} | ${e.plannedShifts} | ${e.materializedShifts} | ${e.discardedShifts}`,
    );
  }

  lines.push("");
  lines.push(
    `Totais: plan=${audit.totals.plannedBlocks} mat=${audit.totals.materializedBlocks} desc=${audit.totals.discardedBlocks} | turnos plan=${audit.totals.plannedShifts} mat=${audit.totals.materializedShifts} desc=${audit.totals.discardedShifts}`,
  );

  const withDiscard = audit.employees.filter((e) => e.discardedBlocks > 0);
  if (withDiscard.length === 0) {
    lines.push("");
    lines.push("(nenhum bloco descartado)");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("--- Detalhe por funcionário (descartes) ---");
  for (const e of withDiscard) {
    lines.push("");
    lines.push(
      `${e.employeeName}: planejados=${e.plannedBlocks} materializados=${e.materializedBlocks} descartados=${e.discardedBlocks}`,
    );
    const reasons = Object.entries(e.discardReasons).sort((a, b) => b[1]! - a[1]!);
    if (reasons.length > 0) {
      lines.push("motivos:");
      for (const [code, count] of reasons) {
        lines.push(`  ${code}: ${count}`);
      }
    }
    for (const d of e.discarded) {
      lines.push(
        `  bloco #${d.blockIndex + 1} size=${d.plannedSize} → ${d.reason}${d.detail ? ` (${d.detail})` : ""}`,
      );
      lines.push(
        `    slot=${d.findSpacedConsecutiveSlotResult ?? "null"} | tryPlace=${d.tryPlaceBlockResult ?? "null"} | maxSeq=${d.maxConsecutiveFree} req=${d.requiredSequence}${d.tryPlaceBlockFailureStep ? ` | falha=${d.tryPlaceBlockFailureStep}` : ""}${d.tryAssignRejectReason ? ` | reason=${d.tryAssignRejectReason}` : ""}${d.tryAssignRejectDetails ? ` (${d.tryAssignRejectDetails})` : ""}`,
      );
    }
    for (const m of e.materialized) {
      lines.push(
        `  OK bloco #${m.blockIndex + 1} size=${m.plannedSize} @ ${m.startDate} ${m.shiftCode}`,
      );
    }
  }

  return lines.join("\n");
}

function matchesFocusName(name: string, focusNames: string[]): boolean {
  const lower = name.toLowerCase();
  return focusNames.some((f) => lower.includes(f.toLowerCase()));
}

/** Trace detalhado de cada bloco descartado em materializeT6T7BlocksStrict. */
export function formatV3BlockMaterializeDiscardTrace(
  audit: V3BlockMaterializeAudit,
  focusNames?: string[],
): string {
  const lines: string[] = [
    "===== V3 MATERIALIZE DISCARD TRACE =====",
    "materializeT6T7BlocksStrict — blocos descartados",
    "",
    "Func | Bloco | Size | Data tentativa | Motivo | MaiorSeqLivre | SeqReq | findSpacedConsecutiveSlot | tryPlaceBlock | Falha tryPlace | reason | details",
  ];

  const employees = focusNames?.length
    ? audit.employees.filter((e) => matchesFocusName(e.employeeName, focusNames))
    : audit.employees.filter((e) => e.discardedBlocks > 0);

  for (const e of employees) {
    if (e.discarded.length === 0) continue;
    lines.push("");
    lines.push(
      `${e.employeeName}: planTurnos=${e.plannedShifts} matTurnos=${e.materializedShifts} descTurnos=${e.discardedShifts}`,
    );
    for (const d of e.discarded) {
      lines.push(
        [
          e.employeeName,
          `#${d.blockIndex + 1}`,
          d.plannedSize,
          d.attemptedStartDate ?? "—",
          `${d.reason}${d.detail ? ` (${d.detail})` : ""}`,
          d.maxConsecutiveFree,
          d.requiredSequence,
          d.findSpacedConsecutiveSlotResult ?? "null",
          d.tryPlaceBlockResult ?? "null",
          d.tryPlaceBlockFailureStep ?? "—",
          d.tryAssignRejectReason ?? "—",
          d.tryAssignRejectDetails ?? "—",
        ].join(" | "),
      );
      if (d.tryPlaceBlockFailureStep?.includes("tryAssignShift")) {
        lines.push(
          `  → ${d.tryPlaceBlockFailureStep}${d.tryAssignRejectReason ? ` | reason=${d.tryAssignRejectReason}` : ""}${d.tryAssignRejectDetails ? ` (${d.tryAssignRejectDetails})` : ""}`,
        );
      }
    }
    for (const m of e.materialized) {
      lines.push(
        `  OK #${m.blockIndex + 1} size=${m.plannedSize} @ ${m.startDate} ${m.shiftCode}`,
      );
    }
  }

  if (employees.every((e) => e.discarded.length === 0)) {
    lines.push("");
    lines.push(focusNames?.length ? "(nenhum descarte para foco informado)" : "(nenhum bloco descartado)");
  }

  return lines.join("\n");
}
