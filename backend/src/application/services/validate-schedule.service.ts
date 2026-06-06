import type { ScheduleContext } from "../../domain/schedule/types.js";
import { validateSchedule, filterBySeverity } from "../../domain/rules/engine.js";
import type { ValidationIssue } from "../../domain/schedule/types.js";

export interface ViolationDto {
  severity: string;
  ruleCode: string;
  message: string;
  date: string;
  employee: string;
  detail: string;
}

export interface ValidateScheduleSummary {
  total: number;
  critica: number;
  alta: number;
  media: number;
  baixa: number;
}

export interface ValidateScheduleResult {
  valid: boolean;
  violations: ViolationDto[];
  summary: ValidateScheduleSummary;
}

function issueToDto(issue: ValidationIssue): ViolationDto {
  return {
    severity: issue.severity,
    ruleCode: issue.type,
    message: issue.detail,
    date: issue.date,
    employee: issue.employee,
    detail: issue.detail,
  };
}

function buildSummary(issues: ValidationIssue[]): ValidateScheduleSummary {
  const summary: ValidateScheduleSummary = {
    total: issues.length,
    critica: 0,
    alta: 0,
    media: 0,
    baixa: 0,
  };
  for (const i of issues) {
    if (i.severity === "CRÍTICA") summary.critica++;
    else if (i.severity === "ALTA") summary.alta++;
    else if (i.severity === "MÉDIA") summary.media++;
    else summary.baixa++;
  }
  return summary;
}

/**
 * Valida escala exclusivamente via domínio (Fase 1). Não duplica regras.
 */
export class ValidateScheduleService {
  execute(ctx: ScheduleContext): ValidateScheduleResult {
    const issues = validateSchedule(ctx);
    const blocking = filterBySeverity(issues, ["ALTA", "CRÍTICA"]);
    return {
      valid: blocking.length === 0,
      violations: issues.map(issueToDto),
      summary: buildSummary(issues),
    };
  }
}

export const validateScheduleService = new ValidateScheduleService();
