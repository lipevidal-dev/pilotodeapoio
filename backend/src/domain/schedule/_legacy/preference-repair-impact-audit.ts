import type { ShiftCode } from "./assignment-eligibility.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { isRateioTurnShiftCode, countRateioTurns } from "./pao-rateio-shifts.js";
import type { ScheduleRateioContext } from "./schedule-rateio-context.js";
import { formatPaoPoolSeniority } from "./pao-pool-seniority.js";

export interface PreferenceCheckpointRow {
  employeeUuid: string;
  name: string;
  preferredShift: ShiftCode | null;
  cadastralSeniority: number;
  poolRank: number;
  poolSize: number;
  totalTurns: number;
  preferredCount: number;
  attendancePercent: number | null;
}

export interface PreferenceCheckpoint {
  label: string;
  rows: PreferenceCheckpointRow[];
  /** uuid → date → shift (somente turnos rateio). */
  grid: Map<string, Map<string, string>>;
}

export interface PreferenceSlotChange {
  date: string;
  preferredShift: ShiftCode;
  previousShift: ShiftCode;
  newShift: string | null;
  kind: "PREFERRED_REMOVED" | "PREFERRED_REPLACED" | "NON_PREFERRED_ADDED";
}

export interface PreferenceRepairImpactRow {
  employeeUuid: string;
  name: string;
  preferredShift: ShiftCode;
  cadastralSeniority: number;
  poolRank: number;
  poolSize: number;
  totalTurnsBefore: number;
  totalTurnsAfter: number;
  preferredBefore: number;
  preferredAfter: number;
  preferredRemoved: number;
  preferredAdded: number;
  nonPreferredAdded: number;
  attendanceBefore: number;
  attendanceAfter: number;
  attendanceDelta: number;
  slotChanges: PreferenceSlotChange[];
}

export interface PreferenceRepairImpactSummary {
  checkpointBefore: string;
  checkpointAfter: string;
  rows: PreferenceRepairImpactRow[];
  totalPreferredRemoved: number;
  totalPreferredAdded: number;
  totalNonPreferredAdded: number;
}

function captureRateioGrid(ws: GenerationWorkspace): Map<string, Map<string, string>> {
  const grid = new Map<string, Map<string, string>>();
  for (const a of ws.toAssignments()) {
    if (!isRateioTurnShiftCode(a.shiftCode)) continue;
    const days = grid.get(a.employeeUuid) ?? new Map<string, string>();
    days.set(a.date, a.shiftCode.toUpperCase());
    grid.set(a.employeeUuid, days);
  }
  return grid;
}

/** Snapshot de atendimento à preferência em um checkpoint do pipeline. */
export function capturePreferenceCheckpoint(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  label: string,
): PreferenceCheckpoint {
  const grid = captureRateioGrid(ws);
  const rows: PreferenceCheckpointRow[] = [];

  for (const c of ws.paoEmps) {
    const preferred = ctx.preferredShiftByEmployee.get(c.uuid) ?? null;
    const pool = ctx.paoPoolSeniorityByEmployee.get(c.uuid);
    const totalTurns = countRateioTurns(ws, c.uuid);
    const days = grid.get(c.uuid);
    let preferredCount = 0;
    if (preferred && days) {
      for (const code of days.values()) {
        if (code === preferred) preferredCount++;
      }
    }
    const attendancePercent =
      preferred && totalTurns > 0
        ? Math.round((preferredCount / totalTurns) * 100)
        : preferred
          ? 0
          : null;

    rows.push({
      employeeUuid: c.uuid,
      name: c.employee.name,
      preferredShift: preferred,
      cadastralSeniority: c.employee.seniority,
      poolRank: pool?.poolRank ?? 0,
      poolSize: pool?.poolSize ?? ws.paoEmps.length,
      totalTurns,
      preferredCount,
      attendancePercent,
    });
  }

  rows.sort((a, b) => a.poolRank - b.poolRank || a.name.localeCompare(b.name, "pt-BR"));
  return { label, rows, grid };
}

function rowByUuid(checkpoint: PreferenceCheckpoint, uuid: string): PreferenceCheckpointRow | undefined {
  return checkpoint.rows.find((r) => r.employeeUuid === uuid);
}

