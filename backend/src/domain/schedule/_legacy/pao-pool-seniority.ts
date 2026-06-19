import type { GenerationInputEmployee } from "../generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";

/** Senioridade relativa ao pool PAO ativo (APAO excluído). */
export interface PaoPoolSeniorityInfo {
  employeeUuid: string;
  /** Número cadastrado no funcionário (pode coincidir com APAO — não usar sozinho). */
  cadastralSeniority: number;
  /** 1 = mais antigo no pool PAO; N = mais novo. */
  poolRank: number;
  poolSize: number;
}

/** PAO elegível no pool do motor PAO (exclui APAO). */
export function isPaoPoolMember(ws: GenerationWorkspace, uuid: string): boolean {
  return ws.paoEmps.some((c) => c.uuid === uuid);
}

/** Desempate entre PAOs — menor cadastral = mais antigo; APAO não entra. */
export function comparePaoPoolSeniority(
  a: GenerationInputEmployee,
  b: GenerationInputEmployee,
): number {
  if (a.employee.seniority !== b.employee.seniority) {
    return a.employee.seniority - b.employee.seniority;
  }
  return a.uuid.localeCompare(b.uuid);
}

/** PAOs do pool atual, mais antigo primeiro. */
export function sortPaoByPoolSeniority(ws: GenerationWorkspace): GenerationInputEmployee[] {
  return [...ws.paoEmps].sort(comparePaoPoolSeniority);
}

/** Índice poolRank/poolSize por PAO — somente `ws.paoEmps`. */
export function buildPaoPoolSeniorityIndex(
  ws: GenerationWorkspace,
): Map<string, PaoPoolSeniorityInfo> {
  const sorted = sortPaoByPoolSeniority(ws);
  const out = new Map<string, PaoPoolSeniorityInfo>();
  const poolSize = sorted.length;
  for (let i = 0; i < poolSize; i++) {
    const c = sorted[i]!;
    out.set(c.uuid, {
      employeeUuid: c.uuid,
      cadastralSeniority: c.employee.seniority,
      poolRank: i + 1,
      poolSize,
    });
  }
  return out;
}

export function getPaoPoolSeniority(
  ws: GenerationWorkspace,
  uuid: string,
  index?: Map<string, PaoPoolSeniorityInfo>,
): PaoPoolSeniorityInfo | undefined {
  return (index ?? buildPaoPoolSeniorityIndex(ws)).get(uuid);
}

export function formatPaoPoolSeniority(info: PaoPoolSeniorityInfo | undefined): string {
  if (!info) return "sen ? | pool ?/?";
  return `sen ${info.cadastralSeniority} | pool ${info.poolRank}/${info.poolSize}`;
}

export function comparePaoPoolRank(
  index: Map<string, PaoPoolSeniorityInfo>,
  aUuid: string,
  bUuid: string,
): number {
  const rankA = index.get(aUuid)?.poolRank ?? Number.MAX_SAFE_INTEGER;
  const rankB = index.get(bUuid)?.poolRank ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;
  return aUuid.localeCompare(bUuid);
}
