import { canWork } from "../../rules/eligibility.js";
import { validateSchedule } from "../../rules/engine.js";
import { runFinalCoverageGate } from "../../rules/coverage-gate.js";
import { classifyIssue } from "../violation-level.js";
import { issueToApiViolation } from "../../../infrastructure/mappers/violation.mapper.js";
import { GenerationWorkspace } from "./generation-workspace.js";
import { assignmentKey } from "../types.js";
import type { GenerationInput } from "../generation-types.js";
import {
  buildPaoCoverageAudit,
  formatPaoCoverageAuditNotes,
} from "./pao-coverage-audit.js";
import { demandPlanningEngine } from "./demand-planning-engine.js";
import type { DemandPlanningReport } from "./demand-planning-types.js";
import { getPaoPriorityTier } from "./pao-operational-priority.js";
import {
  listSelectedSteps,
  listSkippedSteps,
  STEP_GENERATION_LABELS,
  type BlockedEmployeeAudit,
  type CoverageDecisionAudit,
  type StepGenerationOptions,
  type StepGenerationReport,
  type StepGenerationResult,
} from "./step-generation-types.js";

export class StepGenerationEngine {
  execute(input: GenerationInput, options: StepGenerationOptions): StepGenerationResult {
    const ws = new GenerationWorkspace(input);
    const selectionWarnings: string[] = [];
    const stepNotes: string[] = [];
    const allocationsByStep: StepGenerationReport["allocationsByStep"] = {};
    const coverageDecisions: CoverageDecisionAudit[] = [];

    const needsHardBlocks =
      options.paoCheckPreAllocations ||
      options.paoDemandPlanning ||
      options.paoCoverageT6 ||
      options.paoCoverageT7 ||
      options.paoCoverageT8 ||
      options.paoAllocateFolgas ||
      options.paoAllocateFlights ||
      options.apaoCheckPreAllocations ||
      options.apaoAllocate;

    if (
      options.paoDemandPlanning &&
      (options.paoCoverageT6 || options.paoCoverageT7 || options.paoCoverageT8)
    ) {
      selectionWarnings.push(
        "Planejamento por demanda (7.3) substitui cobertura diária T6/T7/T8 — etapas legadas ignoradas.",
      );
    }

    if (needsHardBlocks && !options.paoCheckPreAllocations && !options.apaoCheckPreAllocations) {
      selectionWarnings.push(
        "Pré-alocações aplicadas automaticamente como base de elegibilidade (etapa não marcada).",
      );
      this.runStep(ws, "paoCheckPreAllocations", allocationsByStep, () => ws.applyHardBlocks());
    }

    if (options.paoCheckPreAllocations || options.apaoCheckPreAllocations) {
      this.runStep(ws, "paoCheckPreAllocations", allocationsByStep, () => ws.applyHardBlocks());
    }

    if (options.paoCheckRestrictions) {
      this.runStep(ws, "paoCheckRestrictions", allocationsByStep, () => {
        stepNotes.push(`PAOs ativos: ${ws.paoEmps.length}. Restrições auditadas sem novas alocações.`);
      });
    }

    let demandPlanningReport: DemandPlanningReport | undefined;

    if (options.paoDemandPlanning) {
      this.runStep(ws, "paoDemandPlanning", allocationsByStep, () => {
        demandPlanningReport = demandPlanningEngine.execute(ws);
        stepNotes.push(...demandPlanningReport.stepNotes);
        this.collectCoverageDecisions(ws, coverageDecisions, ["T6", "T7", "T8"]);
      });
    } else {
      if (options.paoCoverageT6) {
        this.runStep(ws, "paoCoverageT6", allocationsByStep, () => {
          ws.coverPaoShiftsOnly(["T6"]);
          this.collectCoverageDecisions(ws, coverageDecisions, ["T6"]);
        });
      }

      if (options.paoCoverageT7) {
        this.runStep(ws, "paoCoverageT7", allocationsByStep, () => {
          ws.coverPaoShiftsOnly(["T7"]);
          this.collectCoverageDecisions(ws, coverageDecisions, ["T7"]);
        });
      }

      if (options.paoCoverageT8) {
        this.runStep(ws, "paoCoverageT8", allocationsByStep, () => {
          ws.planT8CoverageRotating();
          ws.coverT8BlocksOnly();
          ws.ensureNdForT8Pairs();
          this.collectCoverageDecisions(ws, coverageDecisions, ["T8"]);
        });
      }

      const enabledCoverageShifts: ("T6" | "T7" | "T8")[] = [];
      if (options.paoCoverageT6) enabledCoverageShifts.push("T6");
      if (options.paoCoverageT7) enabledCoverageShifts.push("T7");
      if (options.paoCoverageT8) enabledCoverageShifts.push("T8");

      if (enabledCoverageShifts.length > 0) {
        ws.ensureMinShiftsForFullMonthNoFlight(enabledCoverageShifts);
      }

      if (options.paoAllocateFolgas) {
        if (!options.paoCoverageT6 && !options.paoCoverageT7 && !options.paoCoverageT8) {
          selectionWarnings.push("Folgas PAO executadas sem cobertura prévia — revise conflitos na grade.");
        }
        this.runStep(ws, "paoAllocateFolgas", allocationsByStep, () => {
          ws.planFolgaSocial();
          ws.allocatePaoRestDaysAfterCoverage();
          ws.correctMonoFolgasPedidas();
          ws.ensureExactTenFolgasPerPao();
          ws.finalizePaoFolgaCounts();
        });
      }

      if (options.paoAllocateFlights) {
        this.runStep(ws, "paoAllocateFlights", allocationsByStep, () => {
          ws.applyFlightsToAvailablePaoDays();
        });
      }
    }

    const enabledCoverageShifts: ("T6" | "T7" | "T8")[] = [];
    if (options.paoDemandPlanning) {
      enabledCoverageShifts.push("T6", "T7", "T8");
    } else {
      if (options.paoCoverageT6) enabledCoverageShifts.push("T6");
      if (options.paoCoverageT7) enabledCoverageShifts.push("T7");
      if (options.paoCoverageT8) enabledCoverageShifts.push("T8");
    }

    if (options.apaoCheckPreAllocations && !options.paoCheckPreAllocations) {
      stepNotes.push("Pré-alocações APAO compartilham a mesma base de bloqueios operacionais do PAO.");
    }

    if (options.apaoCheckShiftPreference) {
      this.runStep(ws, "apaoCheckShiftPreference", allocationsByStep, () => {
        stepNotes.push(
          "Preferência por turno APAO: cadastro funcional ainda não disponível — estrutura preparatória documentada.",
        );
      });
    }

    if (options.apaoCheckShiftRestrictions) {
      this.runStep(ws, "apaoCheckShiftRestrictions", allocationsByStep, () => {
        stepNotes.push(`APAOs auditados: ${ws.apaoEmps.length}. T8 nunca elegível para APAO.`);
      });
    }

    if (options.apaoAllocate) {
      if (!options.paoCoverageT6 && !options.paoCoverageT7) {
        selectionWarnings.push(
          "APAO depende de cobertura PAO. Execute primeiro T6/T7 para evitar APAO SEM PAO.",
        );
      }
      this.runStep(ws, "apaoAllocate", allocationsByStep, () => {
        ws.assignApaoWithPao();
        ws.allocateApaoRestDays();
        ws.completeApaoAgenda();
        ws.enforceApaoSixByOne();
      });
    }

    const blockedEmployees = this.collectBlockedEmployees(ws);
    const ctx = ws.toScheduleContext();
    const engineViolations = validateSchedule(ctx);
    const gate = runFinalCoverageGate(ctx);
    const violations = [
      ...ws.birthdayWarnings,
      ...ws.noFlightWarnings,
      ...ws.monoFolgaWarnings,
      ...(demandPlanningReport?.balanceReport?.warnings ?? []),
      ...engineViolations,
      ...gate.issues,
    ];

    const executed = listSelectedSteps(options).map((k) => STEP_GENERATION_LABELS[k]);
    const skipped = listSkippedSteps(options).map((k) => STEP_GENERATION_LABELS[k]);

    let paoCoverageAudit;
    if (enabledCoverageShifts.length > 0 || options.paoAllocateFolgas) {
      paoCoverageAudit = buildPaoCoverageAudit(ws, ws.monoFolgaAudit ?? undefined);
      stepNotes.push(...formatPaoCoverageAuditNotes(paoCoverageAudit));
    }

    const criticalCount = violations.filter((v) => classifyIssue(v) === "CRITICAL").length;
    const warningCount = violations.filter((v) => classifyIssue(v) === "WARNING").length;
    const infoCount = violations.filter((v) => classifyIssue(v) === "INFO").length;

    return {
      year: input.year,
      month: input.month,
      mode: "AUDIT_PARTIAL",
      persisted: false,
      assignments: ws.toAssignments(),
      allocations: ws.allocations,
      report: {
        mode: "AUDIT_PARTIAL",
        persisted: false,
        executedSteps: executed,
        skippedSteps: skipped,
        allocationsByStep,
        blockedEmployees,
        coverageGaps: ws.listCoverageGaps(),
        coverageDecisions,
        violations,
        criticalCount,
        warningCount,
        infoCount,
        selectionWarnings,
        stepNotes,
        paoCoverageAudit,
        demandPlanningReport,
      },
    };
  }

