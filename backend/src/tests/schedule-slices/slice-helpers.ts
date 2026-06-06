import { GenerationWorkspace } from "../../domain/schedule/generation-workspace.js";
import { generationToScheduleContext } from "../../domain/schedule/generation-context.js";
import { validateSchedule } from "../../domain/rules/engine.js";
import { runFinalCoverageGate } from "../../domain/rules/coverage-gate.js";
import { classifyIssue } from "../../domain/schedule/violation-level.js";
import type { GenerationInput } from "../../domain/schedule/generation-types.js";
import { baseGenerationInput, minimalPaoInput } from "../generation-fixtures.js";
import { realisticGenerationInput } from "../realistic-fixtures.js";
export const SLICE_YEAR = 2026;
export const SLICE_MONTH = 6;
export const SLOW_SLICE_MS = 120_000;

/** UUID padrão dos fixtures minimal (uuid-1, uuid-2, …). */
export function paoUuid(index = 0): string {
  return `uuid-${index + 1}`;
}

/** UUID padrão dos fixtures realistic (real-1, real-2, …). */
export function realPaoUuid(index = 0): string {
  return `real-${index + 1}`;
}

export function realApaoUuid(index = 0): string {
  return `real-${7 + index}`;
}

export function freshWorkspace(input: GenerationInput): GenerationWorkspace {
  return new GenerationWorkspace(input);
}

export function ctxFromWorkspace(ws: GenerationWorkspace) {
  return ws.toScheduleContext();
}

export function validateWorkspace(ws: GenerationWorkspace) {
  const ctx = ctxFromWorkspace(ws);
  return {
    ctx,
    issues: validateSchedule(ctx),
    gate: runFinalCoverageGate(ctx),
  };
}

export function criticalTypes(issues: ReturnType<typeof validateSchedule>): string[] {
  return issues.filter((i) => classifyIssue(i) === "CRITICAL").map((i) => i.type);
}

export function allocationLabels(ws: GenerationWorkspace, uuid: string, day: string): string[] {
  return ws.allocations
    .filter((a) => a.employeeUuid === uuid && a.date === day)
    .map((a) => a.label);
}

export function hasAssignment(ws: GenerationWorkspace, uuid: string, day: string): boolean {
  return ws.toAssignments().some((a) => a.employeeUuid === uuid && a.date === day);
}

export { baseGenerationInput, minimalPaoInput, realisticGenerationInput, generationToScheduleContext };
