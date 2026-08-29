import { prisma } from "../../infrastructure/database/prisma-client.js";
import { isoDateKey, toDbDate } from "../../domain/rules/date-keys.js";
import {
  PENDING_PREALLOC_NOTES,
  buildPortalApprovedPreAllocationNotes,
  buildPortalFpNotes,
  isPendingPreAllocationNotes,
  PORTAL_APPROVED_PREALLOC_NOTES,
  stripPendingPreAllocationNotes,
  stripPortalApprovedPreAllocationNotes,
  stripPortalFpNotes,
} from "../../domain/schedule/pending-request.js";
import { normalizePreAllocationLabel } from "../../domain/schedule/valid-preallocation-labels.js";
import {
  isFpPreAllocationLabel,
} from "../utils/portal-schedule.filter.js";
import { RequestedDayOffRepository } from "../../infrastructure/repositories/requested-day-off.repository.js";
import { FlightAssignmentRepository } from "../../infrastructure/repositories/flight-assignment.repository.js";
import { PreAllocationRepository } from "../../infrastructure/repositories/pre-allocation.repository.js";
import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";
import { requestedDayOffUseCase } from "./requested-day-off.use-case.js";
import { flightAssignmentUseCase } from "./flight-assignment.use-case.js";
import { preAllocationUseCase } from "./pre-allocation.use-case.js";
import { vacationUseCase } from "./vacation.use-case.js";
import { VacationRepository } from "../../infrastructure/repositories/vacation.repository.js";
import { MAX_REQUESTED_OFF_PER_MONTH } from "../../domain/rules/constants.js";

const requestedDayOffRepo = new RequestedDayOffRepository();
const flightAssignmentRepo = new FlightAssignmentRepository();
const preAllocationRepo = new PreAllocationRepository();
const vacationRepo = new VacationRepository();
const scheduleRepo = new ScheduleRepository();

export class EmployeeNotLinkedError extends Error {
  readonly code = "EMPLOYEE_NOT_LINKED";

  constructor() {
    super("Usuário não vinculado a um funcionário. Contate o administrador.");
    this.name = "EmployeeNotLinkedError";
  }
}

export class PortalRequestNotFoundError extends Error {
  readonly code = "PORTAL_REQUEST_NOT_FOUND";

  constructor() {
    super("Solicitação pendente não encontrada ou já foi processada.");
    this.name = "PortalRequestNotFoundError";
  }
}

export class PortalFpMonthlyLimitExceededError extends Error {
  readonly code = "PORTAL_FP_MONTHLY_LIMIT";

  constructor(limit = MAX_REQUESTED_OFF_PER_MONTH) {
    super(`No máximo são permitidas ${limit} folgas pedidas no mês.`);
    this.name = "PortalFpMonthlyLimitExceededError";
  }
}

export type PortalRequestType =
  | "FP"
  | "VOO"
  | "SIMULADOR"
  | "CURSO"
  | "CMA"
  | "OUTRO"
  | "FOLGA"
  | "FS"
  | "FA"
  | "FANI"
  | "ND"
  | "FERIAS"
  | "TURNO";

const PAO_PORTAL_REQUEST_TYPES = new Set<PortalRequestType>([
  "FP",
  "VOO",
  "OUTRO",
  "FERIAS",
]);

const APAO_PORTAL_REQUEST_TYPES = new Set<PortalRequestType>([
  "FP",
  "FA",
  "TURNO",
  "OUTRO",
]);

const PORTAL_REQUEST_TO_PREALLOC_LABEL: Record<
  Exclude<PortalRequestType, "FP" | "VOO" | "FERIAS">,
  string
> = {
  SIMULADOR: "SIMULADOR",
  CURSO: "CURSO",
  CMA: "CMA",
  OUTRO: "OUTRO",
  FOLGA: "FOLGA",
  FS: "FOLGA SOCIAL",
  FA: "FOLGA AGRUPADA",
  FANI: "FOLGA ANIVERSÁRIO",
  ND: "ND",
  TURNO: "TURNO",
};

