import type { GenerationWorkspace } from "./generation-workspace.js";
import { buildTurnRateioAudit } from "./turn-rateio-audit.js";
import { countRateioTurns } from "./pao-rateio-shifts.js";
import { buildWorkspaceFromGenerationResult } from "./schedule-generation-state.js";
import type { GenerationInput, GenerationResult } from "../generation-types.js";

export const DEFAULT_PERSISTENCE_FOCUS = ["Lucas", "Gustavo", "Alexandre"];

export interface PersistenceFocusRow {
  name: string;
  gridTotal: number;
  ctxTotal: number;
  t6: number;
  t7: number;
  t8: number;
  gridSig: string;
}

export interface PersistenceFocusSnapshot {
  label: string;
  rows: PersistenceFocusRow[];
  assignmentCount: number;
}

function findPaoByNamePart(ws: GenerationWorkspace, namePart: string) {
  return ws.paoEmps.find((e) =>
    e.employee.name.toLowerCase().includes(namePart.toLowerCase()),
  );
}

function gridSignature(ws: GenerationWorkspace, uuid: string): string {
  return ws
    .toAssignments()
    .filter((a) => a.employeeUuid === uuid)
    .map((a) => `${a.date}:${a.shiftCode}`)
    .sort()
    .join("|");
}

/** Snapshot foco — grid (planned), ctx (rateio) e assinatura do grid. */
export function capturePersistenceFocus(
  ws: GenerationWorkspace,
  label: string,
  focusNames: string[] = DEFAULT_PERSISTENCE_FOCUS,
): PersistenceFocusSnapshot {
  ws.syncRateioContext();
  const ctx = ws.ensureRateioContext();
  const rows: PersistenceFocusRow[] = [];

  for (const part of focusNames) {
    const emp = findPaoByNamePart(ws, part);
    if (!emp) continue;
    const uuid = emp.uuid;
    const t6 = ctx.currentT6Counts.get(uuid) ?? 0;
    const t7 = ctx.currentT7Counts.get(uuid) ?? 0;
    const t8 = ctx.currentT8Counts.get(uuid) ?? 0;
    const t9 = ctx.currentT9Counts.get(uuid) ?? 0;
    rows.push({
      name: emp.employee.name,
      gridTotal: countRateioTurns(ws, uuid),
      ctxTotal: t6 + t7 + t8 + t9,
      t6,
      t7,
      t8,
      gridSig: gridSignature(ws, uuid),
    });
  }

  return {
    label,
    rows,
    assignmentCount: ws.toAssignments().length,
  };
}

export function formatPersistenceFocusSnapshot(snap: PersistenceFocusSnapshot): string {
  const lines = [
    `--- Persistência foco: ${snap.label} (assignments=${snap.assignmentCount}) ---`,
    "nome | grid | ctx | T6 | T7 | T8 | gridSig(len)",
  ];
  for (const r of snap.rows) {
    lines.push(
      `${r.name} | ${r.gridTotal} | ${r.ctxTotal} | ${r.t6} | ${r.t7} | ${r.t8} | ${r.gridSig.length}`,
    );
  }
  return lines.join("\n");
}

export function comparePersistenceFocusSnapshots(
  before: PersistenceFocusSnapshot,
  after: PersistenceFocusSnapshot,
): string {
  const lines = [
    `===== PERSISTÊNCIA FOCO: ${before.label} → ${after.label} =====`,
  ];
  let mutated = false;

  for (const b of before.rows) {
    const a = after.rows.find((r) => r.name === b.name);
    if (!a) {
      lines.push(`${b.name}: ausente em "${after.label}"`);
      mutated = true;
      continue;
    }
    const gridChanged = b.gridTotal !== a.gridTotal || b.gridSig !== a.gridSig;
    const ctxChanged = b.ctxTotal !== a.ctxTotal;
    if (gridChanged || ctxChanged) {
      mutated = true;
      lines.push(
        `${b.name}: grid ${b.gridTotal}→${a.gridTotal} ctx ${b.ctxTotal}→${a.ctxTotal}` +
          (b.gridSig !== a.gridSig ? " | gridSig MUDOU" : ""),
      );
    } else {
      lines.push(`${b.name}: estável (grid=${a.gridTotal} ctx=${a.ctxTotal})`);
    }
  }

  lines.push(mutated ? "Veredito: MUTAÇÃO entre checkpoints" : "Veredito: estável entre checkpoints");
  return lines.join("\n");
}

/** Compara grid vivo vs reconstruído (buildWorkspaceFromGenerationResult / audit). */
export function diagnoseReconstructionDrift(
  input: GenerationInput,
  result: GenerationResult,
  focusNames: string[] = DEFAULT_PERSISTENCE_FOCUS,
): string {
  const live = buildWorkspaceFromGenerationResult(input, result);
  live.syncRateioContext();
  const liveSnap = capturePersistenceFocus(live, "result.assignments → buildWorkspaceFromGenerationResult", focusNames);

  const audit = buildTurnRateioAudit(live, live.ensureRateioContext());
  const lines = [
    "===== DRIFT: grid vs buildTurnRateioAudit =====",
    "nome | grid (countRateioTurns) | audit (ctx sum) | delta",
  ];
  let drift = false;

  for (const part of focusNames) {
    const emp = live.paoEmps.find((e) =>
      e.employee.name.toLowerCase().includes(part.toLowerCase()),
    );
    if (!emp) continue;
    const row = liveSnap.rows.find((r) => r.name === emp.employee.name);
    const auditRow = audit.find((a) => a.employeeId === emp.uuid);
    const grid = row?.gridTotal ?? 0;
    const auditTotal = auditRow?.totalTurns ?? 0;
    const delta = grid - auditTotal;
    if (delta !== 0) drift = true;
    lines.push(`${emp.employee.name} | ${grid} | ${auditTotal} | ${delta}`);
  }

  lines.push(
    drift
      ? "Veredito: DRIFT grid≠audit (reconstrução/contadores)"
      : "Veredito: grid alinhado com buildTurnRateioAudit",
  );
  return lines.join("\n");
}

export function formatPersistenceTraceLog(
  snapshots: PersistenceFocusSnapshot[],
): string {
  if (snapshots.length === 0) return "(nenhum snapshot de persistência)";
  const parts = snapshots.map(formatPersistenceFocusSnapshot);

  const lastEnforce = [...snapshots]
    .reverse()
    .find((s) => s.label.includes("depois enforceProportionalTurnTargets"));
  const beforeSave = snapshots.find((s) => s.label.includes("antes do save"));

  if (lastEnforce && beforeSave) {
    parts.push(
      comparePersistenceFocusSnapshots(lastEnforce, beforeSave).replace(
        "Veredito:",
        "Veredito (enforce → save):",
      ),
    );
  } else if (snapshots.length >= 2) {
    parts.push(comparePersistenceFocusSnapshots(snapshots[0]!, snapshots[snapshots.length - 1]!));
  }
  return parts.join("\n\n");
}
