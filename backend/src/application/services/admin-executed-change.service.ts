import { prisma } from "../../infrastructure/database/prisma-client.js";
import { toDbDate } from "../../domain/rules/date-keys.js";
import {
  PREALLOC_ALLOCATION_TYPES,
  SHIFT_ALLOCATION_TYPES,
  manualTypeToPreallocLabel,
  type ManualAllocationType,
} from "../../domain/schedule/manual-edit-types.js";
import {
  ADMIN_EXECUTED_AUDIT_LABEL,
  buildAdminExecutedAuditNotes,
  displayTokenFromManualType,
} from "../../domain/schedule/admin-executed-audit.js";
import { emailService } from "../../infrastructure/email/email.service.js";
import { shiftSwapUseCase } from "../use-cases/shift-swap.use-case.js";

function isApaoEmployee(employee: {
  type: string;
  role?: { code: string } | null;
}): boolean {
  const cargo = (employee.role?.code ?? employee.type).trim().toUpperCase();
  return employee.type === "APAO" || cargo === "APAO";
}

function normalizeToken(type: string | null | undefined): string {
  return displayTokenFromManualType(type);
}

function labeledCadastroLabel(type: ManualAllocationType): string | null {
  const label = manualTypeToPreallocLabel(type);
  if (!label) return null;
  const normalized = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  if (normalized === "CURSO ONLINE" || normalized === "CURSO") return "CURSO";
  if (normalized === "SIMULADOR") return "SIMULADOR";
  if (normalized === "CMA") return "CMA";
  if (normalized === "OUTRO") return "OUTRO";
  if (normalized === "REUNIAO DE ASSUNTOS") return "REUNIÃO DE ASSUNTOS";
  return null;
}

export class AdminExecutedChangeService {
  async recordEditRangeChange(input: {
    scheduleMonthId: string;
    employeeId: string;
    date: string;
    beforeType: ManualAllocationType | null;
    afterType: ManualAllocationType;
    notes?: string | null;
  }): Promise<void> {
    const before = input.beforeType;
    const after = input.afterType === "CLEAR" ? null : input.afterType;
    const beforeTok = normalizeToken(before);
    const afterTok = normalizeToken(after);
    if (beforeTok === afterTok) return;

    const beforeIsShift = !!before && SHIFT_ALLOCATION_TYPES.has(before);
    const afterIsShift = !!after && SHIFT_ALLOCATION_TYPES.has(after);
    const afterIsPre =
      !!after && (PREALLOC_ALLOCATION_TYPES.has(after) || after === "VOO");

    if (beforeIsShift || afterIsShift) {
      await shiftSwapUseCase.recordAdminExecutedAudit({
        scheduleMonthId: input.scheduleMonthId,
        kind: "SELF",
        requesterEmployeeId: input.employeeId,
        targetEmployeeId: input.employeeId,
        date: input.date,
        targetDate: input.date,
        requesterShiftCode: beforeTok,
        targetShiftCode: afterTok,
        notes: buildAdminExecutedAuditNotes(ADMIN_EXECUTED_AUDIT_LABEL),
      });
    }

    if (after && afterIsPre) {
      await this.syncCadastroRecord({
        scheduleMonthId: input.scheduleMonthId,
        employeeId: input.employeeId,
        date: input.date,
        type: after,
        notes: input.notes,
      });
    }
  }

  async recordMoveChange(input: {
    scheduleMonthId: string;
    sourceEmployeeId: string;
    sourceDate: string;
    targetEmployeeId: string;
    targetDate: string;
    sourceBeforeType: ManualAllocationType | null;
    targetBeforeType: ManualAllocationType | null;
  }): Promise<void> {
    const kind =
      input.sourceEmployeeId === input.targetEmployeeId ? "SELF" : "PEER";
    await shiftSwapUseCase.recordAdminExecutedAudit({
      scheduleMonthId: input.scheduleMonthId,
      kind,
      requesterEmployeeId: input.sourceEmployeeId,
      targetEmployeeId: input.targetEmployeeId,
      date: input.sourceDate,
      targetDate: input.targetDate,
      requesterShiftCode: normalizeToken(input.sourceBeforeType),
      targetShiftCode: normalizeToken(input.targetBeforeType),
      notes: buildAdminExecutedAuditNotes(ADMIN_EXECUTED_AUDIT_LABEL),
    });
  }

  private async syncCadastroRecord(input: {
    scheduleMonthId: string;
    employeeId: string;
    date: string;
    type: ManualAllocationType;
    notes?: string | null;
  }): Promise<void> {
    const auditNotes = buildAdminExecutedAuditNotes(
      input.notes?.trim() || ADMIN_EXECUTED_AUDIT_LABEL,
    );
    const dbDate = toDbDate(input.date);

    if (input.type === "VOO") {
      const existing = await prisma.flightAssignment.findUnique({
        where: {
          employeeId_date: { employeeId: input.employeeId, date: dbDate },
        },
      });
      if (existing) {
        await prisma.flightAssignment.update({
          where: { id: existing.id },
          data: {
            description: auditNotes,
            source: "MANUAL",
          },
        });
      } else {
        await prisma.flightAssignment.create({
          data: {
            employeeId: input.employeeId,
            date: dbDate,
            description: auditNotes,
            source: "MANUAL",
          },
        });
      }
      return;
    }

    if (input.type === "FP") {
      const existing = await prisma.requestedDayOff.findFirst({
        where: { employeeId: input.employeeId, date: dbDate },
      });
      if (existing) {
        await prisma.requestedDayOff.update({
          where: { id: existing.id },
          data: { status: "APPROVED", notes: auditNotes },
        });
      } else {
        await prisma.requestedDayOff.create({
          data: {
            employeeId: input.employeeId,
            date: dbDate,
            status: "APPROVED",
            notes: auditNotes,
          },
        });
      }
      return;
    }

    const label = labeledCadastroLabel(input.type);
    if (!label) return;

    await prisma.preAllocation.upsert({
      where: {
        scheduleMonthId_employeeId_date: {
          scheduleMonthId: input.scheduleMonthId,
          employeeId: input.employeeId,
          date: dbDate,
        },
      },
      create: {
        scheduleMonthId: input.scheduleMonthId,
        employeeId: input.employeeId,
        date: dbDate,
        label,
        notes: auditNotes,
      },
      update: {
        label,
        notes: auditNotes,
      },
    });
  }

  async notifyApaoIfNeeded(employeeIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(employeeIds.filter(Boolean))];
    if (uniqueIds.length === 0) return;

    const employees = await prisma.employee.findMany({
      where: { id: { in: uniqueIds } },
      include: { role: true },
    });
    if (!employees.some(isApaoEmployee)) return;

    const admins = await prisma.user.findMany({
      where: {
        role: "ADMIN",
        notificationEmail: { not: null },
      },
      select: { notificationEmail: true },
    });

    const to = admins
      .map((u) => u.notificationEmail)
      .filter((v): v is string => !!v && v.trim().length > 0);

    const recipients =
      to.length > 0 ? to : ["Thays_pgoncalves@hotmail.com"];

    try {
      await emailService.send({
        to: recipients,
        subject: "ALTERAÇÃO APAO",
        text: "Uma alteração foi ou está sendo realizada na escala APAO.",
      });
    } catch (err) {
      console.error("[email] falha ao notificar alteração APAO:", err);
    }
  }
}

export const adminExecutedChangeService = new AdminExecutedChangeService();
