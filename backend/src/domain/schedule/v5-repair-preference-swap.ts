import { addDays } from "../rules/dates.js";
import type { ShiftCode } from "./assignment-eligibility.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { isRateioTurnShiftCode } from "./pao-rateio-shifts.js";
import type { ScheduleRateioContext } from "./schedule-rateio-context.js";
import { syncRateioCountsFromWorkspace } from "./schedule-rateio-context.js";
import { shouldDeferNonPreferredFill } from "./v5-preferred-phase-guard.js";
import { lockedPreferredShiftOnDay } from "./v5-preference-lock-final.js";
import type { ValidationIssue } from "./types.js";

export interface V5RepairPreferenceSwapLog {
  date: string;
  harmedName: string;
  currentShift: string;
  desiredShift: string;
  swappedWith: string;
  result: "OK" | "FAILED";
  reason: string;
}

export function clearV5RepairPreferenceSwapAudit(ws: GenerationWorkspace): void {
  ws.v5RepairPreferenceSwapLog.length = 0;
}

function employeeName(ws: GenerationWorkspace, uuid: string): string {
  return ws.input.employees.find((e) => e.uuid === uuid)?.employee.name ?? uuid;
}

function shiftOnDay(ws: GenerationWorkspace, uuid: string, day: string): string | undefined {
  return ws.toAssignments().find((a) => a.employeeUuid === uuid && a.date === day)?.shiftCode;
}

/** Perfil 100% T8 — não remover T8 em swap. */
export function mustPreserveT8PreferenceProfile(
  ws: GenerationWorkspace,
  uuid: string,
): boolean {
  const ctx = ws.ensureRateioContext();
  const pref = ctx.preferredShiftByEmployee.get(uuid);
  if (pref !== "T8") return false;
  return shouldDeferNonPreferredFill(ws, uuid, "T8");
}

function preferenceAttendance(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  uuid: string,
): number | null {
  const pref = ctx.preferredShiftByEmployee.get(uuid);
  if (!pref) return null;
  let total = 0;
  let match = 0;
  for (const a of ws.toAssignments()) {
    if (a.employeeUuid !== uuid) continue;
    if (!isRateioTurnShiftCode(a.shiftCode)) continue;
    total++;
    if (a.shiftCode.toUpperCase() === pref) match++;
  }
  if (total === 0) return null;
  return match / total;
}

interface HarmCandidate {
  uuid: string;
  name: string;
  preferred: ShiftCode;
  attendance: number;
}

function listPreferenceHarmCandidates(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
): HarmCandidate[] {
  const out: HarmCandidate[] = [];
  for (const c of ws.paoEmps) {
    const preferred = ctx.preferredShiftByEmployee.get(c.uuid);
    if (!preferred || preferred === "T9") continue;
    const attendance = preferenceAttendance(ws, ctx, c.uuid);
    if (attendance == null || attendance >= 1) continue;
    const hasNonPref = ws.toAssignments().some(
      (a) =>
        a.employeeUuid === c.uuid &&
        isRateioTurnShiftCode(a.shiftCode) &&
        a.shiftCode.toUpperCase() !== preferred,
    );
    if (!hasNonPref) continue;
    out.push({
      uuid: c.uuid,
      name: c.employee.name,
      preferred,
      attendance,
    });
  }
  out.sort((a, b) => a.attendance - b.attendance || a.name.localeCompare(b.name, "pt-BR"));
  return out;
}

function donorTier(ctx: ScheduleRateioContext, uuid: string, receives: ShiftCode): number {
  const pref = ctx.preferredShiftByEmployee.get(uuid);
  if (pref === receives) return 0;
  if (!pref) return 1;
  if (pref === "T7" && receives === "T7") return 0;
  if (pref === "T8" && receives === "T7") return 1;
  if (pref === "T6") return 9;
  return 2;
}

function listDonorsForDaySwap(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  day: string,
  desired: ShiftCode,
  beneficiaryUuid: string,
): string[] {
  const holder = ws.findPaoOnShift(day, desired);
  if (!holder || holder === beneficiaryUuid) return [];

  if (mustPreserveT8PreferenceProfile(ws, holder)) return [];
  if (isSwapDayStructurallyBlocked(ws, holder, day)) return [];
  if (ws.isLockedByAdmin(holder, day)) return [];

  const donorPref = ctx.preferredShiftByEmployee.get(holder);
  if (donorPref === desired) return [];

  return [holder].sort(
    (a, b) => donorTier(ctx, a, desired) - donorTier(ctx, b, desired),
  );
}

