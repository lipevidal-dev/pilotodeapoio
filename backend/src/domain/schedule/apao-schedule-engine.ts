import { validateSchedule } from "../rules/engine.js";
import { GenerationWorkspace } from "./generation-workspace.js";
import type { GeneratedAllocation, GeneratedAssignment } from "./generation-types.js";

export interface ApaoMotorReport {
  assignmentsCreated: number;
  folgaAgrupadaPairs: number;
  stepNotes: string[];
}

export class ApaoScheduleEngine {
  execute(ws: GenerationWorkspace): ApaoMotorReport {
    ws.apaoMotorEnabled = true;
    const stepNotes: string[] = [];
    stepNotes.push(`[APAO] ${ws.apaoEmps.length} APAO(s) — respeita FP, 1 FA e regime 6x1.`);

    ws.planApaoFolgaAgrupada();
    const faBefore = ws.allocations.filter((a) => a.label === "FOLGA AGRUPADA").length;

    ws.assignApaoWithPao();
    ws.allocateApaoRestDays();
    ws.enforceApaoSixByOne();
    ws.completeApaoAgenda();
    ws.enforceApaoSixByOne();

    const faAfter = ws.allocations.filter((a) => a.label === "FOLGA AGRUPADA").length;
    const apaoAssignments = this.apaoAssignments(ws);
    stepNotes.push(
      `[APAO] Turnos APAO: ${apaoAssignments.length}; FA: ${faAfter} dia(s) (${Math.floor(faAfter / 2)} par(es)).`,
    );
    if (faAfter < faBefore) {
      stepNotes.push("[APAO] Aviso: FA reduzida após balanceamento 6x1.");
    }

    return {
      assignmentsCreated: apaoAssignments.length,
      folgaAgrupadaPairs: Math.floor(faAfter / 2),
      stepNotes,
    };
  }

  apaoAssignments(ws: GenerationWorkspace): GeneratedAssignment[] {
    const apaoIds = new Set(ws.apaoEmps.map((e) => e.uuid));
    return ws.toAssignments().filter((a) => apaoIds.has(a.employeeUuid));
  }

  apaoAllocations(ws: GenerationWorkspace): GeneratedAllocation[] {
    const apaoIds = new Set(ws.apaoEmps.map((e) => e.uuid));
    return ws.allocations.filter((a) => apaoIds.has(a.employeeUuid));
  }

  validate(ws: GenerationWorkspace) {
    return validateSchedule(ws.toScheduleContext());
  }
}

export const apaoScheduleEngine = new ApaoScheduleEngine();