const PROTECTED_MANUAL_FP_NOTES = "escala-manual";

function portalTypeFromPreAllocationLabel(label: string): PortalRequestType | null {
  const normalized = normalizePreAllocationLabel(label).toUpperCase();
  const map: Record<string, PortalRequestType> = {
    SIMULADOR: "SIMULADOR",
    CURSO: "CURSO",
    "CURSO ONLINE": "CURSO",
    CMA: "CMA",
    OUTRO: "OUTRO",
    FOLGA: "FOLGA",
    "FOLGA SOCIAL": "FS",
    FS: "FS",
    "FOLGA AGRUPADA": "FA",
    FA: "FA",
    TURNO: "TURNO",
    "FOLGA ANIVERSÁRIO": "FANI",
    FANI: "FANI",
    ND: "ND",
  };
  return map[normalized] ?? null;
}

function isProtectedManualFpNotes(notes?: string | null): boolean {
  return (notes ?? "").trim() === PROTECTED_MANUAL_FP_NOTES;
}

export type PendingPortalRequestRow = {
  id: string;
  employeeId: string;
  employee?: { id: string; name: string };
  year: number;
  month: number;
  date: string;
  endDate?: string;
  type: PortalRequestType;
  notes?: string | null;
  source: "pre_allocation" | "flight" | "requested_day_off" | "vacation";
  thirteenthAdvanceRequested?: boolean;
  thirteenthAdvanceStatus?: "PENDING" | "APPROVED" | "REJECTED" | null;
  sellTenDaysRequested?: boolean;
  sellTenDaysStatus?: "PENDING" | "APPROVED" | "REJECTED" | null;
};

export type RegisteredApaoPortalFolgaRow = {
  id: string;
  employeeId: string;
  employee?: { id: string; name: string };
  year: number;
  month: number;
  date: string;
  type: Exclude<PortalRequestType, "FP" | "VOO" | "SIMULADOR" | "CURSO" | "CMA" | "OUTRO" | "FERIAS" | "TURNO">;
  notes?: string | null;
  source: "pre_allocation";
};

const REGISTERED_APAO_PORTAL_TYPES = new Set<RegisteredApaoPortalFolgaRow["type"]>([
  "FOLGA",
  "FS",
  "FA",
  "FANI",
  "ND",
]);

