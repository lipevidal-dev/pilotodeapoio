import { listPaoCoverageGaps } from "../../rules/coverage.js";
import { IDEAL_PAO_REST_COUNT, MAX_PAO_REST_COUNT } from "../../rules/constants.js";
import { iterDays } from "../../rules/dates.js";
import { filterByLevel, type ClassifiedViolation } from "../violation-level.js";
import type { GenerationInput } from "../generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { ValidationIssue } from "../types.js";
import type { RepairResult } from "./schedule-repair-engine.js";

export interface GenerationInsights {
  impossibleScenario: boolean;
  mainBlockingReasons: string[];
  suggestions: string[];
}

function countPaoDaysBlocked(input: GenerationInput, uuid: string): number {
  const keys = new Set<string>();
  for (const v of input.vacationDays) {
    if (v.employeeUuid === uuid) keys.add(v.date);
  }
  for (const fp of input.approvedDayOff) {
    if (fp.employeeUuid === uuid) keys.add(fp.date);
  }
  for (const la of input.lockedAllocations) {
    if (la.employeeUuid === uuid) keys.add(la.date);
  }
  for (const f of input.flightDays) {
    if (f.employeeUuid === uuid) keys.add(f.date);
  }
  return keys.size;
}

/** Estima se o mês é inviável com a equipe/bloqueios atuais (heurística conservadora). */
export function detectImpossibleScenario(
  ws: GenerationWorkspace,
  violations: ValidationIssue[],
  coverageMissingCount: number,
): boolean {
  const paoCount = ws.paoEmps.length;

  if (coverageMissingCount === 0) {
    const critical = filterByLevel(violations, ["CRITICAL"]);
    if (paoCount <= 4 && critical.length > 0) return true;
    return false;
  }

  if (paoCount <= 1) return true;

  const monthDays = iterDays(ws.input.year, ws.input.month).length;
  let heavyBlocked = 0;
  for (const p of ws.paoEmps) {
    const blocked = countPaoDaysBlocked(ws.input, p.uuid);
    if (blocked > monthDays * 0.45) heavyBlocked++;
  }

  if (paoCount <= 4 && coverageMissingCount >= 3) return true;
  if (heavyBlocked >= paoCount - 1) return true;
  if (paoCount <= 5 && coverageMissingCount >= monthDays * 0.15) return true;
  if (coverageMissingCount > 0 && paoCount < 5) return true;

  const critical = filterByLevel(violations, ["CRITICAL"]);
  if (critical.some((c) => c.ruleCode.startsWith("COVERAGE_MISSING"))) return true;

  return false;
}

export function buildMainBlockingReasons(
  violations: ValidationIssue[],
  coverageMissingCount: number,
  repairRemainingGaps: number,
): string[] {
  const reasons: string[] = [];
  const critical = filterByLevel(violations, ["CRITICAL"]);

  const byCode = new Map<string, number>();
  for (const c of critical) {
    byCode.set(c.ruleCode, (byCode.get(c.ruleCode) ?? 0) + 1);
  }

  const sorted = [...byCode.entries()].sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sorted.slice(0, 6)) {
    reasons.push(`${code} (${count} ocorrência${count > 1 ? "s" : ""})`);
  }

  if (coverageMissingCount > 0) {
    reasons.push(
      `Cobertura PAO incompleta: ${coverageMissingCount} furo(s) T6/T7/T8 após geração e reparo.`,
    );
  }
  if (repairRemainingGaps > 0 && !reasons.some((r) => r.includes("Cobertura"))) {
    reasons.push(`${repairRemainingGaps} furo(s) não reparados pelo motor.`);
  }

  const folgas = critical.filter((c) => c.ruleCode === "FOLGAS PAO");
  if (folgas.length > 0) {
    reasons.push("Folgas PAO fora da regra (ideal 10, permitido até 11 por mês).");
  }

  const t8 = critical.filter((c) => c.ruleCode === "T8 ISOLADO" || c.ruleCode === "T8 SEM ND");
  if (t8.length > 0) {
    reasons.push("Blocos T8/T8/ND inválidos ou incompletos.");
  }

  return [...new Set(reasons)].slice(0, 8);
}

function summarizeCriticalSamples(critical: ClassifiedViolation[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of critical) {
    const key = `${c.ruleCode}|${c.employee}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${c.ruleCode}: ${c.employee} — ${c.detail}`);
    if (out.length >= 5) break;
  }
  return out;
}

export function buildGenerationInsights(
  ws: GenerationWorkspace,
  violations: ValidationIssue[],
  repair: RepairResult,
  extraSuggestions: string[],
): GenerationInsights {
  const gaps = listPaoCoverageGaps(ws.toScheduleContext());
  const coverageMissingCount = gaps.length;
  const critical = filterByLevel(violations, ["CRITICAL"]);
  const impossibleScenario = detectImpossibleScenario(ws, violations, coverageMissingCount);

  const mainBlockingReasons = buildMainBlockingReasons(
    violations,
    coverageMissingCount,
    repair.remainingGaps,
  );

  const suggestions: string[] = [...extraSuggestions, ...repair.suggestions];

  if (impossibleScenario) {
    suggestions.unshift(
      "Cenário provavelmente inviável com a equipe e bloqueios atuais — aumente PAOs disponíveis ou reduza férias/FP/pré-alocações.",
    );
  } else if (critical.length > 0) {
    suggestions.unshift(
      "Ajuste heurístico insuficiente — revise bloqueios e distribuição de folgas/T8 antes de publicar.",
    );
  }

  if (coverageMissingCount > 0) {
    const sample = gaps.slice(0, 4).map((g) => `${g.shiftCode} em ${g.date}`);
    suggestions.push(
      `Furos de cobertura (${coverageMissingCount}): ${sample.join("; ")}${gaps.length > 4 ? "…" : ""}.`,
    );
  }

  suggestions.push(...summarizeCriticalSamples(critical));

  for (const c of ws.paoEmps) {
    const n = ws.countRest(c.uuid);
    if (n < IDEAL_PAO_REST_COUNT) {
      suggestions.push(
        `${c.employee.name}: apenas ${n}/${IDEAL_PAO_REST_COUNT} folgas — falta reservar dias livres.`,
      );
    } else if (n === MAX_PAO_REST_COUNT) {
      suggestions.push(`${c.employee.name}: PAO com 11 folgas por ajuste operacional.`);
    }
  }

  const unique = [...new Set(suggestions)].filter(Boolean);

  return {
    impossibleScenario,
    mainBlockingReasons,
    suggestions: unique,
  };
}
