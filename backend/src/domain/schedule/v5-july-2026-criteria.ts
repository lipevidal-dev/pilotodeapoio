import type { GenerationInput, GenerationResult } from "./generation-types.js";
import { GenerationWorkspace } from "./generation-workspace.js";
import { validateRateioMinimums } from "./enforce-minimum-turn-targets.js";
import {
  listInvalidV58WorkBlocks,
  validateNoIsolatedWorkShifts,
} from "./v5-work-block-quality.js";
import { countRateioTurns } from "./pao-rateio-shifts.js";
import { buildTurnPreferenceValidation } from "./preference-scoring.js";
import { assignmentKey } from "./types.js";

export interface V57July2026CriteriaResult {
  ok: boolean;
  failures: string[];
}

function findPao(ws: GenerationWorkspace, namePart: string) {
  return ws.paoEmps.find((e) =>
    e.employee.name.toLowerCase().includes(namePart.toLowerCase()),
  );
}

export function buildWorkspaceFromResult(input: GenerationInput, result: GenerationResult): GenerationWorkspace {
  const ws = new GenerationWorkspace(input);
  ws.applyHardBlocks();
  for (const a of result.assignments) {
    const did = ws.uuidToDomain.get(a.employeeUuid);
    if (did == null) continue;
    ws.planned.set(assignmentKey(did, a.date), a.shiftCode);
  }
  for (const al of result.allocations) {
    ws.allocations.push({ ...al });
  }
  ws.initRateioContext();
  ws.syncRateioContext();
  return ws;
}

/** Critérios fixos e2e julho/2026 — V5.7. */
export function assertV57July2026Criteria(
  input: GenerationInput,
  result: GenerationResult,
): V57July2026CriteriaResult {
  const failures: string[] = [];
  const ws = buildWorkspaceFromResult(input, result);
  const ctx = ws.ensureRateioContext();

  if (result.summary.coverageGaps !== 0) {
    failures.push(`gaps=${result.summary.coverageGaps} (esperado 0)`);
  }
  if (ws.listCoverageGaps().length !== 0) {
    failures.push(`listCoverageGaps=${ws.listCoverageGaps().length} (esperado 0)`);
  }

  for (const part of ["Lucas", "Gustavo", "Alexandre"] as const) {
    const emp = findPao(ws, part);
    if (!emp) {
      failures.push(`${part}: PAO não encontrado`);
      continue;
    }
    const turns = countRateioTurns(ws, emp.uuid);
    if (turns < 8) {
      failures.push(`${part}: ${turns}/8 turnos (esperado >= 8)`);
    }
  }

  const prefRows = buildTurnPreferenceValidation(ws, ctx);
  for (const part of ["Palombino", "Antonio"] as const) {
    const row = prefRows.find((r) => r.name.toLowerCase().includes(part.toLowerCase()));
    if (!row) {
      failures.push(`${part}: linha preferência ausente`);
      continue;
    }
    if (row.preferredShift !== "T8") {
      failures.push(`${part}: pref=${row.preferredShift ?? "null"} (esperado T8)`);
    } else if (row.attendancePercent !== 100) {
      failures.push(`${part} T8: ${row.attendancePercent}% (esperado 100%)`);
    }
  }

  if (ws.v5LockedPreferenceRemovalLog.length > 0) {
    failures.push(
      `locked removidos: ${ws.v5LockedPreferenceRemovalLog.map((r) => `${r.name}@${r.date}`).join(", ")}`,
    );
  }

  const rateioMin = validateRateioMinimums(ws);
  if (!rateioMin.ok) {
    failures.push(
      `validateRateioMinimums: ${rateioMin.issues.map((i) => `${i.name} ${i.current}/${i.min}`).join("; ")}`,
    );
  }
  if (rateioMin.issues.some((i) => i.hasValidTransfer)) {
    failures.push("validateRateioMinimums: transferência viável pendente");
  }

  const isolatedBlocks = listInvalidV58WorkBlocks(ws);
  if (isolatedBlocks.some((b) => (b.effectiveSize ?? b.size) === 1 && b.size === 1)) {
    failures.push(`blocos isolados (size=1): ${isolatedBlocks.filter((b) => b.size === 1).length}`);
  }
  if (isolatedBlocks.some((b) => (b.effectiveSize ?? b.size) < 3 && b.size === 2)) {
    failures.push(`blocos inválidos (size=2): ${isolatedBlocks.filter((b) => b.size === 2).length}`);
  }
  if (validateNoIsolatedWorkShifts(ws).length > 0) {
    failures.push(`validateNoIsolatedWorkShifts: ${validateNoIsolatedWorkShifts(ws).length} CRITICAL`);
  }

  return { ok: failures.length === 0, failures };
}
