import { prisma } from "../../src/infrastructure/database/prisma-client.js";
import { isoDateKey } from "../../src/domain/rules/date-keys.js";
import { isInvalidPreAllocationLabel } from "../../src/domain/schedule/valid-preallocation-labels.js";

const apply = process.argv.includes("--apply");

interface CleanupAction {
  kind: "pre_allocation" | "schedule_assignment";
  id: string;
  employeeId: string;
  date: string;
  label: string;
  reason: string;
}

async function main() {
  const actions: CleanupAction[] = [];

  const invalidPreAllocs = await prisma.preAllocation.findMany({
    include: { employee: true, scheduleMonth: true },
  });

  for (const row of invalidPreAllocs) {
    if (!isInvalidPreAllocationLabel(row.label)) continue;
    actions.push({
      kind: "pre_allocation",
      id: row.id,
      employeeId: row.employeeId,
      date: isoDateKey(row.date),
      label: row.label,
      reason: "Label inválido em preAllocations",
    });
  }

  const vooAssignments = await prisma.scheduleAssignment.findMany({
    where: {
      OR: [{ label: "VOO" }, { label: { contains: "VOO", mode: "insensitive" } }],
    },
    include: { employee: true },
  });

  const flights = await prisma.flightAssignment.findMany();
  const flightKeys = new Set(
    flights.map((f) => `${f.employeeId}|${isoDateKey(f.date)}`),
  );

  for (const row of vooAssignments) {
    const key = `${row.employeeId}|${isoDateKey(row.date)}`;
    if (flightKeys.has(key)) continue;
    actions.push({
      kind: "schedule_assignment",
      id: row.id,
      employeeId: row.employeeId,
      date: isoDateKey(row.date),
      label: row.label ?? "VOO",
      reason: "Assignment VOO órfão sem flightAssignment",
    });
  }

  console.info(`Modo: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.info(`Registros legados encontrados: ${actions.length}`);

  const byKind = actions.reduce(
    (acc, a) => {
      acc[a.kind] = (acc[a.kind] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  console.info("Por tipo:", byKind);

  for (const action of actions) {
    console.info(
      `[${action.kind}] ${action.date} | ${action.employeeId} | ${action.label} | ${action.reason} | id=${action.id}`,
    );
  }

  if (!apply) {
    console.info("Nenhuma alteração aplicada. Use --apply para executar a limpeza.");
    return;
  }

  const preIds = actions.filter((a) => a.kind === "pre_allocation").map((a) => a.id);
  const assignIds = actions.filter((a) => a.kind === "schedule_assignment").map((a) => a.id);

  if (preIds.length) {
    const deleted = await prisma.preAllocation.deleteMany({ where: { id: { in: preIds } } });
    console.info(`preAllocations removidos: ${deleted.count}`);
  }

  if (assignIds.length) {
    const deleted = await prisma.scheduleAssignment.deleteMany({
      where: { id: { in: assignIds } },
    });
    console.info(`scheduleAssignments removidos: ${deleted.count}`);
  }

  console.info("Limpeza concluída.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
