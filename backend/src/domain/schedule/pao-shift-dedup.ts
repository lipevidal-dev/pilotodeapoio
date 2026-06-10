import { PAO_COVERAGE_SHIFTS } from "../rules/constants.js";
import type { GenerationWorkspace } from "./generation-workspace.js";

/** Remove PAOs extras no mesmo turno/dia — mantém o de maior senioridade (menor número). */
export function deduplicatePaoShiftCoverage(ws: GenerationWorkspace): number {
  let removed = 0;
  const byCell = new Map(
    ws.toAssignments().map((a) => [`${a.employeeUuid}|${a.date}`, a.shiftCode] as const),
  );
  for (const day of ws.days) {
    for (const code of PAO_COVERAGE_SHIFTS) {
      const onShift: Array<{ uuid: string; seniority: number; name: string }> = [];
      for (const c of ws.paoEmps) {
        if (byCell.get(`${c.uuid}|${day}`) === code) {
          onShift.push({
            uuid: c.uuid,
            seniority: c.employee.seniority,
            name: c.employee.name,
          });
        }
      }
      if (onShift.length <= 1) continue;
      onShift.sort(
        (a, b) => a.seniority - b.seniority || a.name.localeCompare(b.name, "pt-BR"),
      );
      for (let i = 1; i < onShift.length; i++) {
        if (ws.unassignShift(onShift[i]!.uuid, day)) {
          removed++;
          byCell.delete(`${onShift[i]!.uuid}|${day}`);
        }
      }
    }
  }
  return removed;
}
