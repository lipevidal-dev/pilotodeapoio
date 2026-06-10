import type { EmployeeType } from "@prisma/client";
import {
  compareEmployeesBySeniority,
  insertIdAtPosition,
  normalizeSeniorityInput,
  reorderIdsInGroup,
} from "../../domain/employee/seniority.js";
import { dedupeIds, dedupeIsoDates } from "../../domain/employee/restrictions.js";
import { toDbDate } from "../../domain/rules/date-keys.js";
import {
  REGENERATION_CLEAR_LABELS,
  normalizeOperationalLabel,
} from "../../domain/schedule/operational-labels.js";
import { prisma } from "../database/prisma-client.js";

const employeeInclude = { role: true } as const;

const employeeDetailInclude = {
  role: true,
  flightRestrictions: { orderBy: { date: "asc" as const } },
  shiftRestrictions: {
    include: { shift: true },
    orderBy: { shift: { code: "asc" as const } },
  },
  preferredShifts: {
    include: { shift: true },
    orderBy: { shift: { code: "asc" as const } },
  },
} as const;

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export class EmployeeRepository {
  async findAll(activeOnly = false) {
    const rows = await prisma.employee.findMany({
      where: activeOnly ? { active: true } : undefined,
      include: employeeInclude,
    });
    return [...rows].sort(compareEmployeesBySeniority);
  }

  async findById(id: string) {
    return prisma.employee.findUnique({
      where: { id },
      include: employeeDetailInclude,
    });
  }

  async create(data: {
    name: string;
    type: EmployeeType;
    roleId?: string | null;
    birthDate?: string | null;
    active?: boolean;
    seniorityNumber?: number | null;
    noFlightDates?: string[];
    restrictedShiftIds?: string[];
    preferredShiftIds?: string[];
  }) {
    const { birthDate, seniorityNumber, type, noFlightDates, restrictedShiftIds, preferredShiftIds, ...rest } = data;

    return prisma.$transaction(async (tx) => {
      const assigned = await this.assignSeniorityOnCreate(tx, type, seniorityNumber, async (position) =>
        tx.employee.create({
          data: {
            ...rest,
            type,
            seniorityNumber: position,
            birthDate: birthDate ? toDbDate(birthDate) : null,
          },
          include: employeeInclude,
        }),
      );
      await this.syncRestrictions(tx, assigned.id, noFlightDates, restrictedShiftIds, preferredShiftIds);
      return tx.employee.findUniqueOrThrow({
        where: { id: assigned.id },
        include: employeeDetailInclude,
      });
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      type?: EmployeeType;
      roleId?: string | null;
      birthDate?: string | null;
      active?: boolean;
      seniorityNumber?: number | null;
      noFlightDates?: string[];
      restrictedShiftIds?: string[];
      preferredShiftIds?: string[];
    },
  ) {
    const current = await prisma.employee.findUnique({ where: { id } });
    if (!current) throw new Error("NOT_FOUND");

    const { birthDate, seniorityNumber, type, noFlightDates, restrictedShiftIds, preferredShiftIds, ...rest } = data;
    const nextType = type ?? current.type;

    return prisma.$transaction(async (tx) => {
      if (type !== undefined && type !== current.type) {
        await this.compactGroup(tx, current.type, id);
        await tx.employee.update({
          where: { id },
          data: { type: nextType, seniorityNumber: -10_000 },
        });
        const target = normalizeSeniorityInput(seniorityNumber);
        const newGroupIds = (await this.listGroupIds(tx, nextType)).filter((groupId) => groupId !== id);
        const position = target ?? newGroupIds.length + 1;
        const ordered = insertIdAtPosition(newGroupIds, id, position);
        await this.applyGroupSeniorityOrder(tx, nextType, ordered);
      } else if (seniorityNumber !== undefined) {
        const target = normalizeSeniorityInput(seniorityNumber);
        if (target != null && target !== current.seniorityNumber) {
          const groupIds = await this.listGroupIds(tx, current.type);
          const ordered = reorderIdsInGroup(groupIds, id, target);
          await this.applyGroupSeniorityOrder(tx, current.type, ordered);
        }
      }

      const patch = { ...rest } as Parameters<typeof prisma.employee.update>[0]["data"];
      if (type !== undefined) patch.type = type;
      if (birthDate !== undefined) {
        patch.birthDate = birthDate ? toDbDate(birthDate) : null;
      }

      if (Object.keys(patch).length > 0) {
        await tx.employee.update({ where: { id }, data: patch });
      }

      if (noFlightDates !== undefined || restrictedShiftIds !== undefined || preferredShiftIds !== undefined) {
        await this.syncRestrictions(tx, id, noFlightDates, restrictedShiftIds, preferredShiftIds);
      }

      return tx.employee.findUniqueOrThrow({ where: { id }, include: employeeDetailInclude });
    });
  }

  async countOperationalHistory(employeeId: string) {
    const [
      scheduleAssignments,
      vacations,
      requestedDaysOff,
      flightAssignments,
      preAllocationRows,
    ] = await Promise.all([
      prisma.scheduleAssignment.count({ where: { employeeId } }),
      prisma.vacation.count({ where: { employeeId } }),
      prisma.requestedDayOff.count({ where: { employeeId } }),
      prisma.flightAssignment.count({ where: { employeeId } }),
      prisma.preAllocation.findMany({
        where: { employeeId },
        select: { label: true },
      }),
    ]);

    const generatorLabels = new Set(
      REGENERATION_CLEAR_LABELS.map((label) => label.toUpperCase()),
    );

    let preAllocations = 0;
    let generatorPreAllocations = 0;
    for (const row of preAllocationRows) {
      const normalized = normalizeOperationalLabel(row.label).toUpperCase();
      if (generatorLabels.has(normalized)) {
        generatorPreAllocations++;
      } else {
        preAllocations++;
      }
    }

    return {
      scheduleAssignments,
      vacations,
      requestedDaysOff,
      flightAssignments,
      preAllocations,
      generatorPreAllocations,
    };
  }

  async delete(id: string) {
    const current = await prisma.employee.findUnique({ where: { id } });
    if (!current) throw new Error("NOT_FOUND");

    return prisma.$transaction(async (tx) => {
      await tx.scheduleAssignment.deleteMany({ where: { employeeId: id } });
      await tx.preAllocation.deleteMany({ where: { employeeId: id } });
      await tx.employee.delete({ where: { id } });
      await this.compactGroup(tx, current.type);
      return current;
    });
  }

  private async syncRestrictions(
    tx: Tx,
    employeeId: string,
    noFlightDates?: string[],
    restrictedShiftIds?: string[],
    preferredShiftIds?: string[],
  ): Promise<void> {
    if (noFlightDates !== undefined) {
      const dates = dedupeIsoDates(noFlightDates);
      await tx.employeeFlightRestriction.deleteMany({ where: { employeeId } });
      if (dates.length > 0) {
        await tx.employeeFlightRestriction.createMany({
          data: dates.map((date) => ({ employeeId, date: toDbDate(date) })),
        });
      }
    }

    if (restrictedShiftIds !== undefined) {
      const shiftIds = dedupeIds(restrictedShiftIds);
      await tx.employeeShiftRestriction.deleteMany({ where: { employeeId } });
      if (shiftIds.length > 0) {
        const existing = await tx.shift.findMany({
          where: { id: { in: shiftIds } },
          select: { id: true },
        });
        const valid = new Set(existing.map((s) => s.id));
        const rows = shiftIds.filter((sid) => valid.has(sid)).map((shiftId) => ({ employeeId, shiftId }));
        if (rows.length > 0) {
          await tx.employeeShiftRestriction.createMany({ data: rows });
        }
      }
    }

    if (preferredShiftIds !== undefined) {
      const shiftIds = dedupeIds(preferredShiftIds);
      await tx.employeePreferredShift.deleteMany({ where: { employeeId } });
      if (shiftIds.length > 0) {
        const existing = await tx.shift.findMany({
          where: { id: { in: shiftIds } },
          select: { id: true },
        });
        const valid = new Set(existing.map((s) => s.id));
        const rows = shiftIds.filter((sid) => valid.has(sid)).map((shiftId) => ({ employeeId, shiftId }));
        if (rows.length > 0) {
          await tx.employeePreferredShift.createMany({ data: rows });
        }
      }
    }
  }

  private async listGroupIds(tx: Tx, type: EmployeeType): Promise<string[]> {
    const rows = await tx.employee.findMany({
      where: { type },
      orderBy: [{ seniorityNumber: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async applyGroupSeniorityOrder(
    tx: Tx,
    _type: EmployeeType,
    orderedIds: string[],
  ): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.employee.update({
        where: { id: orderedIds[i] },
        data: { seniorityNumber: -(i + 1) },
      });
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.employee.update({
        where: { id: orderedIds[i] },
        data: { seniorityNumber: i + 1 },
      });
    }
  }

  private async assignSeniorityOnCreate(
    tx: Tx,
    type: EmployeeType,
    requested: number | null | undefined,
    createRow: (tempSeniority: number) => Promise<{ id: string }>,
  ) {
    const normalized = normalizeSeniorityInput(requested);
    const existingIds = await this.listGroupIds(tx, type);

    let createdId: string;
    if (normalized == null) {
      const row = await createRow(-(existingIds.length + 10_001));
      createdId = row.id;
      await this.applyGroupSeniorityOrder(tx, type, [...existingIds, createdId]);
    } else {
      const row = await createRow(-(normalized + 10_000));
      createdId = row.id;
      await this.applyGroupSeniorityOrder(
        tx,
        type,
        insertIdAtPosition(existingIds, createdId, normalized),
      );
    }

    return tx.employee.findUniqueOrThrow({
      where: { id: createdId },
      include: employeeInclude,
    });
  }

  private async compactGroup(tx: Tx, type: EmployeeType, excludeId?: string): Promise<void> {
    const ids = await this.listGroupIds(tx, type);
    const remaining = excludeId ? ids.filter((groupId) => groupId !== excludeId) : ids;
    if (remaining.length === 0) return;
    await this.applyGroupSeniorityOrder(tx, type, remaining);
  }
}