/** Diff entre dois checkpoints — foco em perda/ganho de turnos preferidos. */
export function buildPreferenceRepairImpact(
  before: PreferenceCheckpoint,
  after: PreferenceCheckpoint,
): PreferenceRepairImpactSummary {
  const rows: PreferenceRepairImpactRow[] = [];
  let totalPreferredRemoved = 0;
  let totalPreferredAdded = 0;
  let totalNonPreferredAdded = 0;

  for (const bRow of before.rows) {
    const preferred = bRow.preferredShift;
    if (!preferred) continue;

    const aRow = rowByUuid(after, bRow.employeeUuid);
    const beforeDays = before.grid.get(bRow.employeeUuid) ?? new Map();
    const afterDays = after.grid.get(bRow.employeeUuid) ?? new Map();

    const slotChanges: PreferenceSlotChange[] = [];
    for (const [date, shift] of beforeDays) {
      if (shift !== preferred) continue;
      const now = afterDays.get(date) ?? null;
      if (now === preferred) continue;

      if (now == null) {
        slotChanges.push({
          date,
          preferredShift: preferred,
          previousShift: shift as ShiftCode,
          newShift: null,
          kind: "PREFERRED_REMOVED",
        });
      } else {
        slotChanges.push({
          date,
          preferredShift: preferred,
          previousShift: shift as ShiftCode,
          newShift: now,
          kind: "PREFERRED_REPLACED",
        });
      }
    }

    for (const [date, shift] of afterDays) {
      if (shift !== preferred) continue;
      if (beforeDays.get(date) === preferred) continue;
      slotChanges.push({
        date,
        preferredShift: preferred,
        previousShift: (beforeDays.get(date) ?? shift) as ShiftCode,
        newShift: shift,
        kind: "NON_PREFERRED_ADDED",
      });
    }

    slotChanges.sort((x, y) => x.date.localeCompare(y.date));

    const preferredBefore = bRow.preferredCount;
    const preferredAfter = aRow?.preferredCount ?? 0;
    const removed = Math.max(0, preferredBefore - preferredAfter);
    const added = Math.max(0, preferredAfter - preferredBefore);
    const nonPrefBefore = bRow.totalTurns - preferredBefore;
    const nonPrefAfter = (aRow?.totalTurns ?? bRow.totalTurns) - preferredAfter;
    const nonPreferredAdded = Math.max(0, nonPrefAfter - nonPrefBefore);
    totalPreferredRemoved += removed;
    totalPreferredAdded += added;
    totalNonPreferredAdded += nonPreferredAdded;

    const attendanceBefore = bRow.attendancePercent ?? 0;
    const attendanceAfter = aRow?.attendancePercent ?? 0;

    rows.push({
      employeeUuid: bRow.employeeUuid,
      name: bRow.name,
      preferredShift: preferred,
      cadastralSeniority: bRow.cadastralSeniority,
      poolRank: bRow.poolRank,
      poolSize: bRow.poolSize,
      totalTurnsBefore: bRow.totalTurns,
      totalTurnsAfter: aRow?.totalTurns ?? bRow.totalTurns,
      preferredBefore,
      preferredAfter,
      preferredRemoved: removed,
      preferredAdded: added,
      nonPreferredAdded,
      attendanceBefore,
      attendanceAfter,
      attendanceDelta: attendanceAfter - attendanceBefore,
      slotChanges,
    });
  }

  rows.sort((a, b) => b.preferredRemoved - a.preferredRemoved || a.poolRank - b.poolRank);

  return {
    checkpointBefore: before.label,
    checkpointAfter: after.label,
    rows,
    totalPreferredRemoved,
    totalPreferredAdded,
    totalNonPreferredAdded,
  };
}

function formatPoolLabel(r: { cadastralSeniority: number; poolRank: number; poolSize: number; employeeUuid: string }): string {
  return formatPaoPoolSeniority({
    employeeUuid: r.employeeUuid,
    cadastralSeniority: r.cadastralSeniority,
    poolRank: r.poolRank,
    poolSize: r.poolSize,
  });
}

export function formatPreferenceCheckpointTable(checkpoint: PreferenceCheckpoint): string {
  const lines = [
    `--- Checkpoint: ${checkpoint.label} ---`,
    "Nome | pool | pref | total | preferidos | atendimento",
  ];
  for (const r of checkpoint.rows.filter((x) => x.preferredShift)) {
    lines.push(
      `${r.name} | ${formatPoolLabel({ ...r, employeeUuid: r.employeeUuid })} | ${r.preferredShift} | ${r.totalTurns} | ${r.preferredCount} | ${r.attendancePercent ?? 0}%`,
    );
  }
  return lines.join("\n");
}

