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

function formatBrDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatDateSpan(dates: string[]): string {
  const sorted = [...new Set(dates.map((d) => d.slice(0, 10)))].sort();
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return `no dia ${formatBrDate(sorted[0]!)}`;
  return `entre os dias ${formatBrDate(sorted[0]!)} e ${formatBrDate(sorted[sorted.length - 1]!)}`;
}

function humanLabel(token: string): string {
  const t = (token || "—").trim();
  if (!t || t === "—") return "em branco";
  switch (t.toUpperCase()) {
    case "F":
      return "folga";
    case "FS":
      return "folga social";
    case "FA":
      return "folga agrupada";
    case "FP":
      return "folga pedida";
    case "SIM":
      return "simulador";
    case "CRS":
      return "curso";
    case "VOO":
      return "voo";
    case "CMA":
      return "CMA";
    case "ND":
      return "ND";
    case "OUTRO":
      return "outro";
    case "REUN":
      return "reunião de assuntos";
    default:
      return t;
  }
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

export type ApaoNotifyChange =
  | {
      kind: "edit";
      employeeId: string;
      dates: string[];
      beforeType: ManualAllocationType | null;
      afterType: ManualAllocationType;
    }
  | {
      kind: "move";
      sourceEmployeeId: string;
      targetEmployeeId: string;
      sourceDate: string;
      targetDate: string;
      sourceBeforeType: ManualAllocationType | null;
      targetBeforeType: ManualAllocationType | null;
    };

export class AdminExecutedChangeService {
  async recordEditRangeChange(input: {
    scheduleMonthId: string;
    employeeId: string;
    date: string;
    beforeType: ManualAllocationType | null;
    afterType: ManualAllocationType;
    notes?: string | null;
  }): Promise<boolean> {
    const before = input.beforeType;
    const after = input.afterType === "CLEAR" ? null : input.afterType;
    const beforeTok = normalizeToken(before);
    const afterTok = normalizeToken(after);
    if (beforeTok === afterTok) return false;

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

    return true;
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

  private async buildSimpleSummary(change: ApaoNotifyChange): Promise<string> {
    if (change.kind === "edit") {
      const emp = await prisma.employee.findUnique({
        where: { id: change.employeeId },
        select: { name: true },
      });
      const name = emp?.name?.trim() || "colaborador";
      const beforeTok = normalizeToken(change.beforeType);
      const afterTok = normalizeToken(
        change.afterType === "CLEAR" ? null : change.afterType,
      );
      const span = formatDateSpan(change.dates);
      const beforeIsShift =
        !!change.beforeType && SHIFT_ALLOCATION_TYPES.has(change.beforeType);
      const afterIsShift =
        change.afterType !== "CLEAR" && SHIFT_ALLOCATION_TYPES.has(change.afterType);

      if (beforeIsShift || afterIsShift) {
        return `Troca de turnos ${span}: de ${humanLabel(beforeTok)} para ${humanLabel(afterTok)} (${name}).`;
      }
      return `Alteração na escala ${span}: de ${humanLabel(beforeTok)} para ${humanLabel(afterTok)} (${name}).`;
    }

    const [sourceEmp, targetEmp] = await Promise.all([
      prisma.employee.findUnique({
        where: { id: change.sourceEmployeeId },
        select: { name: true },
      }),
      prisma.employee.findUnique({
        where: { id: change.targetEmployeeId },
        select: { name: true },
      }),
    ]);
    const sourceName = sourceEmp?.name?.trim() || "colaborador";
    const targetName = targetEmp?.name?.trim() || "colaborador";
    const span = formatDateSpan([change.sourceDate, change.targetDate]);
    const from = humanLabel(normalizeToken(change.sourceBeforeType));
    const to = humanLabel(normalizeToken(change.targetBeforeType));

    if (change.sourceEmployeeId === change.targetEmployeeId) {
      return `Troca de turnos ${span}: ${from} ↔ ${to} (${sourceName}).`;
    }
    return `Troca de turnos ${span}: ${from} (${sourceName}) ↔ ${to} (${targetName}).`;
  }

  async notifyApaoIfNeeded(
    employeeIds: string[],
    change?: ApaoNotifyChange,
  ): Promise<void> {
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

    const summary = change
      ? await this.buildSimpleSummary(change)
      : "Uma alteração foi realizada na escala APAO.";

    try {
      await emailService.send({
        to: recipients,
        subject: "Alteração na escala APAO",
        text: summary,
      });
    } catch (err) {
      console.error("[email] falha ao notificar alteração APAO:", err);
    }
  }
}

export const adminExecutedChangeService = new AdminExecutedChangeService();
