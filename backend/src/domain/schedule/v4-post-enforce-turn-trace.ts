import { addDays } from "../rules/dates.js";
import { blockOptimizer } from "./block-optimizer.js";
import { buildTurnRateioAudit } from "./turn-rateio-audit.js";
import type { GeneratedAllocation, GeneratedAssignment, GenerationInput } from "./generation-types.js";
import { GenerationWorkspace } from "./generation-workspace.js";
import { enforceProportionalTurnTargets } from "./enforce-minimum-turn-targets.js";
import { optimizeEmergencyIsolatedT8 } from "./optimize-emergency-isolated-t8.js";
import { countRateioTurns } from "./pao-rateio-shifts.js";
import { deduplicatePaoShiftCoverage } from "./pao-shift-dedup.js";
import {
  repairAllCoverageGapsFinal,
  validateNoCoverageGaps,
} from "./repair-all-coverage-gaps-final.js";
import { repairT8GapsAfterDedup } from "./repair-t8-gaps-after-dedup.js";
import { prepareWorkspaceThroughPreV4Enforce } from "./real-schedule-engine.js";
import { finalizeT8NdBlocks } from "./schedule-grid-source.js";
import { assignmentKey } from "./types.js";
import {
  captureOptimizationSnapshot,
  restoreOptimizationSnapshot,
} from "./workspace-optimization-transaction.js";

export interface TransferCellStatus {
  gustavoT7Jul02: boolean;
  lucasT7Jul15: boolean;
  palombinoT7Jul02: boolean;
  daviT7Jul15: boolean;
}

export interface PostV4TurnSnapshot {
  label: string;
  turnsByName: Record<string, number>;
  transferCells: TransferCellStatus;
}

export interface PostV4EnforceTurnTrace {
  checkpoints: PostV4TurnSnapshot[];
  stepsAfterEnforce: string[];
}

const DEFAULT_FOCUS = ["Gustavo", "Lucas", "Palombino", "Davi", "Antonio"];