export class PortalRequestUseCase {
  async resolveEmployeeId(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { employeeId: true },
    });
    if (user?.employeeId) return user.employeeId;

    const fallback = await prisma.employee.findFirst({
      where: { active: true, type: "PAO" },
      orderBy: { seniorityNumber: "asc" },
    });
    if (fallback) return fallback.id;

    throw new EmployeeNotLinkedError();
  }

  async listPendingRequests(): Promise<PendingPortalRequestRow[]> {
    const [pendingPreAllocs, pendingFlights, pendingFps, pendingVacations] = await Promise.all([
      prisma.preAllocation.findMany({
        where: { notes: { startsWith: PENDING_PREALLOC_NOTES } },
        include: {
          employee: { select: { id: true, name: true } },
          scheduleMonth: { select: { year: true, month: true } },
        },
        orderBy: [{ date: "asc" }, { employee: { name: "asc" } }],
      }),
      prisma.flightAssignment.findMany({
        where: { source: "REQUEST" },
        include: { employee: { select: { id: true, name: true } } },
        orderBy: [{ date: "asc" }, { employee: { name: "asc" } }],
      }),
      prisma.requestedDayOff.findMany({
        where: { status: "PENDING" },
        include: { employee: { select: { id: true, name: true } } },
        orderBy: [{ date: "asc" }, { employee: { name: "asc" } }],
      }),
      prisma.vacation.findMany({
        where: { status: "PENDING" },
        include: { employee: { select: { id: true, name: true } } },
        orderBy: [{ startDate: "asc" }, { employee: { name: "asc" } }],
      }),
    ]);

    const rows: PendingPortalRequestRow[] = [];

    for (const row of pendingPreAllocs) {
      const type = portalTypeFromPreAllocationLabel(row.label);
      if (!type) continue;
      rows.push({
        id: row.id,
        employeeId: row.employeeId,
        employee: row.employee ?? undefined,
        year: row.scheduleMonth.year,
        month: row.scheduleMonth.month,
        date: isoDateKey(row.date),
        type,
        notes: stripPendingPreAllocationNotes(row.notes),
        source: "pre_allocation",
      });
    }

    for (const row of pendingFlights) {
      const date = isoDateKey(row.date);
      const parsed = new Date(`${date}T12:00:00.000Z`);
      rows.push({
        id: row.id,
        employeeId: row.employeeId,
        employee: row.employee ?? undefined,
        year: parsed.getUTCFullYear(),
        month: parsed.getUTCMonth() + 1,
        date,
        type: "VOO",
        notes: row.description,
        source: "flight",
      });
    }

    for (const row of pendingFps) {
      const date = isoDateKey(row.date);
      const parsed = new Date(`${date}T12:00:00.000Z`);
      rows.push({
        id: row.id,
        employeeId: row.employeeId,
        employee: row.employee ?? undefined,
        year: parsed.getUTCFullYear(),
        month: parsed.getUTCMonth() + 1,
        date,
        type: "FP",
        notes: stripPortalFpNotes(row.notes),
        source: "requested_day_off",
      });
    }

    for (const row of pendingVacations) {
      const startDate = isoDateKey(row.startDate);
      const endDate = isoDateKey(row.endDate);
      const parsed = new Date(`${startDate}T12:00:00.000Z`);
      rows.push({
        id: row.id,
        employeeId: row.employeeId,
        employee: row.employee ?? undefined,
        year: parsed.getUTCFullYear(),
        month: parsed.getUTCMonth() + 1,
        date: startDate,
        endDate,
        type: "FERIAS",
        notes: row.notes,
        source: "vacation",
        thirteenthAdvanceRequested: row.thirteenthAdvanceRequested,
        thirteenthAdvanceStatus: row.thirteenthAdvanceStatus,
        sellTenDaysRequested: row.sellTenDaysRequested,
        sellTenDaysStatus: row.sellTenDaysStatus,
      });
    }

    return rows.sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      return (a.employee?.name ?? a.employeeId).localeCompare(b.employee?.name ?? b.employeeId);
    });
  }

  async listRegisteredApaoPortalFolgas(): Promise<RegisteredApaoPortalFolgaRow[]> {
    const markedRows = await prisma.preAllocation.findMany({
      where: { notes: { startsWith: PORTAL_APPROVED_PREALLOC_NOTES } },
      include: {
        employee: { select: { id: true, name: true } },
        scheduleMonth: { select: { year: true, month: true } },
      },
      orderBy: [{ date: "desc" }, { employee: { name: "asc" } }],
    });

    const legacyApprovedRows = await prisma.preAllocation.findMany({
      where: {
        OR: [{ notes: null }, { notes: "" }],
      },
      include: {
        employee: { select: { id: true, name: true } },
        scheduleMonth: { select: { year: true, month: true } },
      },
      orderBy: [{ date: "desc" }, { employee: { name: "asc" } }],
    });

    const result: RegisteredApaoPortalFolgaRow[] = [];

    const pushRow = (row: (typeof markedRows)[number]) => {
      const type = portalTypeFromPreAllocationLabel(row.label);
      if (!type || !REGISTERED_APAO_PORTAL_TYPES.has(type as RegisteredApaoPortalFolgaRow["type"])) {
        return;
      }
      result.push({
        id: row.id,
        employeeId: row.employeeId,
        employee: row.employee ?? undefined,
        year: row.scheduleMonth.year,
        month: row.scheduleMonth.month,
        date: isoDateKey(row.date),
        type: type as RegisteredApaoPortalFolgaRow["type"],
        notes: stripPortalApprovedPreAllocationNotes(row.notes),
        source: "pre_allocation",
      });
    };

    for (const row of markedRows) pushRow(row);

    for (const row of legacyApprovedRows) {
      const type = portalTypeFromPreAllocationLabel(row.label);
      if (!type || !REGISTERED_APAO_PORTAL_TYPES.has(type as RegisteredApaoPortalFolgaRow["type"])) {
        continue;
      }
      const wasUpdatedAfterCreate = row.updatedAt.getTime() - row.createdAt.getTime() > 2000;
      if (!wasUpdatedAfterCreate) continue;
      pushRow(row);
    }

    const deduped = new Map<string, RegisteredApaoPortalFolgaRow>();
    for (const row of result) {
      deduped.set(row.id, row);
    }

    return [...deduped.values()].sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      return (a.employee?.name ?? a.employeeId).localeCompare(b.employee?.name ?? b.employeeId);
    });
  }

  async countPortalFpRequests(employeeId: string, year: number, month: number): Promise<number> {
    return requestedDayOffRepo.countPortalFpRequestsInMonth(employeeId, year, month);
  }

  async createRequest(input: {
    userId: string;
    year: number;
    month: number;
    date: string;
    endDate?: string;
    type: PortalRequestType;
    notes?: string;
    thirteenthAdvanceRequested?: boolean;
    sellTenDaysRequested?: boolean;
  }) {
    const employeeId = await this.resolveEmployeeId(input.userId);
    await this.assertRequestTypeAllowed(employeeId, input.type);

    if (input.type === "FP") {
      await this.assertPortalFpMonthlyLimit(employeeId, input.year, input.month, 1);
      await this.assertPortalFpDayAvailable(employeeId, input.year, input.month, input.date);
      return requestedDayOffUseCase.create({
        employeeId,
        date: input.date,
        status: "PENDING",
        notes: buildPortalFpNotes(input.notes),
      });
    }

    if (input.type === "FERIAS") {
      return this.createPendingVacation({
        employeeId,
        startDate: input.date,
        endDate: input.endDate ?? input.date,
        notes: input.notes,
        thirteenthAdvanceRequested: input.thirteenthAdvanceRequested,
        sellTenDaysRequested: input.sellTenDaysRequested,
      });
    }

    if (input.type === "VOO") {
      return flightAssignmentUseCase.create({
        employeeId,
        date: input.date,
        description: input.notes,
        source: "REQUEST",
      });
    }

    return this.createPendingPreAllocation({
      year: input.year,
      month: input.month,
      employeeId,
      date: input.date,
      type: input.type,
      notes: input.notes,
    });
  }

  async approveRequest(input: {
    employeeId: string;
    year: number;
    month: number;
    date: string;
    type: PortalRequestType;
  }) {
    if (input.type === "FP") {
      const pendingRows = await requestedDayOffRepo.findByEmployeeDatesStatus(
        input.employeeId,
        [input.date],
        "PENDING",
      );
      if (pendingRows.length === 0) throw new PortalRequestNotFoundError();
      await requestedDayOffUseCase.update(pendingRows[0]!.id, { status: "APPROVED" });
      return { approved: true, type: input.type };
    }

    if (input.type === "FERIAS") {
      const row = await this.findPendingVacationCovering(input.employeeId, input.date);
      if (!row) throw new PortalRequestNotFoundError();
      await vacationRepo.update(row.id, { status: "APPROVED" });
      return { approved: true, type: input.type };
    }

    if (input.type === "VOO") {
      const rows = await flightAssignmentRepo.findByEmployeeDates(input.employeeId, [input.date]);
      const row = rows.find((r) => r.source === "REQUEST");
      if (!row) throw new PortalRequestNotFoundError();
      await flightAssignmentUseCase.update(row.id, { source: "MANUAL" });
      return { approved: true, type: input.type };
    }

    const label = PORTAL_REQUEST_TO_PREALLOC_LABEL[input.type];
    const month = await scheduleRepo.ensureMonth(input.year, input.month);
    const rows = await preAllocationRepo.findByScheduleMonthEmployeeDates(
      month.id,
      input.employeeId,
      [input.date],
    );
    const row = rows.find(
      (r) =>
        isPendingPreAllocationNotes(r.notes) &&
        normalizePreAllocationLabel(r.label) === normalizePreAllocationLabel(label),
    );
    if (!row) throw new PortalRequestNotFoundError();
    await preAllocationUseCase.update(
      row.id,
      { notes: buildPortalApprovedPreAllocationNotes(row.notes) },
      label,
    );
    return { approved: true, type: input.type };
  }

  async rejectRequest(input: {
    employeeId: string;
    year: number;
    month: number;
    date: string;
    type: PortalRequestType;
  }) {
    if (input.type === "FP") {
      const pendingRows = await requestedDayOffRepo.findByEmployeeDatesStatus(
        input.employeeId,
        [input.date],
        "PENDING",
      );
      if (pendingRows.length === 0) throw new PortalRequestNotFoundError();
      for (const row of pendingRows) {
        await requestedDayOffUseCase.update(row.id, { status: "REJECTED" });
      }
      return { rejected: true, type: input.type };
    }

    if (input.type === "FERIAS") {
      const row = await this.findPendingVacationCovering(input.employeeId, input.date);
      if (!row) throw new PortalRequestNotFoundError();
      await vacationRepo.update(row.id, { status: "REJECTED" });
      return { rejected: true, type: input.type };
    }

    if (input.type === "VOO") {
      const rows = await flightAssignmentRepo.findByEmployeeDates(input.employeeId, [input.date]);
      const row = rows.find((r) => r.source === "REQUEST");
      if (!row) throw new PortalRequestNotFoundError();
      await flightAssignmentUseCase.remove(row.id);
      return { rejected: true, type: input.type };
    }

    const label = PORTAL_REQUEST_TO_PREALLOC_LABEL[input.type];
    const month = await scheduleRepo.ensureMonth(input.year, input.month);
    const rows = await preAllocationRepo.findByScheduleMonthEmployeeDates(
      month.id,
      input.employeeId,
      [input.date],
    );
    const row = rows.find(
      (r) =>
        isPendingPreAllocationNotes(r.notes) &&
        normalizePreAllocationLabel(r.label) === normalizePreAllocationLabel(label),
    );
    if (!row) throw new PortalRequestNotFoundError();
    await preAllocationUseCase.remove(row.id, label);
    return { rejected: true, type: input.type };
  }

  async cancelRequest(input: {
    userId: string;
    year: number;
    month: number;
    date: string;
    type: PortalRequestType;
    requestId?: string;
  }) {
    const employeeId = await this.resolveEmployeeId(input.userId);
    const dateKey = isoDateKey(input.date);

    if (input.requestId) {
      try {
        return await this.cancelPendingById(employeeId, input.requestId, input.year, input.month);
      } catch (err) {
        if (!(err instanceof PortalRequestNotFoundError)) throw err;
      }
    }

    if (input.type === "FP") {
      const pendingRows = await requestedDayOffRepo.findByEmployeeDatesStatus(
        employeeId,
        [dateKey],
        "PENDING",
      );
      if (pendingRows.length > 0) {
        for (const row of pendingRows) {
          await requestedDayOffUseCase.remove(row.id);
        }

        const approved = await requestedDayOffRepo.findByEmployeeDatesStatus(
          employeeId,
          [dateKey],
          "APPROVED",
        );
        if (approved.length === 0) {
          await this.removeOrphanFpPreAllocations(input.year, input.month, employeeId, dateKey);
        }

        return { deleted: true, type: input.type };
      }

      const month = await scheduleRepo.ensureMonth(input.year, input.month);
      const preRows = await preAllocationRepo.findByScheduleMonthEmployeeDates(
        month.id,
        employeeId,
        [dateKey],
      );
      const pendingPreFp = preRows.find(
        (r) => isPendingPreAllocationNotes(r.notes) && isFpPreAllocationLabel(r.label),
      );
      if (pendingPreFp) {
        await preAllocationUseCase.remove(pendingPreFp.id, pendingPreFp.label);
        return { deleted: true, type: input.type };
      }

      throw new PortalRequestNotFoundError();
    }

    if (input.type === "VOO") {
      const rows = await flightAssignmentRepo.findByEmployeeDates(employeeId, [dateKey]);
      const row = rows.find((r) => r.source === "REQUEST");
      if (!row) throw new PortalRequestNotFoundError();
      await flightAssignmentUseCase.remove(row.id);
      return { deleted: true, type: input.type };
    }

    if (input.type === "FERIAS") {
      const row = await this.findPendingVacationCovering(employeeId, dateKey);
      if (!row) throw new PortalRequestNotFoundError();
      await vacationUseCase.remove(row.id);
      return { deleted: true, type: input.type };
    }

    const label = PORTAL_REQUEST_TO_PREALLOC_LABEL[input.type];
    const month = await scheduleRepo.ensureMonth(input.year, input.month);
    const rows = await preAllocationRepo.findByScheduleMonthEmployeeDates(
      month.id,
      employeeId,
      [dateKey],
    );
    const pendingRows = rows.filter((r) => isPendingPreAllocationNotes(r.notes));
    const row =
      pendingRows.find(
        (r) =>
          normalizePreAllocationLabel(r.label) === normalizePreAllocationLabel(label),
      ) ?? (pendingRows.length === 1 ? pendingRows[0] : undefined);
    if (!row) throw new PortalRequestNotFoundError();
    await preAllocationUseCase.remove(row.id, label);
    return { deleted: true, type: input.type };
  }

  /** Cancela por ID da solicitação — não exige match de data/tipo no payload. */
  private async cancelPendingById(
    employeeId: string,
    requestId: string,
    year: number,
    month: number,
  ): Promise<{ deleted: true; type: PortalRequestType }> {
    const fpRow = await requestedDayOffRepo.findById(requestId);
    if (fpRow && fpRow.employeeId === employeeId && fpRow.status === "PENDING") {
      const fpDateKey = isoDateKey(fpRow.date);
      await requestedDayOffUseCase.remove(fpRow.id);
      const approved = await requestedDayOffRepo.findByEmployeeDatesStatus(
        employeeId,
        [fpDateKey],
        "APPROVED",
      );
      if (approved.length === 0) {
        await this.removeOrphanFpPreAllocations(year, month, employeeId, fpDateKey);
      }
      return { deleted: true, type: "FP" };
    }

    const flightRow = await flightAssignmentRepo.findById(requestId);
    if (flightRow && flightRow.employeeId === employeeId && flightRow.source === "REQUEST") {
      await flightAssignmentUseCase.remove(flightRow.id);
      return { deleted: true, type: "VOO" };
    }

    const vacationRow = await vacationRepo.findById(requestId);
    if (vacationRow && vacationRow.employeeId === employeeId && vacationRow.status === "PENDING") {
      await vacationUseCase.remove(vacationRow.id);
      return { deleted: true, type: "FERIAS" };
    }

    const preRow = await preAllocationRepo.findById(requestId);
    if (preRow && preRow.employeeId === employeeId && isPendingPreAllocationNotes(preRow.notes)) {
      const resolvedType = portalTypeFromPreAllocationLabel(preRow.label);
      if (!resolvedType) throw new PortalRequestNotFoundError();
      await preAllocationUseCase.remove(preRow.id, preRow.label);
      return { deleted: true, type: resolvedType };
    }

    throw new PortalRequestNotFoundError();
  }

  private async assertRequestTypeAllowed(employeeId: string, type: PortalRequestType) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { role: true },
    });
    const cargo = (employee?.role?.code ?? employee?.type ?? "PAO").trim().toUpperCase();
    const isApao = employee?.type === "APAO" || cargo === "APAO" || cargo.includes("APAO");
    const allowed = isApao ? APAO_PORTAL_REQUEST_TYPES : PAO_PORTAL_REQUEST_TYPES;
    if (!allowed.has(type)) {
      throw new Error("Este tipo de solicitação não está disponível no portal do colaborador.");
    }
  }

  private async createPendingVacation(input: {
    employeeId: string;
    startDate: string;
    endDate: string;
    notes?: string;
    thirteenthAdvanceRequested?: boolean;
    sellTenDaysRequested?: boolean;
  }) {
    const startDate = isoDateKey(input.startDate);
    const endDate = isoDateKey(input.endDate);
    if (startDate > endDate) {
      throw new Error("Data início deve ser anterior ou igual à data fim");
    }

    const overlaps = await vacationRepo.findOverlapping(input.employeeId, startDate, endDate);
    if (overlaps.length > 0) {
      throw new Error("Já existe férias (pendente ou aprovada) sobreposta a este período");
    }

    return vacationRepo.create({
      employeeId: input.employeeId,
      startDate,
      endDate,
      notes: input.notes,
      status: "PENDING",
      thirteenthAdvanceRequested: input.thirteenthAdvanceRequested,
      sellTenDaysRequested: input.sellTenDaysRequested,
    });
  }

  private async findPendingVacationCovering(employeeId: string, date: string) {
    const dateKey = isoDateKey(date);
    const overlaps = await vacationRepo.findOverlapping(employeeId, dateKey, dateKey, ["PENDING"]);
    return overlaps[0] ?? null;
  }

  private async createPendingPreAllocation(input: {
    year: number;
    month: number;
    employeeId: string;
    date: string;
    type: Exclude<PortalRequestType, "FP" | "VOO" | "FERIAS">;
    notes?: string;
  }) {
    const label = PORTAL_REQUEST_TO_PREALLOC_LABEL[input.type];
    const notes = input.notes?.trim()
      ? `${PENDING_PREALLOC_NOTES} ${input.notes.trim()}`
      : PENDING_PREALLOC_NOTES;

    const month = await scheduleRepo.ensureMonth(input.year, input.month);
    return preAllocationRepo.create({
      scheduleMonthId: month.id,
      employeeId: input.employeeId,
      date: toDbDate(input.date),
      label,
      notes,
    });
  }

  private async assertPortalFpMonthlyLimit(
    employeeId: string,
    year: number,
    month: number,
    additionalCount: number,
  ) {
    const current = await requestedDayOffRepo.countPortalFpRequestsInMonth(employeeId, year, month);
    if (current + additionalCount > MAX_REQUESTED_OFF_PER_MONTH) {
      throw new PortalFpMonthlyLimitExceededError();
    }
  }

  private async assertPortalFpDayAvailable(
    employeeId: string,
    year: number,
    month: number,
    date: string,
  ) {
    const [pendingRows, approvedRows, preRows] = await Promise.all([
      requestedDayOffRepo.findByEmployeeDatesStatus(employeeId, [date], "PENDING"),
      requestedDayOffRepo.findByEmployeeDatesStatus(employeeId, [date], "APPROVED"),
      preAllocationRepo.findAll({ year, month }),
    ]);

    if (pendingRows.length > 0 || approvedRows.length > 0) {
      throw new Error("Já existe folga pedida para este dia");
    }

    const preFp = preRows.find(
      (row) =>
        row.employeeId === employeeId &&
        isoDateKey(row.date) === isoDateKey(date) &&
        isFpPreAllocationLabel(row.label),
    );

    if (preFp && isProtectedManualFpNotes(preFp.notes)) {
      throw new Error("Este dia já possui folga pedida cadastrada na escala");
    }

    if (preFp) {
      await preAllocationRepo.delete(preFp.id);
    }
  }

  private async removeOrphanFpPreAllocations(
    year: number,
    month: number,
    employeeId: string,
    date: string,
  ) {
    const rows = await preAllocationRepo.findAll({ year, month });
    const dateKey = isoDateKey(date);
    for (const row of rows) {
      if (row.employeeId !== employeeId || isoDateKey(row.date) !== dateKey) continue;
      if (!isFpPreAllocationLabel(row.label)) continue;
      if (isProtectedManualFpNotes(row.notes)) continue;
      await preAllocationRepo.delete(row.id);
    }
  }
}

export const portalRequestUseCase = new PortalRequestUseCase();
