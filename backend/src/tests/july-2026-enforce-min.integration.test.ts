import { describe, expect, it } from "vitest";
import { realScheduleEngine } from "../domain/schedule/real-schedule-engine.js";
import { GenerationWorkspace } from "../domain/schedule/generation-workspace.js";
import {
  auditV4Transfers,
  enforceMinimumTurnTargets,
  validateRateioMinimums,
} from "../domain/schedule/enforce-minimum-turn-targets.js";
import { countRateioTurns } from "../domain/schedule/pao-rateio-shifts.js";
import {
  buildPreferenceQuartileSummary,
  buildPreferenceSeniorityAudit,
} from "../domain/schedule/preference-scoring.js";
import { validateGenerationBeforeSave } from "../domain/schedule/schedule-generation-validators.js";
import { buildGenerationInput, preAllocationsToLocked } from "../infrastructure/mappers/generation-input.mapper.js";
import { CalendarRepository } from "../infrastructure/repositories/calendar.repository.js";
import { PreAllocationRepository } from "../infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../infrastructure/repositories/schedule.repository.js";
import { assignmentKey } from "../domain/schedule/types.js";
import type { GenerationInput, GenerationResult } from "../domain/schedule/generation-types.js";
import type { RealMotorReport } from "../domain/schedule/real-schedule-types.js";

const YEAR = 2026;
const MONTH = 7;
const DB_URL = process.env.DATABASE_URL ?? "";

async function loadJuly2026Input() {
  const scheduleRepo = new ScheduleRepository();
  const calendarRepo = new CalendarRepository();
  const preAllocRepo = new PreAllocationRepository();

  const employees = await scheduleRepo.listActiveEmployees();
  const shifts = await scheduleRepo.listShifts(true);
  const roles = await scheduleRepo.listRoles(true);
  const vacationDays = await calendarRepo.listVacationDaysForMonth(YEAR, MONTH);
  const vacationReturnDays = await calendarRepo.listVacationReturnDaysForMonth(YEAR, MONTH);
  const crossMonthHistory = await scheduleRepo.loadCrossMonthHistory(YEAR, MONTH);
  const shiftRestrictionRows = await scheduleRepo.listShiftRestrictionsForMonth(YEAR, MONTH);
  const preferredShiftRows = await scheduleRepo.listPreferredShiftsForMonth(YEAR, MONTH);
  const noFlightDates = await scheduleRepo.listNoFlightDatesForMonth(YEAR, MONTH);
  const approvedDayOff = await calendarRepo.listApprovedDayOffForMonth(YEAR, MONTH);
  const flightDays = await calendarRepo.listFlightDaysForMonth(YEAR, MONTH);
  const existing = await scheduleRepo.findMonth(YEAR, MONTH);
  const preAllocRows =
    existing?.preAllocations ?? (await preAllocRepo.findAll({ year: YEAR, month: MONTH }));

  return buildGenerationInput({
    year: YEAR,
    month: MONTH,
    employees,
    shifts,
    roles,
    lockedAllocations: preAllocationsToLocked(preAllocRows),
    vacationDays,
    vacationReturnDays,
    crossMonthHistory,
    shiftRestrictionRows,
    preferredShiftRows,
    noFlightDates,
    approvedDayOff,
    flightDays,
  });
}

function buildWsFromResult(input: GenerationInput, result: GenerationResult) {
  const ws = new GenerationWorkspace(input);
  ws.applyHardBlocks();
  for (const a of result.assignments) {
    const did = ws.uuidToDomain.get(a.employeeUuid);
    if (did == null) continue;
    ws.planned.set(assignmentKey(did, a.date), a.shiftCode);
  }
  for (const al of result.allocations) {
    ws.allocations.push(al);
  }
  ws.initRateioContext();
  ws.syncRateioContext();
  return ws;
}

function findPao(ws: GenerationWorkspace, namePart: string) {
  return ws.paoEmps.find((e) => e.employee.name.toLowerCase().includes(namePart.toLowerCase()));
}

describe.skipIf(!DB_URL.includes("5434") && !DB_URL.includes("5432"))(
  "jul/2026 — enforce proporcional atinge min (dados reais)",
  () => {
    it("Gustavo e Lucas >= min; validateBeforeSave OK; dry-run não encontra transferência min pendente", async () => {
      const input = await loadJuly2026Input();
      const result = realScheduleEngine.generate(input);
      const ws = buildWsFromResult(input, result);

      const gustavo = findPao(ws, "Gustavo");
      const lucas = findPao(ws, "Lucas");
      expect(gustavo).toBeDefined();
      expect(lucas).toBeDefined();

      const gMin = ws.rateioContext!.minTurnCounts.get(gustavo!.uuid) ?? 0;
      const lMin = ws.rateioContext!.minTurnCounts.get(lucas!.uuid) ?? 0;

      expect(countRateioTurns(ws, gustavo!.uuid)).toBeGreaterThanOrEqual(gMin);
      expect(countRateioTurns(ws, lucas!.uuid)).toBeGreaterThanOrEqual(lMin);

      expect(result.summary.coverageGaps).toBe(0);

      const saveValidation = validateGenerationBeforeSave(input, result);
      expect(saveValidation.issues.filter((i) => i.type === "RATEIO_MIN_UNENFORCED")).toHaveLength(0);
      const criticalTypes = saveValidation.issues
        .filter((i) => i.level === "CRITICAL" || i.severity === "CRÍTICA")
        .map((i) => i.type);
      expect(criticalTypes, criticalTypes.join(", ")).toEqual([]);

      const minValidation = validateRateioMinimums(ws);
      expect(minValidation.ok).toBe(true);
      expect(minValidation.issues.filter((i) => i.hasValidTransfer)).toHaveLength(0);

      const dryRun = auditV4Transfers(ws);
      expect(dryRun.minimum.belowMinAfter).toBe(0);
      expect(
        dryRun.minimum.attempts.filter((a) => a.phase === "min" && a.outcome === "accepted").length,
      ).toBe(0);

      const prefAudit = buildPreferenceSeniorityAudit(ws, ws.rateioContext!);
      const prefWithShift = prefAudit.filter((r) => r.preferredShift);
      if (prefWithShift.length >= 3) {
        const quartiles = buildPreferenceQuartileSummary(prefAudit);
        expect(quartiles.superior).toBeGreaterThanOrEqual(quartiles.inferior);
      }

      const notes = (result.summary.realMotorReport as unknown as RealMotorReport).stepNotes.join("\n");
      expect(notes).toContain("PREFERÊNCIA X SENIORIDADE");
    }, 600_000);

    it("enforceMinimumTurnTargets aplica transferência pendente no grid final", async () => {
      const input = await loadJuly2026Input();
      const result = realScheduleEngine.generate(input);
      const ws = buildWsFromResult(input, result);

      const gustavo = findPao(ws, "Gustavo")!;
      const gMin = ws.rateioContext!.minTurnCounts.get(gustavo.uuid) ?? 0;
      const before = validateRateioMinimums(ws);

      if (before.issues.some((i) => i.hasValidTransfer)) {
        const report = enforceMinimumTurnTargets(ws);
        ws.syncRateioContext();
        expect(report.transfers).toBeGreaterThan(0);
        expect(countRateioTurns(ws, gustavo.uuid)).toBeGreaterThanOrEqual(gMin);
        expect(validateRateioMinimums(ws).issues.filter((i) => i.hasValidTransfer)).toHaveLength(0);
      }
    }, 600_000);
  },
);
