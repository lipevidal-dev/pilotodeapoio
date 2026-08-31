import type { EmployeeType, Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma-client.js";
import { isoDateKey, toDbDate } from "../../domain/rules/date-keys.js";
import {
  ShiftSwapRepository,
  type ShiftSwapWithParties,
} from "../../infrastructure/repositories/shift-swap.repository.js";
import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";
import { EmployeeNotLinkedError } from "./portal-request.use-case.js";

const swapRepo = new ShiftSwapRepository();
const scheduleRepo = new ScheduleRepository();

export class ShiftSwapNotAllowedError extends Error {
  readonly code = "SHIFT_SWAP_NOT_ALLOWED";

  constructor(message: string) {
    super(message);
    this.name = "ShiftSwapNotAllowedError";
  }
}

export class ShiftSwapNotFoundError extends Error {
  readonly code = "SHIFT_SWAP_NOT_FOUND";

  constructor() {
    super("Troca de turno não encontrada ou já foi processada.");
    this.name = "ShiftSwapNotFoundError";
  }
}

export class ShiftSwapForbiddenError extends Error {
  readonly code = "SHIFT_SWAP_FORBIDDEN";

  constructor(message = "Você não pode executar esta ação nesta troca.") {
    super(message);
    this.name = "ShiftSwapForbiddenError";
  }
}

type Tx = Prisma.TransactionClient;

type DaySnapshot = {
  assignment: {
    shiftCode: string;
    label: string | null;
  } | null;
  preAllocation: {
    label: string;
    notes: string | null;
    startTime: string | null;
    endTime: string | null;
  } | null;
};

function normalizeCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

function addDaysIso(iso: string, days: number): string {
  const d = toDbDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDateKey(d);
}

function isDateInMonth(iso: string, year: number, month: number): boolean {
  return iso.startsWith(`${year}-${String(month).padStart(2, "0")}-`);
}

/** Converte label operacional no token curto da grade (FA, VOO, T1…). */
function shortFromLabel(label: string): string | null {
  const n = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  if (!n) return null;
  if (n.includes("VOO")) return "VOO";
  if (n === "ND" || n.includes("NAO DISPONIVEL") || n.includes("NAO-DISPONIVEL")) return "ND";
  if (n.includes("FOLGA PEDIDA") || n === "FP") return "FP";
  if (n === "FOLGA SOCIAL" || n === "FS") return "FS";
  if (n.includes("FOLGA AGRUPADA") || n === "FA") return "FA";
  if (n.includes("FOLGA ANIVERS") || n === "FANI") return "FANI";
  if (n === "FOLGA" || n === "F") return "F";
  if (n.includes("SIMULADOR")) return "SIM";
  if (n.includes("CURSO")) return "CRS";
  if (n === "CMA") return "CMA";
  if (n.includes("FERIAS")) return "FER";
  if (/^T[A-Z0-9]+$/.test(n) || /^TI[A-Z0-9]+$/.test(n)) return n;
  return n.length > 6 ? `${n.slice(0, 5)}…` : n;
}

/**
 * Token do que a grade mostra no dia.
 * Prioridade: pré-alocação (FA/VOO/…) → código de turno → label do assignment.
 */
function displayTokenFromDay(day: DaySnapshot): string {
  if (day.preAllocation?.label) {
    const fromPre = shortFromLabel(day.preAllocation.label);
    if (fromPre) return fromPre;
  }

  const shift = normalizeCode(day.assignment?.shiftCode);
  if (shift) return shift;

  if (day.assignment?.label) {
    const fromAssignLabel = shortFromLabel(day.assignment.label);
    if (fromAssignLabel) return fromAssignLabel;
  }

  return "";
}

/** Prefere token da grade (cliente) quando o banco vier vazio ou genérico. */
function preferDisplayToken(dbToken: string, clientToken?: string | null): string {
  const db = (dbToken ?? "").trim();
  const client = (clientToken ?? "").trim();
  if (!isBlankDisplayToken(db)) return db;
  if (!isBlankDisplayToken(client)) return client;
  return db || client || "";
}

function splitClientTokens(joined: string | null | undefined, expected: number): string[] {
  if (!joined?.trim()) return Array.from({ length: expected }, () => "");
  const parts = joined.split("+").map((p) => p.trim());
  if (parts.length === expected) return parts;
  if (parts.length === 1 && expected > 1) {
    return Array.from({ length: expected }, () => parts[0] ?? "");
  }
  while (parts.length < expected) parts.push("");
  return parts.slice(0, expected);
}

async function tokenForEmployeeDay(
  tx: Tx | typeof prisma,
  scheduleMonthId: string,
  employeeId: string,
  iso: string,
): Promise<string> {
  const executed = await readExecutedDay(tx, scheduleMonthId, employeeId, iso);
  const fromExecuted = displayTokenFromDay(executed.day);
  if (fromExecuted) return fromExecuted;

  // Fallback: escala planejada (caso o espelho executado ainda não tenha o dia).
  const dbDate = toDbDate(iso);
  const planned = await tx.scheduleAssignment.findUnique({
    where: {
      scheduleMonthId_employeeId_date: { scheduleMonthId, employeeId, date: dbDate },
    },
  });
  if (planned) {
    const shift = normalizeCode(planned.shiftCode);
    if (shift) return shift;
    if (planned.label) {
      const fromLabel = shortFromLabel(planned.label);
      if (fromLabel) return fromLabel;
    }
  }

  const plannedPre = await tx.preAllocation.findUnique({
    where: {
      scheduleMonthId_employeeId_date: { scheduleMonthId, employeeId, date: dbDate },
    },
  });
  if (plannedPre?.label) {
    const fromPre = shortFromLabel(plannedPre.label);
    if (fromPre) return fromPre;
  }

  return "";
}

function isBlankDisplayToken(code: string | null | undefined): boolean {
  const raw = (code ?? "").trim();
  if (!raw) return true;
  return raw
    .split("+")
    .every((part) => {
      const p = part.trim().toLowerCase();
      return !p || p === "em branco" || p === "-";
    });
}

async function readExecutedDay(
  tx: Tx | typeof prisma,
  scheduleMonthId: string,
  employeeId: string,
  date: Date | string,
): Promise<{ dbDate: Date; day: DaySnapshot }> {
  const dbDate = toDbDate(isoDateKey(date));
  const [assignment, preAllocation] = await Promise.all([
    tx.executedScheduleAssignment.findUnique({
      where: {
        scheduleMonthId_employeeId_date: { scheduleMonthId, employeeId, date: dbDate },
      },
    }),
    tx.executedPreAllocation.findUnique({
      where: {
        scheduleMonthId_employeeId_date: { scheduleMonthId, employeeId, date: dbDate },
      },
    }),
  ]);

  return {
    dbDate,
    day: {
      assignment: assignment
        ? { shiftCode: assignment.shiftCode, label: assignment.label }
        : null,
      preAllocation: preAllocation
        ? {
            label: preAllocation.label,
            notes: preAllocation.notes,
            startTime: preAllocation.startTime,
            endTime: preAllocation.endTime,
          }
        : null,
    },
  };
}

async function clearExecutedDay(
  tx: Tx,
  scheduleMonthId: string,
  employeeId: string,
  dbDate: Date,
): Promise<void> {
  await tx.executedScheduleAssignment.deleteMany({
    where: { scheduleMonthId, employeeId, date: dbDate },
  });
  await tx.executedPreAllocation.deleteMany({
    where: { scheduleMonthId, employeeId, date: dbDate },
  });
}

async function writeExecutedDay(
  tx: Tx,
  scheduleMonthId: string,
  employeeId: string,
  dbDate: Date,
  day: DaySnapshot,
): Promise<void> {
  const shiftCode = (day.assignment?.shiftCode ?? "").trim();
  if (day.assignment && shiftCode) {
    await tx.executedScheduleAssignment.create({
      data: {
        scheduleMonthId,
        employeeId,
        date: dbDate,
        shiftCode: shiftCode.toUpperCase(),
        label: day.assignment.label,
        source: "MANUAL",
      },
    });
  }

  if (day.preAllocation) {
    await tx.executedPreAllocation.create({
      data: {
        scheduleMonthId,
        employeeId,
        date: dbDate,
        label: day.preAllocation.label,
        notes: day.preAllocation.notes,
        startTime: day.preAllocation.startTime,
        endTime: day.preAllocation.endTime,
      },
    });
  }
}

function mapSwap(row: ShiftSwapWithParties) {
  const requesterDates =
    row.requesterDates?.length > 0
      ? row.requesterDates.map((d) => isoDateKey(d))
      : expandConsecutiveDates(isoDateKey(row.date), row.pairLength);
  const targetStart = row.targetDate ? isoDateKey(row.targetDate) : isoDateKey(row.date);
  const targetDates =
    row.targetDates?.length > 0
      ? row.targetDates.map((d) => isoDateKey(d))
      : expandConsecutiveDates(targetStart, row.pairLength);

  return {
    id: row.id,
    scheduleMonthId: row.scheduleMonthId,
    kind: row.kind,
    year: row.scheduleMonth.year,
    month: row.scheduleMonth.month,
    date: requesterDates[0] ?? isoDateKey(row.date),
    targetDate: targetDates[0] ?? (row.targetDate ? isoDateKey(row.targetDate) : null),
    pairLength: Math.max(row.pairLength, requesterDates.length, 1),
    requesterDates,
    targetDates,
    requesterEmployeeId: row.requesterEmployeeId,
    requesterName: row.requester.name,
    requesterShiftCode: row.requesterShiftCode,
    targetEmployeeId: row.targetEmployeeId,
    targetName: row.target.name,
    targetShiftCode: row.targetShiftCode,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

function expandConsecutiveDates(startIso: string, length: number): string[] {
  const n = Math.max(1, length || 1);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDaysIso(startIso, i));
  return out;
}

function normalizeDateList(
  dates: string[],
  pairLength: number | undefined,
  year: number,
  month: number,
): string[] {
  let list = [...new Set(dates.map((d) => isoDateKey(d)))].sort();
  if (list.length === 1 && pairLength && pairLength > 1) {
    list = expandConsecutiveDates(list[0]!, pairLength);
  }
  if (list.length < 1) {
    throw new ShiftSwapNotAllowedError("Selecione ao menos um dia.");
  }
  for (const d of list) {
    if (!isDateInMonth(d, year, month)) {
      throw new ShiftSwapNotAllowedError("Data fora do mês da escala.");
    }
  }
  return list;
}

/** Pares origem↔destino para aplicar/exibir a troca. */
function resolveSwapDatePairs(row: ShiftSwapWithParties): Array<{ sourceIso: string; targetIso: string }> {
  const requesterDates =
    row.requesterDates?.length > 0
      ? row.requesterDates.map((d) => isoDateKey(d))
      : expandConsecutiveDates(isoDateKey(row.date), row.pairLength);
  const targetStart = row.targetDate ? isoDateKey(row.targetDate) : isoDateKey(row.date);
  const targetDates =
    row.targetDates?.length > 0
      ? row.targetDates.map((d) => isoDateKey(d))
      : expandConsecutiveDates(targetStart, row.pairLength);
  const n = Math.min(requesterDates.length, targetDates.length);
  const pairs: Array<{ sourceIso: string; targetIso: string }> = [];
  for (let i = 0; i < n; i++) {
    pairs.push({ sourceIso: requesterDates[i]!, targetIso: targetDates[i]! });
  }
  return pairs;
}

export type ShiftSwapDto = ReturnType<typeof mapSwap>;

function isApaoEmployee(employee: { type: EmployeeType; role?: { code: string } | null }): boolean {
  const cargo = (employee.role?.code ?? employee.type).trim().toUpperCase();
  return employee.type === "APAO" || cargo === "APAO";
}

function isFaDisplayToken(token: string): boolean {
  const t = token.trim().toUpperCase();
  return t === "FA" || t.includes("FOLGA AGRUPADA");
}

export class ShiftSwapUseCase {
  async resolveEmployeeId(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { employeeId: true },
    });
    if (!user?.employeeId) throw new EmployeeNotLinkedError();
    return user.employeeId;
  }

  async listActiveForMonth(year: number, month: number): Promise<ShiftSwapDto[]> {
    const scheduleMonth = await scheduleRepo.findMonth(year, month);
    if (!scheduleMonth) return [];
    const rows = await swapRepo.listActiveForMonth(scheduleMonth.id);
    return Promise.all(rows.map((row) => this.toSwapDto(row)));
  }

  /** Ativas (aguardando aceite/admin) + aprovadas/aceitas do mês (marcação visual). */
  async listVisualForMonth(year: number, month: number): Promise<ShiftSwapDto[]> {
    const scheduleMonth = await scheduleRepo.findMonth(year, month);
    if (!scheduleMonth) return [];
    const [active, awaitingAdmin, approved] = await Promise.all([
      swapRepo.listActiveForMonth(scheduleMonth.id),
      swapRepo.listAwaitingAdmin(),
      swapRepo.listApprovedForMonth(scheduleMonth.id),
    ]);
    const awaitingForMonth = awaitingAdmin.filter((r) => r.scheduleMonthId === scheduleMonth.id);
    return Promise.all(
      [...active, ...awaitingForMonth, ...approved].map((row) => this.toSwapDto(row)),
    );
  }

  async listForPortalEmployee(employeeId: string): Promise<ShiftSwapDto[]> {
    const rows = await swapRepo.listForEmployee(employeeId, [
      "OFFERED",
      "AWAITING_ADMIN",
      "APPROVED",
      "REJECTED_BY_TARGET",
      "REJECTED_BY_ADMIN",
      "CANCELLED",
    ]);
    return Promise.all(rows.map((row) => this.toSwapDto(row)));
  }

  async listAwaitingAdmin(): Promise<ShiftSwapDto[]> {
    const rows = await swapRepo.listAwaitingAdmin();
    return Promise.all(rows.map((row) => this.toSwapDto(row)));
  }

  async listApprovedAdmin(limit = 200): Promise<ShiftSwapDto[]> {
    const rows = await swapRepo.listApproved(limit);
    return Promise.all(rows.map((row) => this.toSwapDto(row)));
  }

  /** Reaplica trocas aprovadas após uma republicação reconstruir a escala realizada. */
  async reapplyApprovedForMonth(year: number, month: number): Promise<number> {
    const scheduleMonth = await scheduleRepo.findMonth(year, month);
    if (!scheduleMonth) return 0;
    const rows = (await swapRepo.listApprovedForMonth(scheduleMonth.id)).reverse();
    for (const row of rows) {
      await prisma.$transaction(async (tx) => {
        if (row.kind === "SELF") await this.applySelfSwap(tx, row);
        else await this.applyPeerSwap(tx, row);
      });
    }
    return rows.length;
  }

  /** Correção operacional idempotente por chamada controlada; não altera o histórico. */
  async reapplyApprovedById(swapId: string): Promise<ShiftSwapDto> {
    const row = await swapRepo.findById(swapId);
    if (!row || row.status !== "APPROVED") throw new ShiftSwapNotFoundError();
    await prisma.$transaction(async (tx) => {
      if (row.kind === "SELF") await this.applySelfSwap(tx, row);
      else await this.applyPeerSwap(tx, row);
    });
    return mapSwap(row);
  }

  /** Mapeia DTO e corrige tokens em branco em trocas ainda ativas. */
  private async toSwapDto(row: ShiftSwapWithParties): Promise<ShiftSwapDto> {
    const base = mapSwap(row);
    const active = row.status === "OFFERED";
    if (!active) return base;
    if (!isBlankDisplayToken(row.requesterShiftCode) && !isBlankDisplayToken(row.targetShiftCode)) {
      return base;
    }

    const fixed = await this.computeDisplayTokens(row);
    if (
      fixed.requesterShiftCode === row.requesterShiftCode &&
      fixed.targetShiftCode === row.targetShiftCode
    ) {
      return base;
    }

    // Persiste correção para a lista/admin não ficarem "em branco".
    await prisma.shiftSwapRequest.update({
      where: { id: row.id },
      data: {
        requesterShiftCode: fixed.requesterShiftCode,
        targetShiftCode: fixed.targetShiftCode,
      },
    });

    return {
      ...base,
      requesterShiftCode: fixed.requesterShiftCode,
      targetShiftCode: fixed.targetShiftCode,
    };
  }

  private async computeDisplayTokens(
    row: ShiftSwapWithParties,
  ): Promise<{ requesterShiftCode: string; targetShiftCode: string }> {
    const pairs = resolveSwapDatePairs(row);
    const sourceTokens: string[] = [];
    const targetTokens: string[] = [];

    for (const pair of pairs) {
      if (row.kind === "SELF") {
        const [s, t] = await Promise.all([
          tokenForEmployeeDay(prisma, row.scheduleMonthId, row.requesterEmployeeId, pair.sourceIso),
          tokenForEmployeeDay(prisma, row.scheduleMonthId, row.requesterEmployeeId, pair.targetIso),
        ]);
        sourceTokens.push(s || "");
        targetTokens.push(t || "");
      } else {
        const [requesterTok, targetTok] = await Promise.all([
          tokenForEmployeeDay(prisma, row.scheduleMonthId, row.requesterEmployeeId, pair.sourceIso),
          tokenForEmployeeDay(prisma, row.scheduleMonthId, row.targetEmployeeId, pair.targetIso),
        ]);
        sourceTokens.push(requesterTok || "");
        targetTokens.push(targetTok || "");
      }
    }

    return {
      requesterShiftCode: sourceTokens.join("+"),
      targetShiftCode: targetTokens.join("+"),
    };
  }

  /**
   * Troca entre dois colaboradores.
   * Listas `dates` (solicitante) e `targetDates` (colega) devem ter o mesmo tamanho.
   */
  async offer(params: {
    requesterEmployeeId: string;
    targetEmployeeId: string;
    year: number;
    month: number;
    date: string;
    targetDate: string;
    dates?: string[];
    targetDates?: string[];
    pairLength?: number;
    /** Tokens da grade (evita "em branco" quando o espelho DB atrasa). */
    requesterShiftCode?: string;
    targetShiftCode?: string;
    notes?: string;
  }): Promise<ShiftSwapDto> {
    if (params.requesterEmployeeId === params.targetEmployeeId) {
      throw new ShiftSwapNotAllowedError(
        "Para realocar na própria escala (APAO), use a troca interna.",
      );
    }

    const [requester, target] = await Promise.all([
      prisma.employee.findUnique({
        where: { id: params.requesterEmployeeId },
        include: { role: true },
      }),
      prisma.employee.findUnique({
        where: { id: params.targetEmployeeId },
        include: { role: true },
      }),
    ]);

    if (!requester?.active || !target?.active) {
      throw new ShiftSwapNotAllowedError("Funcionário inativo não pode participar de troca.");
    }

    const scheduleMonth = await this.requirePublishedMonth(params.year, params.month);

    const sourceDates = normalizeDateList(
      params.dates?.length ? params.dates : [params.date],
      params.pairLength,
      params.year,
      params.month,
    );
    const targetDates = normalizeDateList(
      params.targetDates?.length ? params.targetDates : [params.targetDate],
      params.pairLength,
      params.year,
      params.month,
    );

    if (sourceDates.length !== targetDates.length) {
      throw new ShiftSwapNotAllowedError(
        `Selecione a mesma quantidade de dias dos dois lados (${sourceDates.length} × ${targetDates.length}).`,
      );
    }
    if (sourceDates.length < 1) {
      throw new ShiftSwapNotAllowedError("Selecione ao menos um dia para a troca.");
    }

    const involvedDates = [...sourceDates, ...targetDates];
    const dbDates = [...new Set(involvedDates)].map((d) => toDbDate(d));
    const overlap = await swapRepo.findActiveOverlap({
      scheduleMonthId: scheduleMonth.id,
      dates: dbDates,
      employeeIds: [params.requesterEmployeeId, params.targetEmployeeId],
    });
    if (overlap) {
      throw new ShiftSwapNotAllowedError(
        "Já existe uma troca em andamento envolvendo um desses colaboradores nestes dias.",
      );
    }

    const clientSource = splitClientTokens(params.requesterShiftCode, sourceDates.length);
    const clientTarget = splitClientTokens(params.targetShiftCode, targetDates.length);
    const sourceTokens: string[] = [];
    const targetTokens: string[] = [];
    for (let i = 0; i < sourceDates.length; i++) {
      const [requesterTok, targetTok] = await Promise.all([
        tokenForEmployeeDay(prisma, scheduleMonth.id, params.requesterEmployeeId, sourceDates[i]!),
        tokenForEmployeeDay(prisma, scheduleMonth.id, params.targetEmployeeId, targetDates[i]!),
      ]);
      sourceTokens.push(preferDisplayToken(requesterTok, clientSource[i]));
      targetTokens.push(preferDisplayToken(targetTok, clientTarget[i]));
    }

    const requesterShiftCode = sourceTokens.join("+");
    const targetShiftCode = targetTokens.join("+");
    const approvedDuplicate = await swapRepo.findApprovedDuplicate({
      scheduleMonthId: scheduleMonth.id,
      requesterEmployeeId: params.requesterEmployeeId,
      targetEmployeeId: params.targetEmployeeId,
      requesterDates: sourceDates,
      targetDates,
      requesterShiftCode,
      targetShiftCode,
    });
    if (approvedDuplicate) {
      throw new ShiftSwapNotAllowedError(
        "Esta mesma troca já foi aceita e consta no histórico. Recarregue a escala antes de criar uma nova solicitação.",
      );
    }

    const created = await swapRepo.create({
      scheduleMonthId: scheduleMonth.id,
      kind: "PEER",
      date: toDbDate(sourceDates[0]!),
      targetDate: toDbDate(targetDates[0]!),
      pairLength: sourceDates.length,
      requesterDates: sourceDates,
      targetDates,
      requesterEmployeeId: params.requesterEmployeeId,
      targetEmployeeId: params.targetEmployeeId,
      requesterShiftCode,
      targetShiftCode,
      notes: params.notes?.trim() || null,
      status: "OFFERED",
    });

    return mapSwap(created);
  }

  /**
   * Realocação na própria escala (APAO): troca conteúdos entre sourceDate e targetDate.
   * Folga agrupada (FA) é sempre tratada como bloco de 2 dias consecutivos.
   * Aplica imediatamente na escala realizada (sem fila de admin).
   */
  async offerSelf(params: {
    employeeId: string;
    year: number;
    month: number;
    sourceDate: string;
    targetDate: string;
    dates?: string[];
    targetDates?: string[];
    pairLength?: number;
    requesterShiftCode?: string;
    targetShiftCode?: string;
    notes?: string;
  }): Promise<ShiftSwapDto> {
    const employee = await prisma.employee.findUnique({
      where: { id: params.employeeId },
      include: { role: true },
    });
    if (!employee?.active) {
      throw new ShiftSwapNotAllowedError("Funcionário inativo não pode participar de troca.");
    }
    if (!isApaoEmployee(employee)) {
      throw new ShiftSwapNotAllowedError(
        "Realocação na própria escala está disponível apenas para APAO.",
      );
    }

    const scheduleMonth = await this.requirePublishedMonth(params.year, params.month);

    let sourceDates = normalizeDateList(
      params.dates?.length ? params.dates : [params.sourceDate],
      params.pairLength,
      params.year,
      params.month,
    );
    const targetDates = normalizeDateList(
      params.targetDates?.length ? params.targetDates : [params.targetDate],
      params.pairLength,
      params.year,
      params.month,
    );

    // Se origem é FA e veio 1 dia, expande para o bloco de 2.
    if (sourceDates.length === 1) {
      const sourceStart = sourceDates[0]!;
      const sourceCurr = await readExecutedDay(
        prisma,
        scheduleMonth.id,
        params.employeeId,
        sourceStart,
      );
      const sourcePrevIso = addDaysIso(sourceStart, -1);
      const sourceNextIso = addDaysIso(sourceStart, 1);
      const sourcePrev = isDateInMonth(sourcePrevIso, params.year, params.month)
        ? await readExecutedDay(prisma, scheduleMonth.id, params.employeeId, sourcePrevIso)
        : null;
      const sourceNext = isDateInMonth(sourceNextIso, params.year, params.month)
        ? await readExecutedDay(prisma, scheduleMonth.id, params.employeeId, sourceNextIso)
        : null;
      const currFa = isFaDisplayToken(displayTokenFromDay(sourceCurr.day));
      const prevFa = sourcePrev ? isFaDisplayToken(displayTokenFromDay(sourcePrev.day)) : false;
      const nextFa = sourceNext ? isFaDisplayToken(displayTokenFromDay(sourceNext.day)) : false;
      if (currFa && prevFa) {
        sourceDates = [sourcePrevIso, sourceStart];
      } else if (currFa && nextFa) {
        sourceDates = [sourceStart, sourceNextIso];
      }
    }

    if (sourceDates.length !== targetDates.length) {
      throw new ShiftSwapNotAllowedError(
        `Selecione a mesma quantidade de dias na origem e no destino (${sourceDates.length} × ${targetDates.length}).`,
      );
    }

    const sourceSet = new Set(sourceDates);
    for (const t of targetDates) {
      if (sourceSet.has(t)) {
        throw new ShiftSwapNotAllowedError(
          "Os dias de destino não podem coincidir com os dias de origem.",
        );
      }
    }

    const dbDates = [...new Set([...sourceDates, ...targetDates])].map((d) => toDbDate(d));
    const overlap = await swapRepo.findActiveOverlap({
      scheduleMonthId: scheduleMonth.id,
      dates: dbDates,
      employeeIds: [params.employeeId],
    });
    if (overlap) {
      throw new ShiftSwapNotAllowedError(
        "Já existe uma troca em andamento envolvendo um desses dias.",
      );
    }

    const clientSource = splitClientTokens(params.requesterShiftCode, sourceDates.length);
    const clientTarget = splitClientTokens(params.targetShiftCode, targetDates.length);
    const sourceTokens: string[] = [];
    const targetTokens: string[] = [];
    for (let i = 0; i < sourceDates.length; i++) {
      const [s, t] = await Promise.all([
        tokenForEmployeeDay(prisma, scheduleMonth.id, params.employeeId, sourceDates[i]!),
        tokenForEmployeeDay(prisma, scheduleMonth.id, params.employeeId, targetDates[i]!),
      ]);
      sourceTokens.push(preferDisplayToken(s, clientSource[i]));
      targetTokens.push(preferDisplayToken(t, clientTarget[i]));
    }

    const now = new Date();
    const finalized = await prisma.$transaction(async (tx) => {
      const created = await tx.shiftSwapRequest.create({
        data: {
          scheduleMonthId: scheduleMonth.id,
          kind: "SELF",
          date: toDbDate(sourceDates[0]!),
          targetDate: toDbDate(targetDates[0]!),
          pairLength: sourceDates.length,
          requesterDates: sourceDates,
          targetDates,
          requesterEmployeeId: params.employeeId,
          targetEmployeeId: params.employeeId,
          requesterShiftCode: sourceTokens.join("+"),
          targetShiftCode: targetTokens.join("+"),
          notes: params.notes?.trim() || null,
          status: "AWAITING_ADMIN",
          respondedAt: now,
        },
        include: {
          requester: { include: { role: true } },
          target: { include: { role: true } },
          scheduleMonth: true,
        },
      });
      return created;
    });

    return mapSwap(finalized);
  }

  async acceptByTarget(swapId: string, targetEmployeeId: string): Promise<ShiftSwapDto> {
    const row = await swapRepo.findById(swapId);
    if (!row || row.status !== "OFFERED") throw new ShiftSwapNotFoundError();
    if (row.kind !== "PEER") {
      throw new ShiftSwapNotAllowedError("Esta troca não exige aceite de colaborador.");
    }
    if (row.targetEmployeeId !== targetEmployeeId) {
      throw new ShiftSwapForbiddenError("Somente o destinatário pode aceitar esta troca.");
    }

    const now = new Date();
    const needsAdmin =
      isApaoEmployee(row.requester) || isApaoEmployee(row.target);

    if (needsAdmin) {
      const updated = await swapRepo.updateStatus(swapId, "AWAITING_ADMIN", {
        respondedAt: now,
      });
      return mapSwap(updated);
    }

    await prisma.$transaction(async (tx) => {
      await this.applyPeerSwap(tx, row);
      await tx.shiftSwapRequest.update({
        where: { id: swapId },
        data: {
          status: "APPROVED",
          respondedAt: now,
          resolvedAt: now,
        },
      });
    });

    const updated = await swapRepo.findById(swapId);
    if (!updated) throw new ShiftSwapNotFoundError();
    return mapSwap(updated);
  }

  async rejectByTarget(swapId: string, targetEmployeeId: string): Promise<ShiftSwapDto> {
    const row = await swapRepo.findById(swapId);
    if (!row || row.status !== "OFFERED") throw new ShiftSwapNotFoundError();
    if (row.kind !== "PEER") {
      throw new ShiftSwapNotAllowedError("Esta troca não exige aceite de colega.");
    }
    if (row.targetEmployeeId !== targetEmployeeId) {
      throw new ShiftSwapForbiddenError("Somente o destinatário pode recusar esta troca.");
    }

    const updated = await swapRepo.updateStatus(swapId, "REJECTED_BY_TARGET", {
      respondedAt: new Date(),
      resolvedAt: new Date(),
    });
    return mapSwap(updated);
  }

  async cancelByRequester(swapId: string, requesterEmployeeId: string): Promise<ShiftSwapDto> {
    const row = await swapRepo.findById(swapId);
    if (!row || (row.status !== "OFFERED" && row.status !== "AWAITING_ADMIN")) {
      throw new ShiftSwapNotFoundError();
    }
    if (row.requesterEmployeeId !== requesterEmployeeId) {
      throw new ShiftSwapForbiddenError("Somente quem ofertou pode cancelar esta troca.");
    }

    const updated = await swapRepo.updateStatus(swapId, "CANCELLED", {
      resolvedAt: new Date(),
    });
    return mapSwap(updated);
  }

  async approveByAdmin(swapId: string): Promise<ShiftSwapDto> {
    const row = await swapRepo.findById(swapId);
    if (!row || row.status !== "AWAITING_ADMIN") throw new ShiftSwapNotFoundError();

    await prisma.$transaction(async (tx) => {
      if (row.kind === "SELF") {
        await this.applySelfSwap(tx, row);
      } else {
        await this.applyPeerSwap(tx, row);
      }

      await tx.shiftSwapRequest.update({
        where: { id: swapId },
        data: { status: "APPROVED", resolvedAt: new Date() },
      });
    });

    const updated = await swapRepo.findById(swapId);
    if (!updated) throw new ShiftSwapNotFoundError();
    return mapSwap(updated);
  }

  async rejectByAdmin(swapId: string): Promise<ShiftSwapDto> {
    const row = await swapRepo.findById(swapId);
    if (!row || row.status !== "AWAITING_ADMIN") throw new ShiftSwapNotFoundError();

    const updated = await swapRepo.updateStatus(swapId, "REJECTED_BY_ADMIN", {
      resolvedAt: new Date(),
    });
    return mapSwap(updated);
  }

  private async requirePublishedMonth(year: number, month: number) {
    const scheduleMonth = await scheduleRepo.findMonth(year, month);
    if (!scheduleMonth) {
      throw new ShiftSwapNotAllowedError("Escala do mês não encontrada.");
    }
    if (scheduleMonth.status !== "PUBLISHED") {
      throw new ShiftSwapNotAllowedError(
        "Troca só é permitida na escala realizada (mês publicado).",
      );
    }
    return scheduleMonth;
  }

  private async applyPeerSwap(tx: Tx, row: ShiftSwapWithParties): Promise<void> {
    const datePairs = resolveSwapDatePairs(row);
    const pairs: Array<{
      requesterDay: DaySnapshot;
      targetDay: DaySnapshot;
      requesterDate: Date;
      targetDate: Date;
    }> = [];

    for (const pair of datePairs) {
      const [requesterPack, targetPack] = await Promise.all([
        readExecutedDay(tx, row.scheduleMonthId, row.requesterEmployeeId, pair.sourceIso),
        readExecutedDay(tx, row.scheduleMonthId, row.targetEmployeeId, pair.targetIso),
      ]);
      pairs.push({
        requesterDay: requesterPack.day,
        targetDay: targetPack.day,
        requesterDate: requesterPack.dbDate,
        targetDate: targetPack.dbDate,
      });
    }

    for (const p of pairs) {
      await clearExecutedDay(tx, row.scheduleMonthId, row.requesterEmployeeId, p.requesterDate);
      await clearExecutedDay(tx, row.scheduleMonthId, row.targetEmployeeId, p.targetDate);
    }

    for (const p of pairs) {
      await writeExecutedDay(
        tx,
        row.scheduleMonthId,
        row.requesterEmployeeId,
        p.requesterDate,
        p.targetDay,
      );
      await writeExecutedDay(
        tx,
        row.scheduleMonthId,
        row.targetEmployeeId,
        p.targetDate,
        p.requesterDay,
      );
    }
  }

  private async applySelfSwap(tx: Tx, row: ShiftSwapWithParties): Promise<void> {
    const datePairs = resolveSwapDatePairs(row);
    if (datePairs.length < 1) {
      throw new ShiftSwapNotAllowedError("Troca interna sem dias de destino.");
    }

    const employeeId = row.requesterEmployeeId;
    const pairs: Array<{ source: DaySnapshot; target: DaySnapshot; sourceDate: Date; targetDate: Date }> =
      [];

    for (const pair of datePairs) {
      const [sPack, tPack] = await Promise.all([
        readExecutedDay(tx, row.scheduleMonthId, employeeId, pair.sourceIso),
        readExecutedDay(tx, row.scheduleMonthId, employeeId, pair.targetIso),
      ]);
      pairs.push({
        source: sPack.day,
        target: tPack.day,
        sourceDate: sPack.dbDate,
        targetDate: tPack.dbDate,
      });
    }

    for (const p of pairs) {
      await clearExecutedDay(tx, row.scheduleMonthId, employeeId, p.sourceDate);
      await clearExecutedDay(tx, row.scheduleMonthId, employeeId, p.targetDate);
    }

    for (const p of pairs) {
      await writeExecutedDay(tx, row.scheduleMonthId, employeeId, p.sourceDate, p.target);
      await writeExecutedDay(tx, row.scheduleMonthId, employeeId, p.targetDate, p.source);
    }
  }
}

export const shiftSwapUseCase = new ShiftSwapUseCase();