  toApiResponse(result: StepGenerationResult) {
    return {
      ...result,
      report: {
        ...result.report,
        violations: result.report.violations.map(issueToApiViolation),
      },
    };
  }

  private runStep(
    ws: GenerationWorkspace,
    stepKey: keyof StepGenerationOptions,
    allocationsByStep: StepGenerationReport["allocationsByStep"],
    fn: () => void,
  ): void {
    const assignmentsBefore = ws.toAssignments().length;
    const allocationsBefore = ws.allocations.length;
    fn();
    allocationsByStep[STEP_GENERATION_LABELS[stepKey]] = {
      assignments: ws.toAssignments().length - assignmentsBefore,
      allocations: ws.allocations.length - allocationsBefore,
    };
  }

  private collectBlockedEmployees(ws: GenerationWorkspace): BlockedEmployeeAudit[] {
    const out: BlockedEmployeeAudit[] = [];
    for (const c of [...ws.paoEmps, ...ws.apaoEmps]) {
      const did = ws.uuidToDomain.get(c.uuid);
      if (!did) continue;
      for (const day of ws.days) {
        const label = ws.blocked.get(assignmentKey(did, day));
        if (label) {
          out.push({
            employee: c.employee.name,
            employeeUuid: c.uuid,
            date: day,
            reason: label,
          });
        }
      }
    }
    return out;
  }

