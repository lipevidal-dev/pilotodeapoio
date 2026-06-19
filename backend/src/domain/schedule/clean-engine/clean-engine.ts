import type { GenerationInput, GenerationResult, GenerationSummary } from "../generation-types.js";
import type { ValidationIssue } from "../types.js";
import { generationToScheduleContext } from "../generation-context.js";
import { listPaoCoverageGaps } from "../../rules/coverage.js";
import { ENGINE_PATH_CLEAN, MOTOR_VERSION_CLEAN, MOTOR_VERSION_NEXT } from "../engine-metadata.js";
import { CleanWorkspace } from "./clean-workspace.js";
import type { CleanEngineOptions } from "./clean-types.js";
import { validateCleanGeneration } from "./clean-validator.js";
import { applyFcfRules } from "./clean-fcf.js";
import { fillPreferredShifts } from "./clean-preferences.js";
import {
  fillT8CoverageGaps,
  fillT8PreferredBlocks,
  removeIsolatedT8ForPreferredPaos,
} from "./clean-t8-blocks.js";
import { motorRuleEnabled } from "./clean-motor-rules.js";
import {
  enforceMonthStartSixByOneFromPrevious,
  finalizeCrossMonthContinuations,
} from "./clean-cross-month-continuity.js";

function ruleEnabled(options: CleanEngineOptions, ruleId: string): boolean {
  return motorRuleEnabled(options, ruleId);
}

function hasCoverageRules(options: CleanEngineOptions): boolean {
  if (!options.enabledRules) return true;
  return (
    options.enabledRules.coverage_t6 !== false ||
    options.enabledRules.coverage_t7 !== false ||
    options.enabledRules.coverage_t8 !== false ||
    options.enabledRules.coverage_t9 !== false
  );
}

function buildViolationsFromGaps(
  gaps: Array<{ date: string; shiftCode: string }>,
): ValidationIssue[] {
  return gaps.map((g) => ({
    severity: "CRÍTICA" as const,
    level: "CRITICAL" as const,
    type: "COVERAGE_GAP",
    date: g.date,
    employee: "",
    detail: `Sem PAO em ${g.shiftCode} — cadastre mais funcionários ou ajuste restrições`,
  }));
}

function buildSummary(
  ws: CleanWorkspace,
  violations: ValidationIssue[],
  generationMs: number,
  options: CleanEngineOptions = {},
): GenerationSummary {
  const assignments = ws.toAssignments();
  const allocations = ws.toAllocations();
  const gaps = ws.listCoverageGaps();
  const paoUuids = new Set(ws.paoEmployees.map((e) => e.uuid));
  const usedPaos = new Set(assignments.map((a) => a.employeeUuid).filter((u) => paoUuids.has(u)));

  const folgasPerPao: Record<string, number> = {};
  for (const p of ws.paoEmployees) {
    folgasPerPao[p.employee.name] = allocations.filter(
      (a) =>
        a.employeeUuid === p.uuid &&
        ["FOLGA", "FOLGA SOCIAL", "ND"].includes(a.label.toUpperCase()),
    ).length;
  }

  const criticalCount = violations.filter(
    (v) => v.severity === "CRÍTICA" || v.level === "CRITICAL",
  ).length;

  return {
    totalAssignments: assignments.length,
    totalAllocations: allocations.length,
    paoCount: ws.paoEmployees.length,
    apaoCount: ws.input.employees.length - ws.paoEmployees.length,
    folgasPerPao,
    coverageGaps: gaps.length,
    blockingViolations: criticalCount,
    criticalViolations: criticalCount,
    totalViolations: violations.length,
    valid: gaps.length === 0 && criticalCount === 0,
    criticalCount,
    coverageMissingCount: gaps.length,
    employeesUsed: usedPaos.size,
    paosUsed: usedPaos.size,
    daysInMonth: ws.days.length,
    generatedAt: new Date().toISOString(),
    generationMs,
    motorVersion: options.motorVersion ?? MOTOR_VERSION_CLEAN,
    enginePath: ENGINE_PATH_CLEAN,
    realEngineExecuted: true,
    realMotorReport: {
      auditEntries: ws.audit.all().length,
      coverageFailures: ws.audit.coverageFailures().length,
      stepNotes: ws.audit.all().slice(-20).map((e) => `[${e.phase}] ${e.kind}: ${e.reason}`),
    },
  };
}

