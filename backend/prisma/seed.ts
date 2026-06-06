import { PrismaClient, EmployeeType, EmployeeTypeAllowed, UserRole } from "@prisma/client";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

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

  const shifts = [
    { code: "T6", name: "Turno 6 PAO", startTime: "06:00", endTime: "14:00", durationHours: 8, employeeTypeAllowed: EmployeeTypeAllowed.PAO, displayOrder: 1, mandatoryCoverage: true, requiresT8PairNd: false },
    { code: "T7", name: "Turno 7 PAO", startTime: "14:00", endTime: "22:00", durationHours: 8, employeeTypeAllowed: EmployeeTypeAllowed.PAO, displayOrder: 2, mandatoryCoverage: true, requiresT8PairNd: false },
    { code: "T8", name: "Turno 8 PAO", startTime: "22:00", endTime: "06:00", durationHours: 8, employeeTypeAllowed: EmployeeTypeAllowed.PAO, displayOrder: 3, mandatoryCoverage: true, requiresT8PairNd: true },
    { code: "T1", name: "Turno 1 APAO", startTime: "00:00", endTime: "06:00", durationHours: 6, employeeTypeAllowed: EmployeeTypeAllowed.APAO, displayOrder: 4, mandatoryCoverage: false, requiresT8PairNd: false },
    { code: "T2", name: "Turno 2 APAO", startTime: "06:00", endTime: "12:00", durationHours: 6, employeeTypeAllowed: EmployeeTypeAllowed.APAO, displayOrder: 5, mandatoryCoverage: false, requiresT8PairNd: false },
    { code: "T3", name: "Turno 3 APAO", startTime: "12:00", endTime: "18:00", durationHours: 6, employeeTypeAllowed: EmployeeTypeAllowed.APAO, displayOrder: 6, mandatoryCoverage: false, requiresT8PairNd: false },
    { code: "T4", name: "Turno 4 APAO", startTime: "18:00", endTime: "00:00", durationHours: 6, employeeTypeAllowed: EmployeeTypeAllowed.APAO, displayOrder: 7, mandatoryCoverage: false, requiresT8PairNd: false },
  ];

  for (const s of shifts) {
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

  const employees = [
    { name: "PAO Exemplo 1", type: EmployeeType.PAO },
    { name: "PAO Exemplo 2", type: EmployeeType.PAO },
    { name: "APAO Exemplo 1", type: EmployeeType.APAO },
    { name: "APAO Exemplo 2", type: EmployeeType.APAO },
  ];

  for (const e of employees) {
    const roleId = roleByCode[e.type];
    const existing = await prisma.employee.findFirst({ where: { name: e.name } });
    if (!existing) {
      await prisma.employee.create({ data: { ...e, roleId } });
    } else if (!existing.roleId && roleId) {
      await prisma.employee.update({ where: { id: existing.id }, data: { roleId } });
    }
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

  const now = new Date();
  await prisma.scheduleMonth.upsert({
    where: { year_month: { year: now.getFullYear(), month: now.getMonth() + 1 } },
    create: { year: now.getFullYear(), month: now.getMonth() + 1 },
    update: {},
  });

  console.log("Seed concluído: turnos, funcionários, usuário admin, mês corrente.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
