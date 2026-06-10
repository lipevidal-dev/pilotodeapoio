import type { ValidationIssue } from "./types.js";

export type ViolationLevel = "CRITICAL" | "WARNING" | "INFO";

export interface ClassifiedViolation {
  level: ViolationLevel;
  ruleCode: string;
  message: string;
  date: string;
  employee: string;
  detail: string;
}

const CRITICAL_RULE_CODES = new Set([
  "COVERAGE_MISSING_T6",
  "COVERAGE_MISSING_T7",
  "COVERAGE_MISSING_T8",
  "FURO COBERTURA PAO",
  "COBERTURA PAO INCOMPLETA",
  "APAO SEM PAO",
  "SEM APAO DISPONÍVEL",
  "FA APAO DUPLICADA",
  "TRABALHO EM FÉRIAS",
  "TRABALHO EM DIA BLOQUEADO",
  "MAIS DE 2 SIMULTÂNEOS",
  "DESCANSO MENOR QUE 12H",
  "T8 SEM ND",
  "T8 ISOLADO",
  "TURNO NÃO PERMITIDO PARA PAO",
  "TURNO APAO COBERTO POR PAO REGULAR",
  "ND FORA DE T8/T8",
  "TURNO EM DIA ND",
]);

const WARNING_RULE_CODES = new Set([
  "MAIS DE 6 DIAS",
  "APAO SEM FOLGA 6x1",
  "MONOFOLGA",
  "FOLGAS PEDIDAS",
  "SEM FOLGA SOCIAL",
  "FOLGAS PAO",
  "RESTRIÇÃO VOO MÊS INTEIRO",
]);

const INFO_RULE_CODES = new Set(["DISPONÍVEL PARA VOO"]);

export function coverageRuleCode(shiftCode: string): string {
  if (shiftCode === "T6") return "COVERAGE_MISSING_T6";
  if (shiftCode === "T7") return "COVERAGE_MISSING_T7";
  return "COVERAGE_MISSING_T8";
}

export function classifyIssue(issue: ValidationIssue): ViolationLevel {
  if (issue.level) return issue.level;

  const code = issue.type.toUpperCase();
  if (CRITICAL_RULE_CODES.has(issue.type) || CRITICAL_RULE_CODES.has(code)) {
    if (issue.type === "TRABALHO EM DIA BLOQUEADO") {
      const d = issue.detail.toUpperCase();
      if (
        d.includes("FÉRIAS") ||
        d.includes("FERIAS") ||
        d.includes("FOLGA PEDIDA") ||
        d.includes("FOLGA ESCOLHIDA")
      ) {
        return "CRITICAL";
      }
      return "WARNING";
    }
    return "CRITICAL";
  }

  if (WARNING_RULE_CODES.has(issue.type)) return "WARNING";
  if (INFO_RULE_CODES.has(issue.type)) return "INFO";

  if (issue.type === "FOLGAS PAO") {
    return issue.level ?? "WARNING";
  }

  if (issue.severity === "CRÍTICA" || issue.severity === "ALTA") return "CRITICAL";
  if (issue.severity === "MÉDIA") return "WARNING";
  return "INFO";
}

export function classifyIssueFull(issue: ValidationIssue): ClassifiedViolation {
  return {
    level: classifyIssue(issue),
    ruleCode: issue.type,
    message: issue.detail,
    date: issue.date,
    employee: issue.employee,
    detail: issue.detail,
  };
}

export function filterByLevel(
  issues: ValidationIssue[],
  levels: ViolationLevel[],
): ClassifiedViolation[] {
  const set = new Set(levels);
  return issues.map(classifyIssueFull).filter((i) => set.has(i.level));
}

export function hasCriticalViolations(issues: ValidationIssue[]): boolean {
  return issues.some((i) => classifyIssue(i) === "CRITICAL");
}
