import { isoDateKey, toDbDate } from "../../domain/rules/date-keys.js";
import {
  manualTypeToPreallocLabel,
} from "../../domain/schedule/manual-edit-types.js";
import type { ManualAllocationType } from "../../domain/schedule/manual-edit-types.js";
import { prisma } from "../database/prisma-client.js";

export class ManualScheduleEditRepository {
  async findMonthById(id: string) {
    return prisma.scheduleMonth.findUnique({
      where: { id },
      include: {
        assignments: { include: { employee: { include: { role: true } } }, orderBy: { date: "asc" } },
        preAllocations: { include: { employee: { include: { role: true } } }, orderBy: { date: "asc" } },
      },
    });
  }

  async upsertShiftAssignment(
    scheduleMonthId: string,
    employeeId: string,
    date: string,
    shiftCode: string,
  ) {
    await this.clearDayAllocations(scheduleMonthId, employeeId, date, { keepProtected: false });
    return prisma.scheduleAssignment.upsert({
      where: {
        scheduleMonthId_employeeId_date: {
          scheduleMonthId,
          employeeId,
          date: toDbDate(date),
        },
      },
      create: {
        scheduleMonthId,
        employeeId,
        date: toDbDate(date),
        shiftCode,
        source: "MANUAL",
      },
      update: {
        shiftCode,
        label: null,
        source: "MANUAL",
      },
      include: { employee: true },
    });
  }

  async upsertPreAllocation(
    scheduleMonthId: string,
    employeeId: string,
    date: string,
    label: string,
    notes?: string | null,
  ) {
    await prisma.scheduleAssignment.deleteMany({
      where: { scheduleMonthId, employeeId, date: toDbDate(date) },
    });
    await prisma.flightAssignment.deleteMany({
      where: { employeeId, date: toDbDate(date) },
    });
    return prisma.preAllocation.upsert({
      where: {
        scheduleMonthId_employeeId_date: {
          scheduleMonthId,
          employeeId,
          date: toDbDate(date),
        },
      },
      create: {
        scheduleMonthId,
        employeeId,
        date: toDbDate(date),
        label,
        notes: notes ?? null,
      },
      update: { label, notes: notes ?? null },
      include: { employee: true },
    });
  }

  async upsertFlight(employeeId: string, date: string) {
    await prisma.scheduleAssignment.deleteMany({
      where: {
        employeeId,
        date: toDbDate(date),
      },
    });
    return prisma.flightAssignment.upsert({
      where: {
        employeeId_date: { employeeId, date: toDbDate(date) },
      },
      create: {
        employeeId,
        date: toDbDate(date),
        source: "MANUAL",
      },
      update: { source: "MANUAL" },
      include: { employee: true },
    });
  }

  async clearDay(
    scheduleMonthId: string,
    employeeId: string,
    date: string,
    opts?: { force?: boolean },
  ) {
    await prisma.scheduleAssignment.deleteMany({
      where: { scheduleMonthId, employeeId, date: toDbDate(date) },
    });
    await prisma.preAllocation.deleteMany({
      where: { scheduleMonthId, employeeId, date: toDbDate(date) },
    });
    await prisma.flightAssignment.deleteMany({
      where: { employeeId, date: toDbDate(date) },
    });
    void opts;
  }

  private async clearDayAllocations(
    scheduleMonthId: string,
    employeeId: string,
    date: string,
    _opts: { keepProtected: boolean },
  ) {
    await prisma.preAllocation.deleteMany({
      where: { scheduleMonthId, employeeId, date: toDbDate(date) },
    });
    await prisma.flightAssignment.deleteMany({
      where: { employeeId, date: toDbDate(date) },
    });
  }

  async applyAllocationType(
    scheduleMonthId: string,
    employeeId: string,
    date: string,
    type: ManualAllocationType,
  ) {
    if (type === "CLEAR") {
      await this.clearDay(scheduleMonthId, employeeId, date);
      return null;
    }
    if (type === "VOO") {
      await this.clearDayAllocations(scheduleMonthId, employeeId, date, { keepProtected: false });
      return this.upsertFlight(employeeId, date);
    }
    const preLabel = manualTypeToPreallocLabel(type);
    if (preLabel) {
      return this.upsertPreAllocation(
        scheduleMonthId,
        employeeId,
        date,
        preLabel,
        "escala-manual",
      );
    }
    return this.upsertShiftAssignment(scheduleMonthId, employeeId, date, type);
  }

  formatAssignmentDate(d: Date): string {
    return isoDateKey(d);
  }
}
