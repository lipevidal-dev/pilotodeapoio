import type { Employee, Shift } from "@prisma/client";
import { employeeToApi } from "./employee-api.mapper.js";
import { shiftToApi } from "./shift-api.mapper.js";

type ScheduleEmployeeRow = Employee & { role?: { id: string; name: string; code: string } | null };

export function mapScheduleEmployees(rows: ScheduleEmployeeRow[]) {
  return rows.map((row) => employeeToApi(row as Parameters<typeof employeeToApi>[0]));
}
export function mapScheduleShifts(rows: Shift[]) {
  return rows.map((row) => shiftToApi(row));
}