export function formatPreferenceRepairImpact(summary: PreferenceRepairImpactSummary): string {
  const lines: string[] = [
    "===== IMPACTO NA PREFERÊNCIA =====",
    `${summary.checkpointBefore}  →  ${summary.checkpointAfter}`,
    `Slots preferidos removidos (líquido): ${summary.totalPreferredRemoved}`,
    `Slots preferidos adicionados (líquido): ${summary.totalPreferredAdded}`,
    `Turnos não preferidos adicionados (diluição): ${summary.totalNonPreferredAdded}`,
    "",
    "Nome | pref | antes | depois | pref -/+ | não-pref + | Δ% | pool",
  ];

  for (const r of summary.rows) {
    if (
      r.preferredRemoved === 0 &&
      r.preferredAdded === 0 &&
      r.nonPreferredAdded === 0 &&
      r.attendanceDelta === 0
    ) {
      continue;
    }
    lines.push(
      `${r.name} | ${r.preferredShift} | ${r.preferredBefore}/${r.totalTurnsBefore} (${r.attendanceBefore}%) | ` +
        `${r.preferredAfter}/${r.totalTurnsAfter} (${r.attendanceAfter}%) | ` +
        `-${r.preferredRemoved} +${r.preferredAdded} | +${r.nonPreferredAdded} | ` +
        `${r.attendanceDelta >= 0 ? "+" : ""}${r.attendanceDelta}% | ` +
        `${formatPoolLabel(r)}`,
    );
  }

  const withSlots = summary.rows.filter((r) =>
    r.slotChanges.some((s) => s.kind !== "NON_PREFERRED_ADDED"),
  );
  if (withSlots.length > 0) {
    lines.push("");
    lines.push("Detalhe — turnos preferidos perdidos/substituídos:");
    for (const r of withSlots) {
      const losses = r.slotChanges.filter((s) => s.kind !== "NON_PREFERRED_ADDED");
      if (losses.length === 0) continue;
      lines.push(`  ${r.name} (${r.preferredShift}): ${losses.length} slot(s)`);
      for (const s of losses.slice(0, 12)) {
        lines.push(
          `    ${s.date} | ${s.previousShift} → ${s.newShift ?? "(vazio)"} [${s.kind}]`,
        );
      }
      if (losses.length > 12) {
        lines.push(`    ... +${losses.length - 12} slot(s)`);
      }
    }
  }

  return lines.join("\n");
}

/** Relatório completo: todos os checkpoints + deltas entre etapas críticas. */
export function formatPreferenceRepairTraceReport(
  checkpoints: PreferenceCheckpoint[],
  options?: { focusNames?: string[] },
): string {
  const focus = options?.focusNames?.map((n) => n.toLowerCase()) ?? [];
  const matchesFocus = (name: string) =>
    focus.length === 0 || focus.some((f) => name.toLowerCase().includes(f));

  const lines: string[] = [
    "===== RASTREIO PREFERÊNCIA — CHECKPOINTS V5 =====",
    "",
  ];

  for (const cp of checkpoints) {
    lines.push(formatPreferenceCheckpointTable(cp));
    lines.push("");
  }

  const byLabel = new Map(checkpoints.map((c) => [c.label, c]));
  const pairs: Array<[string, string, string]> = [
    ["after_preferred_phase", "before_repair_gaps_final", "Fase complementar (fill+paralelos) → antes V5.5"],
    ["before_repair_gaps_final", "after_repair_gaps_final_v5", "V5.5 minimumOpportunityFill → repairCoverageGapsFinal"],
    ["after_repair_gaps_final_v5", "after_final_coverage_pipeline", "runFinalCoveragePipeline"],
    ["before_repair_gaps_final", "final", "Antes repair → estado final"],
  ];

  for (const [beforeKey, afterKey, title] of pairs) {
    const before = byLabel.get(beforeKey);
    const after = byLabel.get(afterKey);
    if (!before || !after) continue;

    const impact = buildPreferenceRepairImpact(before, after);
    lines.push(`----- ${title} -----`);
    lines.push(formatPreferenceRepairImpact(impact));
    lines.push("");
  }

  if (focus.length > 0) {
    lines.push("----- Foco (atendimento por checkpoint) -----");
    const prefOrder = ["T6", "T7", "T8", "T9"] as const;
    for (const code of prefOrder) {
      const focused = checkpoints[0]?.rows.filter(
        (r) => r.preferredShift === code && matchesFocus(r.name),
      );
      if (!focused || focused.length === 0) continue;

      lines.push("");
      lines.push(`Preferência ${code}:`);
      const header = ["Nome", ...checkpoints.map((c) => c.label)].join(" | ");
      lines.push(header);
      for (const name of [...new Set(focused.map((f) => f.name))]) {
        const cells = [name];
        for (const cp of checkpoints) {
          const row = cp.rows.find((r) => r.name === name);
          cells.push(row?.attendancePercent != null ? `${row.attendancePercent}%` : "-");
        }
        lines.push(cells.join(" | "));
      }
    }
  }

  return lines.join("\n");
}

export function buildPreferenceRepairTraceFromCheckpoints(
  checkpoints: PreferenceCheckpoint[],
): PreferenceRepairImpactSummary | null {
  const byLabel = new Map(checkpoints.map((c) => [c.label, c]));
  const before = byLabel.get("before_repair_gaps_final");
  const after = byLabel.get("after_repair_gaps_final_v5");
  if (!before || !after) return null;
  return buildPreferenceRepairImpact(before, after);
}