  private collectCoverageDecisions(
    ws: GenerationWorkspace,
    out: CoverageDecisionAudit[],
    codes: string[],
  ): void {
    for (const day of ws.days) {
      for (const code of codes) {
        const assigned = ws.toAssignments().find((a) => a.date === day && a.shiftCode === code);
        const blockedEmployees: Array<{ employee: string; reason: string }> = [];
        const selectionReasons: string[] = [];

        for (const c of ws.paoEmps) {
          const check = canWork(
            c.employee,
            day,
            code,
            ws.blocked,
            ws.planned,
            ws.canWorkOpts,
          );
          if (!check.ok) {
            blockedEmployees.push({ employee: c.employee.name, reason: check.reason ?? "inelegível" });
          }
        }

        if (assigned) {
          const emp = ws.paoEmps.find((e) => e.uuid === assigned.employeeUuid);
          selectionReasons.push("elegível", "sem bloqueio", `sem restrição ${code}`);
          if (emp) {
            const tier = getPaoPriorityTier(ws, emp.uuid);
            const tierLabel =
              tier === 0
                ? "prioridade: mês inteiro sem voo"
                : tier === 1
                  ? "prioridade: férias no mês"
                  : "prioridade: senioridade";
            selectionReasons.push(tierLabel, `senioridade ${emp.employee.seniority}`);
          }
          out.push({
            date: day,
            shiftCode: code,
            selectedEmployee: emp?.employee.name ?? assigned.employeeUuid,
            selectedEmployeeUuid: assigned.employeeUuid,
            selectionReasons,
            blockedEmployees,
          });
        } else if (!ws.hasPaoCoverage(day, code)) {
          out.push({
            date: day,
            shiftCode: code,
            selectedEmployee: null,
            selectedEmployeeUuid: null,
            selectionReasons: ["cobertura ausente após etapa"],
            blockedEmployees,
          });
        }
      }
    }
  }
}

export const stepGenerationEngine = new StepGenerationEngine();
