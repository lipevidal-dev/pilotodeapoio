import { normalizeOperationalLabel } from "../operational-labels.js";
import { generationToScheduleContext } from "../generation-context.js";
import { listPaoCoverageGaps, type PaoCoverageGap } from "../../rules/coverage.js";
import { PAO_COVERAGE_SHIFTS } from "../../rules/constants.js";
import { addDays, iterDays } from "../../rules/dates.js";
import type {
  GeneratedAllocation,
  GeneratedAssignment,
  GenerationInput,
} from "../generation-types.js";
import type { ValidationIssue } from "../types.js";
import { MOTOR_VERSION_NEXT } from "../engine-metadata.js";
import { isRateioTurnCode, type CleanEngineOptions, type CleanValidationResult } from "./clean-types.js";
import type { ScheduleContext } from "../types.js";

function issue(
  type: string,
  detail: string,
  employee = "",
  date = "",
  severity: ValidationIssue["severity"] = "ALTA",
): ValidationIssue {
  return {
    severity,
    level: severity === "CRÍTICA" ? "CRITICAL" : severity === "ALTA" ? "WARNING" : "INFO",
    type,
    date,
    employee,
    detail,
  };
}

export function validateAssignmentListNoNd(assignments: GeneratedAssignment[]): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const a of assignments) {
    if (a.shiftCode.toUpperCase() === "ND") {
      out.push(
        issue(
          "ND_AS_SHIFT",
          "ND deve estar em allocations, não em assignments",
          a.employeeUuid,
          a.date,
          "CRÍTICA",
        ),
      );
    }
  }
  return out;
}

export function validateAssignmentListDuplicates(
  assignments: GeneratedAssignment[],
): ValidationIssue[] {
  const seen = new Map<string, string>();
  const out: ValidationIssue[] = [];
  for (const a of assignments) {
    const key = `${a.employeeUuid}|${a.date}`;
    const prev = seen.get(key);
    if (prev != null) {
      out.push(
        issue(
          "DUPLICATE_ASSIGNMENT",
          `${prev} e ${a.shiftCode} no mesmo dia`,
          a.employeeUuid,
          a.date,
          "CRÍTICA",
        ),
      );
    } else {
      seen.set(key, a.shiftCode);
    }
  }
  return out;
}

export function validatePreAllocationsPreserved(
  input: GenerationInput,
  assignments: GeneratedAssignment[],
  allocations: GeneratedAllocation[],
): ValidationIssue[] {
  const byAssign = new Map(assignments.map((a) => [`${a.employeeUuid}|${a.date}`, a.shiftCode]));
  const byAlloc = new Map(
    allocations.map((a) => [
      `${a.employeeUuid}|${a.date}|${normalizeOperationalLabel(a.label).toUpperCase()}`,
      a.label,
    ]),
  );
  const out: ValidationIssue[] = [];
  for (const lock of input.lockedAllocations) {
    const label = normalizeOperationalLabel(lock.label).toUpperCase();
    const key = `${lock.employeeUuid}|${lock.date}`;
    if (isRateioTurnCode(label)) {
      const shift = byAssign.get(key)?.toUpperCase();
      if (shift !== label) {
        out.push(
          issue(
            "PREALLOC_SHIFT_MISSING",
            `esperado ${label}, encontrado ${shift ?? "vazio"}`,
            lock.employeeUuid,
            lock.date,
            "CRÍTICA",
          ),
        );
      }
    } else {
      const allocKey = `${lock.employeeUuid}|${lock.date}|${label}`;
      if (!byAlloc.has(allocKey)) {
        out.push(
          issue(
            "PREALLOC_ALLOC_MISSING",
            `esperado ${label}, não encontrado na geração`,
            lock.employeeUuid,
            lock.date,
            "CRÍTICA",
          ),
        );
      }
    }
  }
  return out;
}

