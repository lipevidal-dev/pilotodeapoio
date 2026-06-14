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
  formatTurnRateioAuditTable,
} from "../src/domain/schedule/turn-rateio-audit.js";
import { findWorkBlocks } from "../src/domain/schedule/block-optimizer.js";
import { auditStructuralT8 } from "../src/domain/schedule/real-schedule-t8.js";
import { countT8BlocksForEmployee } from "../src/domain/schedule/t8-block-limits.js";
import { assignmentKey } from "../src/domain/schedule/types.js";

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

  console.log("===== AUDITORIA JULHO/2026 MOTOR V3 =====\n");
  console.log("Funcionários PAO:");
  console.log(formatTurnRateioAuditTable(buildTurnRateioAudit(auditWs, auditWs.rateioContext!)));

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
    `T8 isolados=${t8Audit.isolatedT8Count}; pares sem ND=${t8Audit.pairsWithoutNdCount}`,
  );

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
