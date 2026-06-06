import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";
import { buildContextFromDbParts } from "../../infrastructure/mappers/schedule-context.mapper.js";
import {
  evaluatePublishReadiness,
  mergeDbCriticalViolations,
} from "../../domain/schedule/schedule-publish-guard.js";
import type { ClassifiedViolation } from "../../domain/schedule/violation-level.js";
import {
  PublishBlockedCriticalViolationsError,
  ScheduleCannotPublishError,
  ScheduleMonthNotFoundError,
  type CriticalViolationDto,
} from "../errors/schedule.errors.js";

export interface PublishScheduleResult {
  scheduleMonthId: string;
  year: number;
  month: number;
  status: "PUBLISHED";
  warnings?: number;
}

function toDto(v: ClassifiedViolation): CriticalViolationDto {
  return {
    level: "CRITICAL",
    ruleCode: v.ruleCode,
    message: v.message,
    date: v.date,
    employee: v.employee,
    detail: v.detail,
  };
}

export class PublishScheduleUseCase {
  constructor(private readonly scheduleRepo = new ScheduleRepository()) {}

  async execute(scheduleMonthId: string): Promise<PublishScheduleResult> {
    const record = await this.scheduleRepo.findMonthById(scheduleMonthId);
    if (!record) {
      throw new ScheduleMonthNotFoundError(scheduleMonthId);
    }

    if (record.status === "PUBLISHED") {
      return {
        scheduleMonthId: record.id,
        year: record.year,
        month: record.month,
        status: "PUBLISHED",
      };
    }

    if (record.status !== "GENERATED" && record.status !== "DRAFT" && record.status !== "VALIDATING") {
      throw new ScheduleCannotPublishError(
        `Status ${record.status} não permite publicação. Gere a escala antes (GENERATED).`,
      );
    }

    const shifts = await this.scheduleRepo.listShifts(true);
    const employees = await this.scheduleRepo.listActiveEmployees();

    const ctx = buildContextFromDbParts({
      year: record.year,
      month: record.month,
      employees,
      shifts,
      assignments: record.assignments,
      preAllocations: record.preAllocations,
    });

    const evaluation = evaluatePublishReadiness(ctx);

    const nameById = new Map(record.assignments.map((a) => [a.employeeId, a.employee.name]));
    for (const p of record.preAllocations) {
      nameById.set(p.employeeId, p.employee.name);
    }

    const dbCritical = mergeDbCriticalViolations(
      record.ruleViolations.map((v) => ({
        severity: v.severity,
        ruleCode: v.ruleCode,
        message: v.message,
        date: v.date,
        employeeId: v.employeeId,
      })),
      nameById,
    );

    const allCritical = [...evaluation.criticalViolations];
    const seen = new Set(allCritical.map((c) => `${c.ruleCode}|${c.date}|${c.employee}`));
    for (const d of dbCritical) {
      const k = `${d.ruleCode}|${d.date}|${d.employee}`;
      if (!seen.has(k)) {
        allCritical.push(d);
        seen.add(k);
      }
    }

    if (allCritical.length > 0) {
      throw new PublishBlockedCriticalViolationsError(allCritical.map(toDto));
    }

    const published = await this.scheduleRepo.publishMonth(record.id);
    return {
      scheduleMonthId: published.id,
      year: published.year,
      month: published.month,
      status: "PUBLISHED",
      warnings: evaluation.warningViolations.length,
    };
  }
}

export const publishScheduleUseCase = new PublishScheduleUseCase();