export function generateCleanSchedule(
  input: GenerationInput,
  options: CleanEngineOptions = {},
): GenerationResult {
  const started = Date.now();
  const ws = new CleanWorkspace(input, options);

  if (ws.paoEmployees.length === 0) {
    const violations: ValidationIssue[] = [
      {
        severity: "CRÍTICA",
        level: "CRITICAL",
        type: "NO_PAO_REGISTERED",
        date: "",
        employee: "",
        detail: "Nenhum PAO cadastrado — o motor só lê funcionários existentes",
      },
    ];
    return {
      assignments: [],
      allocations: [],
      crossMonthPreAllocations: [],
      violations,
      summary: buildSummary(ws, violations, Date.now() - started, options),
      success: false,
      suggestions: ["Cadastre ao menos um PAO ativo antes de gerar a escala."],
    };
  }

  if (input.shifts.length === 0) {
    const violations: ValidationIssue[] = [
      {
        severity: "CRÍTICA",
        level: "CRITICAL",
        type: "NO_SHIFTS_REGISTERED",
        date: "",
        employee: "",
        detail: "Nenhum turno cadastrado — o motor não cria turnos",
      },
    ];
    return {
      assignments: [],
      allocations: [],
      crossMonthPreAllocations: [],
      violations,
      summary: buildSummary(ws, violations, Date.now() - started, options),
      success: false,
      suggestions: ["Cadastre turnos T6, T7 e T8 antes de gerar."],
    };
  }

  if (ruleEnabled(options, "calendar_blocks")) {
    ws.applyCalendarBlocks();
  }
  if (ruleEnabled(options, "locked_preallocations")) {
    ws.applyLockedPreAllocations();
  }
  if (ruleEnabled(options, "max_6_consecutive")) {
    enforceMonthStartSixByOneFromPrevious(ws);
  }
  const fcfWarnings = ruleEnabled(options, "fcf_weekday_shift") ? applyFcfRules(ws) : [];
  if (options.motorVersion === MOTOR_VERSION_NEXT) {
    if (
      ruleEnabled(options, "preferred_shifts") ||
      ruleEnabled(options, "pao_meta_turnos") ||
      ruleEnabled(options, "pao_espacamento_turnos")
    ) {
      fillPreferredShifts(ws);
    }
    if (ruleEnabled(options, "preferred_shifts") || ruleEnabled(options, "t8_t8_nd")) {
      fillT8PreferredBlocks(ws);
    }
  }
  if (hasCoverageRules(options)) {
    ws.fillCoverageGaps();
    if (options.motorVersion === MOTOR_VERSION_NEXT) {
      fillT8CoverageGaps(ws);
      removeIsolatedT8ForPreferredPaos(ws);
    }
  }
  if (ruleEnabled(options, "t8_t8_nd")) {
    ws.applyT8NdRule();
  }
  finalizeCrossMonthContinuations(ws);

  const assignments = ws.toAssignments();
  const allocations = ws.toAllocations();
  const gaps = ws.listCoverageGaps();
  const gapViolations = buildViolationsFromGaps(gaps);

  const ctx = generationToScheduleContext(input, assignments, allocations);
  const ruleGaps = listPaoCoverageGaps(ctx);
  for (const g of ruleGaps) {
    if (!gapViolations.some((v) => v.date === g.date && v.detail.includes(g.shiftCode))) {
      gapViolations.push({
        severity: "CRÍTICA",
        level: "CRITICAL",
        type: "COVERAGE_GAP",
        date: g.date,
        employee: "",
        detail: `Sem PAO em ${g.shiftCode}`,
      });
    }
  }

  const saveValidation = validateCleanGeneration(input, assignments, allocations);
  const violations = [...gapViolations, ...fcfWarnings, ...saveValidation.issues];
  const generationMs = Date.now() - started;
  const summary = buildSummary(ws, violations, generationMs, options);

  const suggestions: string[] = [];
  if (gaps.length > 0) {
    suggestions.push(
      `${gaps.length} furo(s) de cobertura — revise restrições, folgas ou quantidade de PAOs.`,
    );
  }
  if (ws.audit.countByKind("T8_ND_BLOCKED") > 0) {
    suggestions.push("Alguns ND após T8/T8 não puderam ser aplicados — ver auditoria.");
  }

  return {
    assignments,
    allocations,
    crossMonthPreAllocations: [...ws.crossMonthPreAllocations],
    violations,
    summary,
    success: gaps.length === 0 && saveValidation.criticalCount === 0,
    suggestions,
  };
}

export function cleanResultToGenerationResult(result: GenerationResult): GenerationResult {
  return result;
}
