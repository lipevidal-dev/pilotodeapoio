import type { RuleSeverity } from "@prisma/client";
import type { ValidationIssue } from "../../domain/schedule/types.js";
import {
  classifyIssue,
  type ViolationLevel,
} from "../../domain/schedule/violation-level.js";
import type { Employee } from "@prisma/client";

export interface ApiViolationDto {
  severity: ViolationLevel;
  ruleCode: string;
  message: string;
  date: string;
  employee: string;
  detail: string;
}

/** Normaliza severidade para API/UI (CRITICAL | WARNING | INFO). */
export function issueToApiViolation(issue: ValidationIssue): ApiViolationDto {
  const level = classifyIssue(issue);
  return {
    severity: level,
    ruleCode: issue.type,
    message: issue.detail,
    date: issue.date,
    employee: issue.employee,
    detail: issue.detail,
  };
}

export function dbViolationToApi(row: {
  severity: RuleSeverity;
  ruleCode: string;
  message: string;
  date: string | null;
  employee?: { name: string } | null;
}): ApiViolationDto {
  return {
    severity: row.severity as ViolationLevel,
    ruleCode: row.ruleCode,
    message: row.message,
    date: row.date ?? "",
    employee: row.employee?.name ?? "—",
    detail: row.message,
  };
}

function levelToPrisma(level: ReturnType<typeof classifyIssue>): RuleSeverity {
  return level;
}

export function validationIssuesToDb(
  issues: ValidationIssue[],
  employees: Employee[],
): Array<{
  severity: RuleSeverity;
  ruleCode: string;
  message: string;
  date?: string;
  employeeId?: string;
}> {
  const byName = new Map(employees.map((e) => [e.name, e.id]));

  return issues.map((i) => ({
    severity: levelToPrisma(classifyIssue(i)),
    ruleCode: i.type,
    message: i.detail,
    date: i.date || undefined,
    employeeId: i.employee && i.employee !== "-" ? byName.get(i.employee) : undefined,
  }));
}
