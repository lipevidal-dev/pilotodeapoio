import type { GenerationInput } from "./generation-types.js";
import { GenerationWorkspace } from "./generation-workspace.js";
import { countRateioTurns } from "./pao-rateio-shifts.js";
import { repairAllCoverageGapsFinal } from "./repair-all-coverage-gaps-final.js";
import { materializeT6T7BlocksStrict } from "./real-schedule-blocks.js";
import { coverResidualT6T7Only } from "./real-schedule-residual.js";
import { allocateT8BlocksStrict } from "./real-schedule-t8.js";
import { computeTurnRateio } from "./real-schedule-turn-rateio.js";
import { materializeVacationFortnightPatterns } from "./real-schedule-vacation-materialize.js";
import type { V3BlockMaterializeAudit } from "./v3-block-materialize-audit.js";

export interface V3EmployeeTurnBalance {
  employeeUuid: string;
  employeeName: string;
  /** Meta inteira após computeTurnRateio. */
  turnTarget: number;
  /** Turnos T6+T7+T8+T9 já alocados antes da materialização V3. */
  allocatedTurnsAtRateio: number;
  /** turnTarget − allocatedTurnsAtRateio. */
  requiredT6T7: number;
  /** IndividualTarget.target (min(requiredT6T7, capacity)). */
  individualTarget: number;
  /** Após targetToBlocksV3 / buildBlockPlans. */
  plannedBlocks: number;
  plannedTurns: number;
  /** Turnos totais antes de materializeT6T7BlocksStrict. */
  turnsBeforeMaterialization: number;
  /** Turnos totais após materializeT6T7BlocksStrict. */
  turnsAfterMaterialization: number;
  materializedBlocks: number;
  /** Turnos T6/T7 colocados na materialização (delta no grid). */
  materializedTurnsPlaced: number;
  /** Turnos totais após coverResidualT6T7Only. */
  turnsAfterResidual: number;
  /** Turnos totais após repairAllCoverageGapsFinal (1 passagem). */
  turnsAfterCoverageRepair: number;
  /** plannedTurns − materializedTurnsPlaced. */
  turnsLostAfterMaterialization: number;
  /** Déficit restante após residual (não recuperado). */
  turnsLostAfterResidual: number;
  /** Déficit restante após reparo de cobertura (não recuperado). */
  turnsLostAfterCoverageRepair: number;
}

export interface V3PipelineTurnBalanceReport {
  employees: V3EmployeeTurnBalance[];
  v3BlockMaterializeAudit: V3BlockMaterializeAudit;
}

/** Prepara workspace até o fim da etapa [3] (férias), imediatamente antes de computeTurnRateio. */
export function prepareWorkspaceForV3PipelineAudit(input: GenerationInput): GenerationWorkspace {
  const ws = new GenerationWorkspace(input);
  ws.realV1ManualCommonFolga = true;
  ws.applyHardBlocks();
  ws.enforceMonthStart6x1FromPrevious();
  ws.planFolgaSocial();
  ws.initRateioContext();
  allocateT8BlocksStrict(ws);
  materializeVacationFortnightPatterns(ws);
  return ws;
}

function countTurnsByEmployee(ws: GenerationWorkspace): Map<string, number> {
  const counts = new Map<string, number>();
  for (const emp of ws.paoEmps) {
    counts.set(emp.uuid, countRateioTurns(ws, emp.uuid));
  }
  return counts;
}

/**
 * Reexecuta o trecho V3 do pipeline REAL_V1 e registra saldo de turnos por PAO
 * após cada etapa: rateio → blocos → materialização → residual → reparo cobertura.
 * Não altera regras — apenas observa mutações sequenciais no workspace.
 */
