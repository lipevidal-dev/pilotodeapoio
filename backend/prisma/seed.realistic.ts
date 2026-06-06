/**
 * Seed equipe realista (6 PAO + 3 APAO) para desenvolvimento e prova do motor.
 * Execução: npm run db:seed:realistic
 */
import { PrismaClient, EmployeeType, EmployeeTypeAllowed, UserRole } from "@prisma/client";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

const SHIFTS = [
  { code: "T6", name: "Turno 6 PAO", startTime: "06:00", endTime: "14:00", durationHours: 8, employeeTypeAllowed: EmployeeTypeAllowed.PAO, displayOrder: 1, mandatoryCoverage: true, requiresT8PairNd: false },
  { code: "T7", name: "Turno 7 PAO", startTime: "14:00", endTime: "22:00", durationHours: 8, employeeTypeAllowed: EmployeeTypeAllowed.PAO, displayOrder: 2, mandatoryCoverage: true, requiresT8PairNd: false },
  { code: "T8", name: "Turno 8 PAO", startTime: "22:00", endTime: "06:00", durationHours: 8, employeeTypeAllowed: EmployeeTypeAllowed.PAO, displayOrder: 3, mandatoryCoverage: true, requiresT8PairNd: true },
  { code: "T1", name: "Turno 1 APAO", startTime: "00:00", endTime: "06:00", durationHours: 6, employeeTypeAllowed: EmployeeTypeAllowed.APAO, displayOrder: 4, mandatoryCoverage: false, requiresT8PairNd: false },
  { code: "T2", name: "Turno 2 APAO", startTime: "06:00", endTime: "12:00", durationHours: 6, employeeTypeAllowed: EmployeeTypeAllowed.APAO, displayOrder: 5, mandatoryCoverage: false, requiresT8PairNd: false },
  { code: "T3", name: "Turno 3 APAO", startTime: "12:00", endTime: "18:00", durationHours: 6, employeeTypeAllowed: EmployeeTypeAllowed.APAO, displayOrder: 6, mandatoryCoverage: false, requiresT8PairNd: false },
  { code: "T4", name: "Turno 4 APAO", startTime: "18:00", endTime: "00:00", durationHours: 6, employeeTypeAllowed: EmployeeTypeAllowed.APAO, displayOrder: 7, mandatoryCoverage: false, requiresT8PairNd: false },
];

const REALISTIC_EMPLOYEES: Array<{ name: string; type: EmployeeType }> = [
  { name: "PAO Alpha", type: EmployeeType.PAO },
  { name: "PAO Bravo", type: EmployeeType.PAO },
  { name: "PAO Charlie", type: EmployeeType.PAO },
  { name: "PAO Delta", type: EmployeeType.PAO },
  { name: "PAO Echo", type: EmployeeType.PAO },
  { name: "PAO Foxtrot", type: EmployeeType.PAO },
  { name: "APAO 1", type: EmployeeType.APAO },
  { name: "APAO 2", type: EmployeeType.APAO },
  { name: "APAO 3", type: EmployeeType.APAO },
];

const DEFAULT_ROLES = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Piloto de Apoio Operacional",
    code: "PAO",
    description: "Cobertura operacional PAO (T6/T7/T8)",
    displayOrder: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Auxiliar de Piloto de Apoio Operacional",
    code: "APAO",
    description: "Apoio APAO (T1–T4) com PAO na janela",
    displayOrder: 2,
  },
] as const;

async function main() {
  for (const r of DEFAULT_ROLES) {
    await prisma.role.upsert({
      where: { code: r.code },
      create: { ...r, active: true },
      update: {
        name: r.name,
        description: r.description,
        displayOrder: r.displayOrder,
        active: true,
      },
    });
  }

  const roleByCode = Object.fromEntries(
    (await prisma.role.findMany({ where: { code: { in: ["PAO", "APAO"] } } })).map((r) => [r.code, r.id]),
  );

  for (const s of SHIFTS) {
    await prisma.shift.upsert({
      where: { code: s.code },
      create: { ...s, active: true },
      update: {
        name: s.name,
        startTime: s.startTime,
        endTime: s.endTime,
        durationHours: s.durationHours,
        employeeTypeAllowed: s.employeeTypeAllowed,
        active: true,
        displayOrder: s.displayOrder,
        mandatoryCoverage: s.mandatoryCoverage,
        requiresT8PairNd: s.requiresT8PairNd,
      },
    });
  }

  const employeeCount = await prisma.employee.count();
  if (employeeCount === 0) {
    let seniorityByType: Record<string, number> = { PAO: 0, APAO: 0 };
    for (const e of REALISTIC_EMPLOYEES) {
      const roleId = roleByCode[e.type];
      seniorityByType[e.type] = (seniorityByType[e.type] ?? 0) + 1;
      await prisma.employee.create({
        data: {
          name: e.name,
          type: e.type,
          roleId,
          active: true,
          seniorityNumber: seniorityByType[e.type],
        },
      });
    }
    console.log("Seed realista: equipe criada (banco vazio).");
  } else {
    console.log(
      `Seed realista: ${employeeCount} funcionário(s) existentes — use exclusão manual; seed não recria nomes.`,
    );
  }

  await prisma.user.upsert({
    where: { email: "admin@escala.local" },
    create: {
      name: "Administrador",
      email: "admin@escala.local",
      passwordHash: hashPassword("changeme"),
      role: UserRole.ADMIN,
    },
    update: {},
  });

  await prisma.scheduleMonth.upsert({
    where: { year_month: { year: 2026, month: 6 } },
    create: { year: 2026, month: 6, status: "DRAFT" },
    update: {},
  });

  console.log("Seed realista: 6 PAO + 3 APAO, turnos T1–T8, mês 2026-06 preparado.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
