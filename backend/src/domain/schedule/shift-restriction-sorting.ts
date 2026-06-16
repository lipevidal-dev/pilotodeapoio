import type { ShiftCode } from "./assignment-eligibility.js";
import type { GenerationInputEmployee } from "./generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { comparePaoPoolSeniority, isPaoPoolMember } from "./pao-pool-seniority.js";

/** PAO tem restrição permanente para o turno (não alocar). */
export function isEmployeeShiftRestricted(
  ws: GenerationWorkspace,
  uuid: string,
  shiftCode: string,
): boolean {
  const did = ws.uuidToDomain.get(uuid);
  if (!did) return false;
  const restricted = ws.input.shiftRestrictions?.get(did);
  return restricted?.has(shiftCode.toUpperCase()) ?? false;
}

/**
 * Reordena candidatos para quebra de restrição por senioridade inversa:
 * - sem restrição para o turno vem antes;
 * - com restrição vem depois, do mais novo (maior seniority) para o mais antigo.
 * Preserva a ordem relativa dentro de cada grupo.
 */
export function sortCandidatesForRestrictedShiftBreak(
  ws: GenerationWorkspace,
  candidates: readonly GenerationInputEmployee[],
  shiftCode: ShiftCode | string,
): GenerationInputEmployee[] {
  const code = shiftCode.toUpperCase();
  const paoCandidates = candidates.filter((c) => isPaoPoolMember(ws, c.uuid));
  const unrestricted: GenerationInputEmployee[] = [];
  const restricted: GenerationInputEmployee[] = [];

  for (const c of paoCandidates) {
    if (isEmployeeShiftRestricted(ws, c.uuid, code)) {
      restricted.push(c);
    } else {
      unrestricted.push(c);
    }
  }

  restricted.sort((a, b) => {
    if (a.employee.seniority !== b.employee.seniority) {
      return comparePaoPoolSeniority(b, a);
    }
    return a.uuid.localeCompare(b.uuid);
  });

  return [...unrestricted, ...restricted];
}