function transferCellStatus(ws: GenerationWorkspace, year: number, month: number): TransferCellStatus {
  const pad = (d: number) => `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const jul02 = pad(2);
  const jul15 = pad(15);

  const shiftOn = (namePart: string, day: string): boolean => {
    const emp = ws.paoEmps.find((e) => e.employee.name.toLowerCase().includes(namePart.toLowerCase()));
    if (!emp) return false;
    const did = ws.uuidToDomain.get(emp.uuid);
    if (!did) return false;
    return ws.planned.get(assignmentKey(did, day)) === "T7";
  };

  return {
    gustavoT7Jul02: shiftOn("Gustavo", jul02),
    lucasT7Jul15: shiftOn("Lucas", jul15),
    palombinoT7Jul02: shiftOn("Palombino", jul02),
    daviT7Jul15: shiftOn("Davi", jul15),
  };
}

function snapshotTurns(ws: GenerationWorkspace, label: string): PostV4TurnSnapshot {
  const turnsByName: Record<string, number> = {};
  for (const emp of ws.paoEmps) {
    turnsByName[emp.employee.name] = countRateioTurns(ws, emp.uuid);
  }
  return {
    label,
    turnsByName,
    transferCells: transferCellStatus(ws, ws.input.year, ws.input.month),
  };
}

function buildAuditWsFromGrid(
  input: GenerationInput,
  assignments: GeneratedAssignment[],
  allocations: GeneratedAllocation[],
): GenerationWorkspace {
  const auditWs = new GenerationWorkspace(input);
  auditWs.applyHardBlocks();
  for (const a of assignments) {
    const did = auditWs.uuidToDomain.get(a.employeeUuid);
    if (did == null) continue;
    auditWs.planned.set(assignmentKey(did, a.date), a.shiftCode);
  }
  for (const al of allocations) {
    auditWs.lockDay(al.employeeUuid, al.date, al.label, false);
  }
  auditWs.initRateioContext();
  for (const a of assignments) {
    if (a.shiftCode !== "T8") continue;
    const prev = addDays(a.date, -1);
    const next = addDays(a.date, 1);
    const prevT8 = assignments.some(
      (x) => x.employeeUuid === a.employeeUuid && x.date === prev && x.shiftCode === "T8",
    );
    const nextT8 = assignments.some(
      (x) => x.employeeUuid === a.employeeUuid && x.date === next && x.shiftCode === "T8",
    );
    if (!prevT8 && !nextT8) {
      auditWs.markEmergencyIsolatedT8(a.employeeUuid, a.date);
    }
  }
  auditWs.syncRateioContext();
  return auditWs;
}

/**
 * Replay pós-[11d]: snapshots de turnos após enforceProportionalTurnTargets e etapas seguintes.
 * Identifica em qual checkpoint turnos transferidos (V4) somem do grid.
 */
export function tracePostV4EnforceTurnSnapshots(ws: GenerationWorkspace): PostV4EnforceTurnTrace {
  const checkpoints: PostV4TurnSnapshot[] = [];
  const stepsAfterEnforce = [
    "enforceProportionalTurnTargets [11d]",
    "blockOptimizer.optimize [12]",
    "correctMonoFolgasPedidas + repairIsolatedT8 + cleanupOrphanNd + ensureNdForT8Pairs + reconcileNdAfterParallelShifts + revalidateCoverageAfterBalance",
    "enforceProportionalTurnTargets [12b] pós-optimizer",
    "runFinalCoveragePipeline [13a] dedup + repairT8GapsAfterDedup",
    "runFinalCoveragePipeline [13b] repairAllCoverageGapsFinal #1",
    "runFinalCoveragePipeline [13c] enforceProportionalTurnTargets (3ª chamada)",
    "runFinalCoveragePipeline [13d] optimizeEmergencyIsolatedT8",
    "runFinalCoveragePipeline [13e] repairAllCoverageGapsFinal #2 + dedup + #3",
    "toAssignments (antes save)",
    "buildTurnRateioAudit (auditWs reconstruído)",
  ];

  const record = (label: string) => {
    checkpoints.push(snapshotTurns(ws, label));
  };

  record("antes enforce [11d]");
  enforceProportionalTurnTargets(ws);
  record("depois enforce [11d]");

  blockOptimizer.optimize(ws);
  record("depois block optimizer [12]");

  ws.correctMonoFolgasPedidas();
  ws.repairIsolatedT8();
  ws.cleanupOrphanNd();
  ws.ensureNdForT8Pairs();
  ws.reconcileNdAfterParallelShifts();
  ws.revalidateCoverageAfterBalance();
  record("depois cleanup pós-optimizer");

  ws.syncRateioContext();
  enforceProportionalTurnTargets(ws);
  record("depois enforce pós-optimizer [12b]");

  const ctx = ws.ensureRateioContext();
  finalizeT8NdBlocks(ws);
  deduplicatePaoShiftCoverage(ws);
  repairT8GapsAfterDedup(ws);
  finalizeT8NdBlocks(ws);
  repairAllCoverageGapsFinal(ws, ctx);
  finalizeT8NdBlocks(ws);
  record("depois repairAllCoverageGapsFinal #1 [13b]");

  ws.syncRateioContext();
  enforceProportionalTurnTargets(ws);
  record("depois enforce pipeline [13c]");

  const preOptimizeSnapshot = captureOptimizationSnapshot(ws);
  optimizeEmergencyIsolatedT8(ws, ctx);
  record("depois optimizeEmergencyIsolatedT8 [13d]");

  repairAllCoverageGapsFinal(ws, ctx);
  finalizeT8NdBlocks(ws);
  deduplicatePaoShiftCoverage(ws);
  repairAllCoverageGapsFinal(ws, ctx);
  finalizeT8NdBlocks(ws);
  record("depois repairAllCoverageGapsFinal #2+#3 [13e]");

  let gapViolations = validateNoCoverageGaps(ws);
  if (gapViolations.length > 0) {
    restoreOptimizationSnapshot(ws, preOptimizeSnapshot);
    finalizeT8NdBlocks(ws);
    deduplicatePaoShiftCoverage(ws);
    repairAllCoverageGapsFinal(ws, ctx);
    finalizeT8NdBlocks(ws);
    gapViolations = validateNoCoverageGaps(ws);
    record("depois rollback T8 otim [13e-rollback]");
  }

  const assignments = ws.toAssignments();
  record("antes save (toAssignments)");

  const auditWs = buildAuditWsFromGrid(inputFromWs(ws), assignments, ws.allocations);
  const audits = buildTurnRateioAudit(auditWs, auditWs.rateioContext!);
  const auditTurns: Record<string, number> = {};
  for (const row of audits) {
    auditTurns[row.employeeName] = row.totalTurns;
  }
  checkpoints.push({
    label: "depois buildTurnRateioAudit",
    turnsByName: auditTurns,
    transferCells: transferCellStatus(auditWs, ws.input.year, ws.input.month),
  });

  return { checkpoints, stepsAfterEnforce };
}

function inputFromWs(ws: GenerationWorkspace): GenerationInput {
  return ws.input;
}

export function runPostV4EnforceTurnTrace(input: GenerationInput): PostV4EnforceTurnTrace {
  const ws = prepareWorkspaceThroughPreV4Enforce(input);
  return tracePostV4EnforceTurnSnapshots(ws);
}

export function formatPostV4EnforceTurnTrace(
  trace: PostV4EnforceTurnTrace,
  focusNames: string[] = DEFAULT_FOCUS,
): string {
  const lines: string[] = [
    "===== V4 PÓS-ENFORCE — SNAPSHOT TURNOS =====",
    "Transferências esperadas: Palombino→Gustavo T7 02/07 | Davi→Lucas T7 15/07",
    "",
    "Etapas após enforceProportionalTurnTargets [11d]:",
    ...trace.stepsAfterEnforce.map((s) => `  • ${s}`),
    "",
    "Etapas que podem remover/sobrescrever assignments:",
    "  • blockOptimizer — move/swap T6/T7",
    "  • deduplicatePaoShiftCoverage — remove PAO extra no mesmo turno/dia (senioridade)",
    "  • repairAllCoverageGapsFinal — realoca T6/T7/T8 para fechar gaps",
    "  • optimizeEmergencyIsolatedT8 — pode unassign T8 isolado",
    "  • enforceProportionalTurnTargets (12b e pipeline [13]) — transferências/donor unassign",
    "  • rollback T8 optimization se gaps persistirem",
    "",
  ];

  const resolvedFocus = focusNames.flatMap((focus) => {
    const names = new Set<string>();
    for (const cp of trace.checkpoints) {
      for (const name of Object.keys(cp.turnsByName)) {
        if (name.toLowerCase().includes(focus.toLowerCase())) names.add(name);
      }
    }
    return names.size > 0 ? [...names] : [focus];
  });
  const uniqueFocus = [...new Set(resolvedFocus)];

  lines.push(`Turnos por checkpoint (${uniqueFocus.join(", ")}):`);
  lines.push(["Checkpoint", ...uniqueFocus].join(" | "));

  const baseline = trace.checkpoints[0];
  for (const cp of trace.checkpoints) {
    const cols = uniqueFocus.map((name) => {
      const turns = cp.turnsByName[name];
      if (turns == null) return "—";
      const base = baseline?.turnsByName[name];
      if (base != null && cp !== baseline && turns !== base) {
        const delta = turns - base;
        return `${turns} (${delta >= 0 ? "+" : ""}${delta})`;
      }
      return String(turns);
    });
    lines.push([cp.label, ...cols].join(" | "));
  }

  lines.push("");
  lines.push("Células das transferências V4 (T7 presente no grid?):");
  lines.push("Checkpoint | Gustavo 02/07 | Lucas 15/07 | Palombino 02/07 | Davi 15/07");
  for (const cp of trace.checkpoints) {
    const c = cp.transferCells;
    lines.push(
      [
        cp.label,
        c.gustavoT7Jul02 ? "SIM" : "NÃO",
        c.lucasT7Jul15 ? "SIM" : "NÃO",
        c.palombinoT7Jul02 ? "SIM" : "NÃO",
        c.daviT7Jul15 ? "SIM" : "NÃO",
      ].join(" | "),
    );
  }

  const afterEnforce = trace.checkpoints.find((c) => c.label.startsWith("depois enforce [11d]"));
  const beforeSave = trace.checkpoints.find((c) => c.label.startsWith("antes save"));
  const afterAudit = trace.checkpoints.find((c) => c.label.startsWith("depois buildTurnRateioAudit"));

  if (afterEnforce) {
    lines.push("");
    lines.push("--- Delta de turnos por checkpoint (Gustavo/Lucas) ---");
    for (const focus of ["Gustavo", "Lucas"]) {
      let prevTurns: number | undefined;
      let prevLabel = afterEnforce.label;
      const name = Object.keys(afterEnforce.turnsByName).find((n) =>
        n.toLowerCase().includes(focus.toLowerCase()),
      );
      if (!name) continue;
      prevTurns = afterEnforce.turnsByName[name];
      for (const cp of trace.checkpoints) {
        if (cp === afterEnforce) continue;
        const after = cp.turnsByName[name];
        if (prevTurns != null && after != null && after !== prevTurns) {
          const sign = after > prevTurns ? "+" : "";
          lines.push(
            `  ${name}: ${prevTurns}→${after} (${sign}${after - prevTurns}) entre "${prevLabel}" e "${cp.label}"`,
          );
        }
        if (after != null) {
          prevTurns = after;
          prevLabel = cp.label;
        }
      }
    }

    lines.push("");
    lines.push("--- Células V4: transferência aplicou no grid? ---");
    const afterEnforceCells = afterEnforce.transferCells;
    const finalCp = beforeSave ?? afterAudit ?? trace.checkpoints[trace.checkpoints.length - 1];
    if (finalCp) {
      const neverReceived =
        !afterEnforceCells.gustavoT7Jul02 &&
        !finalCp.transferCells.gustavoT7Jul02;
      const lucasNever =
        !afterEnforceCells.lucasT7Jul15 && !finalCp.transferCells.lucasT7Jul15;
      if (neverReceived || lucasNever) {
        lines.push(
          "  Palombino→Gustavo T7 02/07 e Davi→Lucas T7 15/07 NUNCA aparecem no grid pós-[11d].",
        );
        lines.push(
          "  auditV4Transfers() é dry-run no grid final (restaura snapshot) — aceites não persistem.",
        );
      }
    }
  }

  if (beforeSave && afterAudit) {
    const gSave = Object.entries(beforeSave.turnsByName).find(([n]) => n.includes("Gustavo"))?.[1];
    const gAudit = Object.entries(afterAudit.turnsByName).find(([n]) => n.includes("Gustavo"))?.[1];
    const lSave = Object.entries(beforeSave.turnsByName).find(([n]) => n.includes("Lucas"))?.[1];
    const lAudit = Object.entries(afterAudit.turnsByName).find(([n]) => n.includes("Lucas"))?.[1];
    if (gSave !== gAudit || lSave !== lAudit) {
      lines.push("");
      lines.push(
        `Divergência grid vs buildTurnRateioAudit: Gustavo grid=${gSave} audit=${gAudit}; Lucas grid=${lSave} audit=${lAudit}`,
      );
    }
  }

  return lines.join("\n");
}
