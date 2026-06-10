import type { Employee, PreAllocation } from "@prisma/client";

type PreAllocationRowInput = Partial<PreAllocation> &
  Pick<PreAllocation, "id" | "employeeId" | "date" | "label">;

/** Mock de linha PreAllocation (Prisma) — cadastros sem horário usam null. */
export function mockPreAllocationRow(
  row: PreAllocationRowInput,
  employee: Employee,
): PreAllocation & { employee: Employee } {
  const now = new Date();
  return {
    scheduleMonthId: "m1",
    notes: null,
    startTime: null,
    endTime: null,
    createdAt: now,
    updatedAt: now,
    ...row,
    employee,
  };
}

/** Mock de simulador com janela horária (descanso 12h). */
export function mockSimulatorPreAllocationRow(
  row: PreAllocationRowInput,
  employee: Employee,
  times: { startTime?: string; endTime?: string } = {},
): PreAllocation & { employee: Employee } {
  return mockPreAllocationRow(
    {
      ...row,
      label: row.label ?? "SIMULADOR",
      startTime: times.startTime ?? "14:00",
      endTime: times.endTime ?? "18:00",
    },
    employee,
  );
}

/** Campos mínimos para buildOperationalCadastroDisplay. */
export function mockCadastroPreAllocationRow(
  row: {
    id: string;
    employeeId: string;
    date: Date;
    label: string;
    startTime?: string | null;
    endTime?: string | null;
  },
) {
  return {
    startTime: null,
    endTime: null,
    ...row,
  };
}