export function validateT8NdStructure(
  _input: GenerationInput,
  assignments: GeneratedAssignment[],
  allocations: GeneratedAllocation[],
): ValidationIssue[] {
  const byEmpDay = new Map<string, string>();
  for (const a of assignments) {
    byEmpDay.set(`${a.employeeUuid}|${a.date}`, a.shiftCode.toUpperCase());
  }
  const ndDays = new Set(
    allocations
      .filter((a) => normalizeOperationalLabel(a.label).toUpperCase() === "ND")
      .map((a) => `${a.employeeUuid}|${a.date}`),
  );

  const out: ValidationIssue[] = [];
  const days = new Set(assignments.map((a) => a.date));
  for (const a of assignments) {
    if (a.shiftCode.toUpperCase() !== "T8") continue;
    const prev = addDays(a.date, -1);
    const prevShift = byEmpDay.get(`${a.employeeUuid}|${prev}`);
    if (prevShift !== "T8") continue;
    const ndDate = addDays(a.date, 1);
    if (!days.has(ndDate) && !ndDays.has(`${a.employeeUuid}|${ndDate}`)) {
      const [y, m] = a.date.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      if (Number(a.date.split("-")[2]) < lastDay) {
        out.push(
          issue(
            "T8_WITHOUT_ND",
            `par T8/T8 em ${prev}–${a.date} sem ND em ${ndDate}`,
            a.employeeUuid,
            ndDate,
            "CRÍTICA",
          ),
        );
      }
    } else if (!ndDays.has(`${a.employeeUuid}|${ndDate}`)) {
      out.push(
        issue(
          "T8_WITHOUT_ND",
          `par T8/T8 em ${prev}–${a.date} sem ND em ${ndDate}`,
          a.employeeUuid,
          ndDate,
          "CRÍTICA",
        ),
      );
    }
  }
  return out;
}

function finalize(stage: string, issues: ValidationIssue[]): CleanValidationResult {
  const criticalCount = issues.filter(
    (i) => i.severity === "CRÍTICA" || i.level === "CRITICAL",
  ).length;
  return { stage, issues, criticalCount };
}

function resolveCoverageShiftCodes(options?: CleanEngineOptions): string[] {
  if (options?.coverageShiftCodes && options.coverageShiftCodes.length > 0) {
    return options.coverageShiftCodes.map((c) => c.toUpperCase());
  }
  return [...PAO_COVERAGE_SHIFTS];
}

function listEngineCoverageGaps(
  ctx: ScheduleContext,
  options?: CleanEngineOptions,
): PaoCoverageGap[] {
  const shiftCodes = resolveCoverageShiftCodes(options);
  if (
    shiftCodes.length === PAO_COVERAGE_SHIFTS.length &&
    shiftCodes.every((c, i) => c === PAO_COVERAGE_SHIFTS[i])
  ) {
    return listPaoCoverageGaps(ctx);
  }

  const gaps: PaoCoverageGap[] = [];
  const roleMap = new Map(ctx.employees.map((e) => [e.id, e.role]));
  for (const day of iterDays(ctx.year, ctx.month)) {
    for (const shiftCode of shiftCodes) {
      const hasPao = ctx.assignments.some(
        (a) =>
          a.workDate === day &&
          a.shiftCode.toUpperCase() === shiftCode &&
          roleMap.get(a.employeeId) === "PAO",
      );
      if (!hasPao) {
        gaps.push({ date: day, shiftCode });
      }
    }
  }
  return gaps;
}

/** Issues que impedem persistir a geração (motor NEXT tolera furos de cobertura). */
export function filterPersistenceBlockingIssues(
  issues: ValidationIssue[],
  options?: CleanEngineOptions,
): ValidationIssue[] {
  const isNextMotor = options?.motorVersion === MOTOR_VERSION_NEXT;
  return issues.filter((item) => {
    if (item.severity !== "CRÍTICA" && item.level !== "CRITICAL") return false;
    if (isNextMotor && item.type === "COVERAGE_GAP") return false;
    return true;
  });
}

export function validateCleanGeneration(
  input: GenerationInput,
  assignments: GeneratedAssignment[],
  allocations: GeneratedAllocation[],
  options?: CleanEngineOptions,
): CleanValidationResult {
  const listIssues = [
    ...validateAssignmentListNoNd(assignments),
    ...validateAssignmentListDuplicates(assignments),
    ...validatePreAllocationsPreserved(input, assignments, allocations),
  ];

  if (!options?.enabledRules || options.enabledRules.t8_t8_nd !== false) {
    listIssues.push(...validateT8NdStructure(input, assignments, allocations));
  }

  const ctx = generationToScheduleContext(input, assignments, allocations);
  const coverageIssues = listEngineCoverageGaps(ctx, options).map((g) =>
    issue("COVERAGE_GAP", `furo ${g.shiftCode}`, "", g.date, "CRÍTICA"),
  );

  return finalize("BEFORE_SAVE", [...listIssues, ...coverageIssues]);
}

/** Valida resultado completo antes de persistir (use-case). */
export function validateCleanGenerationBeforeSave(
  input: GenerationInput,
  result: { assignments: GeneratedAssignment[]; allocations: GeneratedAllocation[] },
  options?: CleanEngineOptions,
): CleanValidationResult {
  return validateCleanGeneration(input, result.assignments, result.allocations, options);
}
