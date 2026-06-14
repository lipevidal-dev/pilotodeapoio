import { DEFAULT_SHIFTS } from "../../domain/shift/default-shifts.js";
import { REALISTIC_APAOS, REALISTIC_PAOS } from "../realistic-fixtures.js";

export function mockPrismaShifts() {
  return DEFAULT_SHIFTS.map((s, i) => ({
    id: `shift-${i}`,
    code: s.code,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    durationHours: 8,
    employeeTypeAllowed: s.role,
    active: true,
    displayOrder: i + 1,
    mandatoryCoverage: ["T6", "T7", "T8"].includes(s.code),
    requiresT8PairNd: s.code === "T8",
    coverageType: s.coverageType,
    noWeekends: s.noWeekends ?? false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

export function mockPrismaEmployeesFromRealistic() {
  return [...REALISTIC_PAOS, ...REALISTIC_APAOS].map((e) => ({
    id: `real-${e.id}`,
    name: e.name,
    type: e.role,
    seniorityNumber: e.seniority,
    active: true,
    birthDate: null,
    role: {
      id: "role-1",
      code: e.role,
      name: e.role,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  }));
}

export function mockPrismaRoles() {
  return [
    { id: "role-1", code: "PAO", name: "PAO", active: true, createdAt: new Date(), updatedAt: new Date() },
    { id: "role-2", code: "APAO", name: "APAO", active: true, createdAt: new Date(), updatedAt: new Date() },
  ];
}