function canRemoveShiftForSwap(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
  code: ShiftCode,
): string | null {
  if (ws.isLockedByAdmin(uuid, day)) return "dia locked admin";
  if (mustPreserveT8PreferenceProfile(ws, uuid) && code === "T8") {
    return "perfil 100% T8 protegido";
  }
  if (lockedPreferredShiftOnDay(ws, uuid, day) === code) {
    return "slot preferido locked (V5.4)";
  }
  if (isSwapDayStructurallyBlocked(ws, uuid, day)) return "bloco T8/T8/ND protegido";
  if (shiftOnDay(ws, uuid, day)?.toUpperCase() !== code) return "turno ausente";
  return null;
}

function rollbackSwap(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  beneficiaryUuid: string,
  donorUuid: string,
  day: string,
  beneficiaryShift: ShiftCode,
  donorShift: ShiftCode,
): void {
  ws.unassignShift(beneficiaryUuid, day, { bypassT8Protection: true });
  ws.unassignShift(donorUuid, day, { bypassT8Protection: true });
  ws.tryAssignShift(beneficiaryUuid, day, beneficiaryShift);
  ws.tryAssignShift(donorUuid, day, donorShift);
  syncRateioCountsFromWorkspace(ws, ctx);
  ws.clearCoverageGapsCache();
}

function trySameDayPreferenceSwap(
  ws: GenerationWorkspace,
  ctx: ScheduleRateioContext,
  beneficiaryUuid: string,
  donorUuid: string,
  day: string,
  currentShift: ShiftCode,
  desiredShift: ShiftCode,
): string | null {
  const gapsBefore = ws.listCoverageGaps().length;

  const beneficiaryBlock = canRemoveShiftForSwap(ws, beneficiaryUuid, day, currentShift);
  if (beneficiaryBlock) return beneficiaryBlock;

  const donorBlock = canRemoveShiftForSwap(ws, donorUuid, day, desiredShift);
  if (donorBlock) return donorBlock;

  if (
    !ws.unassignShift(beneficiaryUuid, day, {
      bypassT8Protection: currentShift === "T8",
    })
  ) {
    return "falha ao remover turno do beneficiário";
  }

  if (
    !ws.unassignShift(donorUuid, day, {
      bypassT8Protection: desiredShift === "T8",
    })
  ) {
    ws.tryAssignShift(beneficiaryUuid, day, currentShift);
    return "falha ao remover turno do doador";
  }

  syncRateioCountsFromWorkspace(ws, ctx);

  if (!ws.tryAssignShift(beneficiaryUuid, day, desiredShift)) {
    rollbackSwap(ws, ctx, beneficiaryUuid, donorUuid, day, currentShift, desiredShift);
    return "falha ao alocar preferido no beneficiário";
  }

  if (!ws.tryAssignShift(donorUuid, day, currentShift)) {
    ws.unassignShift(beneficiaryUuid, day, { bypassT8Protection: desiredShift === "T8" });
    rollbackSwap(ws, ctx, beneficiaryUuid, donorUuid, day, currentShift, desiredShift);
    return "falha ao realocar turno no doador";
  }

  syncRateioCountsFromWorkspace(ws, ctx);
  ws.clearCoverageGapsCache();

  if (ws.listCoverageGaps().length > gapsBefore) {
    rollbackSwap(ws, ctx, beneficiaryUuid, donorUuid, day, currentShift, desiredShift);
    return "swap reverteria — gap de cobertura";
  }

  return null;
}

function recordSwapLog(
  ws: GenerationWorkspace,
  entry: V5RepairPreferenceSwapLog,
  warnings: ValidationIssue[],
): void {
  ws.v5RepairPreferenceSwapLog.push(entry);
  if (entry.result === "OK") {
    warnings.push({
      severity: "BAIXA",
      level: "WARNING",
      type: "V5_REPAIR_PREFERENCE_SWAP_OK",
      date: entry.date,
      employee: entry.harmedName,
      detail:
        `${entry.harmedName}: ${entry.currentShift}→${entry.desiredShift} com ${entry.swappedWith}`,
    });
  }
}

export interface V5RepairPreferenceSwapResult {
  swapsApplied: number;
  gapsAfter: number;
}

