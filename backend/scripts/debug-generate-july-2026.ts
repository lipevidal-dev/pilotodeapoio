/**
 * Auditoria julho/2026 com dados locais (Prisma).
 * Uso: npm run build && npx tsx scripts/debug-generate-july-2026.ts
 */
import { RealScheduleEngine } from "../src/domain/schedule/real-schedule-engine.js";
import { CalendarRepository } from "../src/infrastructure/repositories/calendar.repository.js";
import { PreAllocationRepository } from "../src/infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../src/infrastructure/repositories/schedule.repository.js";
import {
  buildGenerationInput,
  preAllocationsToLocked,
} from "../src/infrastructure/mappers/generation-input.mapper.js";
import { GenerationWorkspace } from "../src/domain/schedule/generation-workspace.js";
import {
  buildTurnRateioAudit,
  formatCoverageTable,
  formatProportionalMetaTable,
  formatTurnRateioAuditTable,
} from "../src/domain/schedule/turn-rateio-audit.js";
import {
  buildPaoBelowTargetDiagnostics,
  formatPaoBelowTargetDiagnostics,
} from "../src/domain/schedule/pao-below-target-diagnostics.js";
import { buildIsolatedT8UnresolvedReport } from "../src/domain/schedule/optimize-emergency-isolated-t8.js";
import { findWorkBlocks } from "../src/domain/schedule/block-optimizer.js";
import { auditStructuralT8 } from "../src/domain/schedule/real-schedule-t8.js";
import { countT8BlocksForEmployee } from "../src/domain/schedule/t8-block-limits.js";
import { assignmentKey } from "../src/domain/schedule/types.js";
import {
  auditV4Transfers,
} from "../src/domain/schedule/enforce-minimum-turn-targets.js";
import { formatV4TransferAudit } from "../src/domain/schedule/v4-transfer-audit.js";
import { formatV3BlockMaterializeAudit, formatV3BlockMaterializeDiscardTrace } from "../src/domain/schedule/v3-block-materialize-audit.js";
import {
  auditV3PipelineTurnBalance,
  formatV3PipelineTurnBalanceTable,
  prepareWorkspaceForV3PipelineAudit,
} from "../src/domain/schedule/v3-pipeline-turn-balance.js";
import {
  formatRateioMinimumValidation,
  validateRateioMinimums,
} from "../src/domain/schedule/enforce-minimum-turn-targets.js";
import {
  formatPostV4EnforceTurnTrace,
  runPostV4EnforceTurnTrace,
} from "../src/domain/schedule/v4-post-enforce-turn-trace.js";
import type { RealMotorReport } from "../src/domain/schedule/real-schedule-types.js";
import { addDays } from "../src/domain/rules/dates.js";

const YEAR = 2026;
const MONTH = 7;

