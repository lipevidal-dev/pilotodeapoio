import { ScheduleRepairEngine } from "../../src/domain/schedule/schedule-repair-engine.js";
import { GenerationWorkspace } from "../../src/domain/schedule/generation-workspace.js";
import { RealScheduleEngine } from "../../src/domain/schedule/real-schedule-engine.js";
import { validateGenerationBeforeSave } from "../../src/domain/schedule/schedule-generation-validators.js";
import { GenerateScheduleUseCase } from "../../src/application/use-cases/generate-schedule.use-case.js";
import { realisticGenerationInput } from "../../src/tests/realistic-fixtures.js";
import { minimalPaoInput, paoUuid } from "../../src/tests/schedule-slices/slice-helpers.js";
import { IDEAL_PAO_REST_COUNT } from "../../src/domain/rules/constants.js";
import {
  mockPrismaEmployeesFromRealistic,
  mockPrismaRoles,
  mockPrismaShifts,
} from "../../src/tests/helpers/generate-schedule-mocks.js";

async function debugCoverage() {
  const repairEngine = new ScheduleRepairEngine();
  const ws = new GenerationWorkspace(minimalPaoInput(4));
  ws.applyHardBlocks();
  const uuid = paoUuid(0);
  const day = "2026-06-21";

  ws.tryAssignShift(paoUuid(1), day, "T6", true);
  ws.tryAssignShift(paoUuid(2), day, "T8", true);
  ws.lockDay(paoUuid(3), day, "FOLGA SOCIAL");

  for (const d of ws.days) {
    if (d === day) continue;
    if (ws.isDayBlockedForShift(uuid, d)) continue;
    if (ws.tryAssignShift(uuid, d, d.endsWith("1") ? "T7" : "T6")) continue;
    ws.tryAssignShift(uuid, d, "T7", true);
  }

  const budgetProbe =
    ws.workCount(uuid) + 1 + ws.countNd(uuid) + IDEAL_PAO_REST_COUNT;
  console.log("=== COVERAGE ===");
  console.log("budgetProbe", budgetProbe, "days", ws.days.length);
  console.log("try T7 normal", ws.tryAssignShift(uuid, day, "T7"));
  console.log("detailed emergency (no mutate)", ws.tryAssignShiftDetailed(uuid, day, "T7", true));
  console.log("gaps count", ws.listCoverageGaps().length);
  console.log("T7 gaps", ws.listCoverageGaps().filter((g) => g.shiftCode === "T7").length);

  const result = repairEngine.repair(ws, []);
  console.log("repaired", result.repaired, "remaining", result.remainingGaps);
  console.log("T7 day21", ws.hasPaoCoverage(day, "T7"));
}

async function debugNdPersistence() {
  const uuid = "real-1";
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = String(i + 1).padStart(2, "0");
    return `2026-06-${d}`;
  });
  const input = realisticGenerationInput({
    noFlightDates: days.map((date) => ({ employeeUuid: uuid, date })),
  });
  input.shiftRestrictions = new Map([[1, new Set(["T8"])]]);

  const result = new RealScheduleEngine().generate(input);
  const v = validateGenerationBeforeSave(input, result);
  console.log("\n=== ND PERSISTENCE (engine only) ===");
  console.log("critical", v.criticalCount);
  for (const i of v.issues) {
    if (i.level === "CRITICAL" || (i as { severity?: string }).severity === "CRÍTICA") {
      console.log("CRIT", i.type, (i as { detail?: string }).detail?.slice(0, 200));
    }
  }

  const diag = (
    result.summary.realMotorReport as {
      employeeDiagnostics?: Array<{
        employeeUuid: string;
        failedAllocationReasons: string[];
        actualWorkdays: number;
        t8Count: number;
      }>;
    }
  )?.employeeDiagnostics?.find((d) => d.employeeUuid === uuid);
  console.log("diag actual", diag?.actualWorkdays, "t8", diag?.t8Count);
  console.log("reasons", diag?.failedAllocationReasons?.slice(0, 5));

  const employees = mockPrismaEmployeesFromRealistic();
  const useCase = new GenerateScheduleUseCase(
    {
      findMonth: async () => null,
      listActiveEmployees: async () => employees,
      listShifts: async () => mockPrismaShifts(),
      listRoles: async () => mockPrismaRoles(),
      loadCrossMonthHistory: async () => undefined,
      listShiftRestrictionsForMonth: async () => [{ employeeUuid: uuid, shiftCode: "T8" }],
      listPreferredShiftsForMonth: async () => [],
      listNoFlightDatesForMonth: async () => days.map((date) => ({ employeeUuid: uuid, date })),
      upsertGeneratedMonth: async () => ({ id: "month-2" }),
      clearForRegeneration: async () => {},
      saveAssignments: async () => {},
      saveGeneratedPreAllocations: async () => {},
      saveViolations: async () => {},
    } as never,
    {
      listVacationDaysForMonth: async () => [],
      listVacationReturnDaysForMonth: async () => [],
      listApprovedDayOffForMonth: async () => [],
      listFlightDaysForMonth: async () => [],
    } as never,
    { findAll: async () => [] } as never,
  );

  try {
    await useCase.execute(2026, 6);
    console.log("use case OK");
  } catch (e) {
    console.log("use case error", (e as Error).message);
  }
}

await debugCoverage();
await debugNdPersistence();