export function auditV3PipelineTurnBalance(ws: GenerationWorkspace): V3PipelineTurnBalanceReport {
  const rateio = computeTurnRateio(ws);
  const rateioByUuid = new Map(rateio.entries.map((e) => [e.employeeUuid, e]));
  const targetByUuid = new Map(rateio.targets.map((t) => [t.employeeUuid, t]));

  const turnsBeforeMat = countTurnsByEmployee(ws);

  const materializeResult = materializeT6T7BlocksStrict(ws, rateio.targets);
  const matAuditByUuid = new Map(
    materializeResult.v3BlockMaterializeAudit.employees.map((e) => [e.employeeUuid, e]),
  );

  const turnsAfterMat = countTurnsByEmployee(ws);

  coverResidualT6T7Only(ws);
  const turnsAfterResidual = countTurnsByEmployee(ws);

  const ctx = ws.ensureRateioContext();
  repairAllCoverageGapsFinal(ws, ctx);
  const turnsAfterRepair = countTurnsByEmployee(ws);

  const employees: V3EmployeeTurnBalance[] = ws.paoEmps.map((emp) => {
    const entry = rateioByUuid.get(emp.uuid);
    const target = targetByUuid.get(emp.uuid);
    const plan = matAuditByUuid.get(emp.uuid);
    const matAudit = matAuditByUuid.get(emp.uuid);

    const turnTarget = entry?.turnTarget ?? 0;
    const allocatedTurnsAtRateio = entry?.allocatedTurns ?? turnsBeforeMat.get(emp.uuid) ?? 0;
    const requiredT6T7 = entry?.requiredT6T7 ?? 0;
    const individualTarget = target?.target ?? 0;
    const plannedBlocks = plan?.plannedBlocks ?? 0;
    const plannedTurns = plan?.plannedShifts ?? 0;

    const beforeMat = turnsBeforeMat.get(emp.uuid) ?? 0;
    const afterMat = turnsAfterMat.get(emp.uuid) ?? 0;
    const afterResidual = turnsAfterResidual.get(emp.uuid) ?? 0;
    const afterRepair = turnsAfterRepair.get(emp.uuid) ?? 0;

    const materializedTurnsPlaced = afterMat - beforeMat;
    const materializedBlocks = matAudit?.materializedBlocks ?? 0;

    const turnsLostAfterMaterialization = Math.max(0, plannedTurns - materializedTurnsPlaced);
    const residualGain = afterResidual - afterMat;
    const turnsLostAfterResidual = Math.max(0, turnsLostAfterMaterialization - residualGain);
    const repairGain = afterRepair - afterResidual;
    const turnsLostAfterCoverageRepair = Math.max(0, turnsLostAfterResidual - repairGain);

    return {
      employeeUuid: emp.uuid,
      employeeName: emp.employee.name,
      turnTarget,
      allocatedTurnsAtRateio,
      requiredT6T7,
      individualTarget,
      plannedBlocks,
      plannedTurns,
      turnsBeforeMaterialization: beforeMat,
      turnsAfterMaterialization: afterMat,
      materializedBlocks,
      materializedTurnsPlaced,
      turnsAfterResidual: afterResidual,
      turnsAfterCoverageRepair: afterRepair,
      turnsLostAfterMaterialization,
      turnsLostAfterResidual,
      turnsLostAfterCoverageRepair,
    };
  });

  employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR"));

  return { employees, v3BlockMaterializeAudit: materializeResult.v3BlockMaterializeAudit };
}

export function formatTurnBalanceChain(row: V3EmployeeTurnBalance): string {
  const stages = [
    row.turnTarget,
    row.plannedTurns,
    row.turnsAfterMaterialization,
    row.turnsAfterResidual,
    row.turnsAfterCoverageRepair,
  ];
  while (stages.length > 1 && stages[stages.length - 1] === stages[stages.length - 2]) {
    stages.pop();
  }
  return stages.join(" → ");
}

function matchesFocus(name: string, focusNames: string[]): boolean {
  const lower = name.toLowerCase();
  return focusNames.some((f) => lower.includes(f.toLowerCase()));
}

export function formatV3PipelineTurnBalanceTable(
  report: V3PipelineTurnBalanceReport,
  focusNames?: string[],
): string {
  const lines: string[] = [
    "===== V3 TURN BALANCE BY STAGE =====",
    "Pipeline: computeTurnRateio → targetToBlocksV3 → materializeT6T7BlocksStrict → coverResidualT6T7Only → repairAllCoverageGapsFinal",
    "",
    "Cadeia: turnTarget → plannedTurns → apósMat → apósResid → apósRepair (colapsa estágios iguais)",
    "Nome | Aloc@Rateio | ReqT6T7 | PlanBl | PlanTurn | MatBl | +Mat | apósMat | apósRes | apósRep | Cadeia | PerdMat | PerdRes | PerdRep",
  ];

  const rows = focusNames?.length
    ? report.employees.filter((e) => matchesFocus(e.employeeName, focusNames))
    : report.employees;

  for (const e of rows) {
    lines.push(
      [
        e.employeeName,
        e.allocatedTurnsAtRateio,
        e.requiredT6T7,
        e.plannedBlocks,
        e.plannedTurns,
        e.materializedBlocks,
        e.materializedTurnsPlaced,
        e.turnsAfterMaterialization,
        e.turnsAfterResidual,
        e.turnsAfterCoverageRepair,
        formatTurnBalanceChain(e),
        e.turnsLostAfterMaterialization,
        e.turnsLostAfterResidual,
        e.turnsLostAfterCoverageRepair,
      ].join(" | "),
    );
  }

  if (focusNames?.length) {
    const allWithLoss = report.employees.filter(
      (e) =>
        e.turnsLostAfterMaterialization > 0 ||
        e.turnsLostAfterResidual > 0 ||
        e.turnsLostAfterCoverageRepair > 0,
    );
    lines.push("");
    lines.push(`--- Foco: ${focusNames.join(", ")} (${rows.length} encontrado(s)) ---`);
    for (const e of rows) {
      lines.push(`  ${e.employeeName}: ${formatTurnBalanceChain(e)}`);
      if (e.turnsLostAfterMaterialization > 0) {
        lines.push(
          `    perda materialização: ${e.turnsLostAfterMaterialization} (plan=${e.plannedTurns}, colocados=${e.materializedTurnsPlaced})`,
        );
      }
      if (e.turnsLostAfterResidual > 0) {
        lines.push(`    perda residual: ${e.turnsLostAfterResidual}`);
      }
      if (e.turnsLostAfterCoverageRepair > 0) {
        lines.push(`    perda reparo cobertura: ${e.turnsLostAfterCoverageRepair}`);
      }
    }
    lines.push("");
    lines.push(
      `PAOs com perda no pipeline V3: ${allWithLoss.length}/${report.employees.length}`,
    );
  }

  return lines.join("\n");
}