/**
 * Pós-repair — troca same-day para recuperar preferência sem abrir gap.
 * Ex.: Lucas T7 + doador T6 → Lucas T6 + doador T7.
 */
export interface V5RepairPreferenceSwapOptions {
  /** Quando false, não executa se houver gaps no mês (padrão produção). */
  allowWithGaps?: boolean;
}

export function runV5RepairPreferenceSwap(
  ws: GenerationWorkspace,
  warnings: ValidationIssue[] = [],
  options?: V5RepairPreferenceSwapOptions,
): V5RepairPreferenceSwapResult {
  ws.ensureRateioContext();
  const ctx = ws.rateioContext!;
  const gapsStart = ws.listCoverageGaps().length;
  if (!options?.allowWithGaps && gapsStart > 0) {
    return { swapsApplied: 0, gapsAfter: gapsStart };
  }

  let swapsApplied = 0;
  const maxPasses = ws.days.length * ws.paoEmps.length;

  for (let pass = 0; pass < maxPasses; pass++) {
    let progress = false;
    const harmed = listPreferenceHarmCandidates(ws, ctx);

    for (const cand of harmed) {
      const assignments = ws
        .toAssignments()
        .filter(
          (a) =>
            a.employeeUuid === cand.uuid &&
            isRateioTurnShiftCode(a.shiftCode) &&
            a.shiftCode.toUpperCase() !== cand.preferred,
        )
        .sort((a, b) => a.date.localeCompare(b.date));

      for (const a of assignments) {
        const current = a.shiftCode.toUpperCase() as ShiftCode;
        const desired = cand.preferred;

        const donors = listDonorsForDaySwap(ws, ctx, a.date, desired, cand.uuid);
        let lastFail: string | null = null;
        let swapped = false;

        for (const donorUuid of donors) {
          const fail = trySameDayPreferenceSwap(
            ws,
            ctx,
            cand.uuid,
            donorUuid,
            a.date,
            current,
            desired,
          );
          if (fail == null) {
            recordSwapLog(
              ws,
              {
                date: a.date,
                harmedName: cand.name,
                currentShift: current,
                desiredShift: desired,
                swappedWith: employeeName(ws, donorUuid),
                result: "OK",
                reason: "troca same-day aplicada",
              },
              warnings,
            );
            swapsApplied++;
            progress = true;
            swapped = true;
            break;
          }
          lastFail = fail;
        }

        if (!swapped && donors.length > 0 && lastFail) {
          recordSwapLog(ws, {
            date: a.date,
            harmedName: cand.name,
            currentShift: current,
            desiredShift: desired,
            swappedWith: employeeName(ws, donors[0]!),
            result: "FAILED",
            reason: lastFail,
          }, warnings);
        }

        if (swapped) break;
      }
      if (progress) break;
    }

    if (!progress) break;
  }

  ws.clearCoverageGapsCache();
  return { swapsApplied, gapsAfter: ws.listCoverageGaps().length };
}

export function formatV5RepairPreferenceSwapAudit(ws: GenerationWorkspace): string {
  const lines: string[] = [
    "===== REPAIR SWAP DE PREFERÊNCIA =====",
    "",
  ];

  if (ws.v5RepairPreferenceSwapLog.length === 0) {
    lines.push("(nenhuma tentativa de swap de preferência registrada)");
    return lines.join("\n");
  }

  lines.push(
    "data | funcionário prejudicado | turno atual | turno desejado | funcionário trocado | resultado | motivo",
  );
  for (const row of ws.v5RepairPreferenceSwapLog) {
    lines.push(
      `${row.date} | ${row.harmedName} | ${row.currentShift} | ${row.desiredShift} | ` +
        `${row.swappedWith} | ${row.result} | ${row.reason}`,
    );
  }
  return lines.join("\n");
}

/** ND/T8 adjacente — não trocar dia que quebra par T8/T8. */
export function isSwapDayStructurallyBlocked(
  ws: GenerationWorkspace,
  uuid: string,
  day: string,
): boolean {
  if (ws.isT8BlockProtected(uuid, day)) return true;
  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  if (shiftOnDay(ws, uuid, prev) === "T8" && shiftOnDay(ws, uuid, day) === "T8") return true;
  if (shiftOnDay(ws, uuid, day) === "T8" && shiftOnDay(ws, uuid, next) === "T8") return true;
  return false;
}
