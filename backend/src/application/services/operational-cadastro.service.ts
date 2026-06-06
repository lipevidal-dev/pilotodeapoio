import { buildOperationalCadastroDisplay } from "../mappers/operational-cadastro-display.mapper.js";
import type { OperationalCadastroDisplay } from "../mappers/operational-cadastro-display.mapper.js";
import { operationalLabelPriority } from "../../domain/rules/operational-cadastro-priority.js";
import { isInvalidPreAllocationLabel } from "../../domain/schedule/valid-preallocation-labels.js";
import { isoDateKey } from "../../domain/rules/date-keys.js";
import { calendarRepository } from "../../infrastructure/repositories/calendar.repository.js";
import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";

export interface OperationalCadastroCanonical extends OperationalCadastroDisplay {
  sourceId: string;
  priority: number;
  metadata?: Record<string, unknown>;
}

export interface OperationalCadastroDebugItem extends OperationalCadastroCanonical {
  valid: boolean;
  ignoredReason?: string;
  employeeName?: string;
}

export interface OperationalCadastroDebugReport {
  year: number;
  month: number;
  totalsByLabel: Record<string, number>;
  totalsIgnored: number;
  items: OperationalCadastroDebugItem[];
  ignored: OperationalCadastroDebugItem[];
}

/**
 * Fonte canônica de cadastros operacionais para escala, calendário e futuro motor.
 * Não consumir tabelas separadas diretamente fora deste serviço.
 */
export class OperationalCadastroService {
  constructor(
    private readonly scheduleRepo = new ScheduleRepository(),
    private readonly calendarRepo = calendarRepository,
  ) {}

  async getOperationalCadastrosForMonth(
    year: number,
    month: number,
    employeeId?: string,
  ): Promise<OperationalCadastroCanonical[]> {
    const rows = await this.loadRaw(year, month);
    const enriched = rows.map((row) => this.enrich(row));
    if (!employeeId) return enriched;
    return enriched.filter((r) => r.employeeId === employeeId);
  }

  async buildDebugReport(year: number, month: number): Promise<OperationalCadastroDebugReport> {
    const record = await this.scheduleRepo.findMonth(year, month);
    const employees = await this.scheduleRepo.listActiveEmployees();
    const nameById = new Map(employees.map((e) => [e.id, e.name]));

    const validItems = (await this.getOperationalCadastrosForMonth(year, month)).map((item) => ({
      ...item,
      valid: true,
      employeeName: nameById.get(item.employeeId),
    }));

    const ignored: OperationalCadastroDebugItem[] = [];
    for (const p of record?.preAllocations ?? []) {
      if (!isInvalidPreAllocationLabel(p.label)) continue;
      ignored.push({
        id: p.id,
        employeeId: p.employeeId,
        date: `${isoDateKey(p.date)}T12:00:00.000Z`,
        label: p.label,
        source: "pre_allocation",
        sourceId: p.id,
        priority: operationalLabelPriority(p.label),
        notes: p.notes,
        valid: false,
        ignoredReason: "Label inválido em preAllocations — use menu específico",
        employeeName: nameById.get(p.employeeId),
      });
    }

    for (const a of record?.assignments ?? []) {
      if (!a.label || !/VOO/i.test(a.label)) continue;
      ignored.push({
        id: a.id,
        employeeId: a.employeeId,
        date: `${isoDateKey(a.date)}T12:00:00.000Z`,
        label: a.label,
        source: "pre_allocation",
        sourceId: a.id,
        priority: operationalLabelPriority(a.label),
        valid: false,
        ignoredReason: "Assignment com label VOO sem flightAssignment correspondente",
        employeeName: nameById.get(a.employeeId),
        metadata: { assignmentSource: a.source },
      });
    }

    const totalsByLabel: Record<string, number> = {};
    for (const item of validItems) {
      totalsByLabel[item.label] = (totalsByLabel[item.label] ?? 0) + 1;
    }

    return {
      year,
      month,
      totalsByLabel,
      totalsIgnored: ignored.length,
      items: validItems,
      ignored,
    };
  }

  private async loadRaw(year: number, month: number): Promise<OperationalCadastroDisplay[]> {
    const record = await this.scheduleRepo.findMonth(year, month);
    const preAllocations = record?.preAllocations ?? [];

    const [vacationDays, approvedDayOffs, flightDays] = await Promise.all([
      this.calendarRepo.listVacationDaysForMonth(year, month),
      this.calendarRepo.listApprovedDayOffForMonth(year, month),
      this.calendarRepo.listFlightDaysForMonth(year, month),
    ]);

    return buildOperationalCadastroDisplay({
      vacationDays,
      approvedDayOffs,
      flightDays,
      preAllocations,
    });
  }

  private enrich(row: OperationalCadastroDisplay): OperationalCadastroCanonical {
    const sourceId = this.resolveSourceId(row);
    return {
      ...row,
      sourceId,
      priority: operationalLabelPriority(row.label),
      metadata: row.notes ? { notes: row.notes } : undefined,
    };
  }

  private resolveSourceId(row: OperationalCadastroDisplay): string {
    if (row.source === "pre_allocation") return row.id;
    const parts = row.id.split("-");
    return parts.length > 2 ? parts.slice(1).join("-") : row.id;
  }
}

export const operationalCadastroService = new OperationalCadastroService();