async function main() {
  const scheduleRepo = new ScheduleRepository();
  const calendarRepo = new CalendarRepository();
  const preAllocRepo = new PreAllocationRepository();
  const engine = new RealScheduleEngine();

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
  const lockedFromDb = preAllocationsToLocked(preAllocRows);

  const input = buildGenerationInput({
    year: YEAR,
    month: MONTH,
    employees,
    shifts,
    roles,
    lockedAllocations: lockedFromDb,
    vacationDays,
    vacationReturnDays,
    crossMonthHistory,
    shiftRestrictionRows,
    preferredShiftRows,
    noFlightDates,
    approvedDayOff,
    flightDays,
  });

  const ws = new GenerationWorkspace(input);
  ws.applyHardBlocks();
  const lockedBefore = new Set(
    lockedFromDb.map((l) => `${l.employeeUuid}|${l.date}|${l.label.toUpperCase()}`),
  );

  const result = engine.generate(input);
  const auditWs = new GenerationWorkspace(input);
  auditWs.applyHardBlocks();
  for (const a of result.assignments) {
    const did = auditWs.uuidToDomain.get(a.employeeUuid);
    if (did == null) continue;
    auditWs.planned.set(assignmentKey(did, a.date), a.shiftCode);
  }
  for (const al of result.allocations) {
    auditWs.lockDay(al.employeeUuid, al.date, al.label, false);
  }
  auditWs.initRateioContext();
  for (const a of result.assignments) {
    if (a.shiftCode !== "T8") continue;
    const prev = addDays(a.date, -1);
    const next = addDays(a.date, 1);
    const prevT8 = result.assignments.some(
      (x) => x.employeeUuid === a.employeeUuid && x.date === prev && x.shiftCode === "T8",
    );
    const nextT8 = result.assignments.some(
      (x) => x.employeeUuid === a.employeeUuid && x.date === next && x.shiftCode === "T8",
    );
    if (!prevT8 && !nextT8) {
      auditWs.markEmergencyIsolatedT8(a.employeeUuid, a.date);
    }
  }

  console.log("===== AUDITORIA JULHO/2026 MOTOR V4 =====\n");
  const rateioAudits = buildTurnRateioAudit(auditWs, auditWs.rateioContext!);
  console.log(formatProportionalMetaTable(rateioAudits));
  console.log("\nFuncionários PAO:");
  console.log(formatTurnRateioAuditTable(rateioAudits));

  console.log("\n" + formatPaoBelowTargetDiagnostics(buildPaoBelowTargetDiagnostics(auditWs)));

  auditWs.syncRateioContext();
  console.log("\n" + formatRateioMinimumValidation(validateRateioMinimums(auditWs)));

  console.log("\n" + formatV4TransferAudit(auditV4Transfers(auditWs)));

  console.log("\n" + formatPostV4EnforceTurnTrace(runPostV4EnforceTurnTrace(input)));

  const motorReport = result.realMotorReport as RealMotorReport | undefined;
  const v3Audit = motorReport?.v3BlockMaterializeAudit;
  if (v3Audit) {
    console.log("\n" + formatV3BlockMaterializeAudit(v3Audit));
    console.log("\n" + formatV3BlockMaterializeDiscardTrace(v3Audit, ["Lucas"]));
    const focus = ["Antonio", "Gustavo", "Lucas", "Davi", "Palombino"];
    const focused = v3Audit.employees.filter((e) =>
      focus.some((n) => e.employeeName.toLowerCase().includes(n.toLowerCase())),
    );
    if (focused.length > 0) {
      console.log("\n--- Foco Antonio/Gustavo/Lucas ---");
      for (const e of focused) {
        console.log(
          `${e.employeeName}: planejados=${e.plannedBlocks} materializados=${e.materializedBlocks} descartados=${e.discardedBlocks} | turnos plan=${e.plannedShifts} mat=${e.materializedShifts} desc=${e.discardedShifts}`,
        );
      }
    }
  } else {
    console.log("\n(v3BlockMaterializeAudit ausente no motorReport)");
  }

  const balanceWs = prepareWorkspaceForV3PipelineAudit(input);
  const turnBalance = auditV3PipelineTurnBalance(balanceWs);
  console.log(
    "\n" +
      formatV3PipelineTurnBalanceTable(turnBalance, [
        "Antonio",
        "Gustavo",
        "Helio",
        "Lucas",
        "Davi",
        "Palombino",
      ]),
  );
  console.log("\n" + formatV3BlockMaterializeDiscardTrace(turnBalance.v3BlockMaterializeAudit, ["Lucas"]));

  console.log("\nCobertura:");
  console.log(formatCoverageTable(auditWs));

  const t8Audit = auditStructuralT8(auditWs);
  console.log("\nT8:");
  console.log("Nome | Blocos T8,T8,ND | T8 total | Quebras");
  for (const c of auditWs.paoEmps) {
    const t8Total = auditWs.rateioContext!.currentT8Counts.get(c.uuid) ?? 0;
    const blocks = countT8BlocksForEmployee(auditWs, c.uuid);
    const breaks = t8Total > 0 && blocks === 0 ? "isolado?" : "ok";
    console.log(`${c.employee.name} | ${blocks} | ${t8Total} | ${breaks}`);
  }
  console.log(
    `T8 isolados=${t8Audit.isolatedT8Count}; emergenciais=${auditWs.listEmergencyIsolatedT8Days().length}; pares sem ND=${t8Audit.pairsWithoutNdCount}`,
  );

  console.log("\n" + buildIsolatedT8UnresolvedReport(auditWs));

  let preserved = 0;
  let overwritten = 0;
  for (const al of result.allocations) {
    const key = `${al.employeeUuid}|${al.date}|${al.label.toUpperCase()}`;
    if (lockedBefore.has(key)) preserved++;
  }
  for (const lock of lockedFromDb) {
    const found = result.allocations.some(
      (a) =>
        a.employeeUuid === lock.employeeUuid &&
        a.date === lock.date &&
        a.label.toUpperCase() === lock.label.toUpperCase(),
    );
    if (!found) overwritten++;
  }
  console.log("\nPré-alocações:");
  console.log(`Total preservadas (aprox): ${preserved}`);
  console.log(`Total sobrescritas/ausentes: ${overwritten}`);

  console.log("\nBlocos:");
  console.log("Nome | blocos | isolados | blocos de 2 | score");
  for (const c of auditWs.paoEmps) {
    const blocks = findWorkBlocks(auditWs, c.uuid);
    const isolated = blocks.filter((b) => b.size === 1).length;
    const pairs = blocks.filter((b) => b.size === 2).length;
    const score = blocks.reduce((s, b) => s + (b.size === 1 ? 100 : b.size === 2 ? 50 : 0), 0);
    console.log(`${c.employee.name} | ${blocks.length} | ${isolated} | ${pairs} | ${score}`);
  }

  if (auditWs.rateioContext!.overflowEvents.length > 0) {
    console.log("\nOverflow emergencial:");
    for (const ev of auditWs.rateioContext!.overflowEvents) {
      console.log(ev);
    }
  }

  console.log("\nResumo motor:");
  console.log({
    gaps: auditWs.listCoverageGaps().length,
    critical: result.summary.criticalCount,
    assignments: result.assignments.length,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
