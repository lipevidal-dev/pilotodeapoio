import type { EmployeeBlockPlan } from "./demand-planning-types.js";
import type {
  GeneratedAllocation,
  GeneratedAssignment,
} from "./generation-types.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import type { ScheduleRateioContext } from "./schedule-rateio-context.js";
import type { ValidationIssue } from "./types.js";
import type { V3BlockMaterializeAudit } from "./v3-block-materialize-audit.js";
import type { RealMotorReport } from "./real-schedule-types.js";

/** Etapas oficiais do pipeline REAL_V1 — ver docs/MOTOR_V4_PIPELINE_MAP.md */
export type PipelineStage =
  | "INPUT"
  | "PRE_ALLOCATIONS"
  | "AVAILABILITY"
  | "PROPORTIONAL_TARGETS"
  | "BLOCK_PLANNING"
  | "MATERIALIZATION"
  | "RESIDUAL"
  | "T8_ND"
  | "DEDUP"
  | "V4_ENFORCE"
  | "BLOCK_OPTIMIZER"
  | "FINAL_REPAIR"
  | "FINAL_AUDIT"
  | "PERSISTENCE";

export interface CoverageSnapshot {
  gaps: Array<{ date: string; shiftCode: string }>;
  gapCount: number;
  t6DaysCovered: number;
  t7DaysCovered: number;
  t8DaysCovered: number;
}

export interface EmployeeTurnSnapshot {
  employeeUuid: string;
  name: string;
  turnsT6: number;
  turnsT7: number;
  turnsT8: number;
  turnsT9: number;
  turnsTotal: number;
  workdaysFromBreakdown: number;
  minTurn: number | null;
  targetTurn: number | null;
  maxTurn: number | null;
}

export interface GenerationDiagnostics {
  stage: PipelineStage;
  paoCount: number;
  apaoCount: number;
  lockedPreAllocCount: number;
  employeeTurns: EmployeeTurnSnapshot[];
  v3BlockMaterializeAudit?: V3BlockMaterializeAudit;
  motorReport?: Partial<RealMotorReport>;
}

/**
 * Estado oficial da geração — fonte única para leitura entre etapas.
 * Mutations continuam no GenerationWorkspace até Fase C da refatoração;
 * toda leitura de contadores deve preferir rebuild via buildScheduleGenerationState.
 */
export interface ScheduleGenerationState {
  stage: PipelineStage;
  assignments: GeneratedAssignment[];
  preAllocations: GeneratedAllocation[];
  coverage: CoverageSnapshot;
  rateioContext: ScheduleRateioContext | null;
  blockPlan: EmployeeBlockPlan[] | null;
  diagnostics: GenerationDiagnostics;
  warnings: ValidationIssue[];
  errors: ValidationIssue[];
}

export interface BuildScheduleGenerationStateOptions {
  stage?: PipelineStage;
  blockPlan?: EmployeeBlockPlan[] | null;
  v3BlockMaterializeAudit?: V3BlockMaterializeAudit;
  motorReport?: Partial<RealMotorReport>;
  warnings?: ValidationIssue[];
  errors?: ValidationIssue[];
}

function buildCoverageSnapshot(ws: GenerationWorkspace): CoverageSnapshot {
  const gaps = ws.listCoverageGaps();
  let t6 = 0;
  let t7 = 0;
  let t8 = 0;
  for (const day of ws.days) {
    if (ws.hasPaoCoverage(day, "T6")) t6++;
    if (ws.hasPaoCoverage(day, "T7")) t7++;
    if (ws.hasPaoCoverage(day, "T8")) t8++;
  }
  return {
    gaps: gaps.map((g) => ({ date: g.date, shiftCode: g.shiftCode })),
    gapCount: gaps.length,
    t6DaysCovered: t6,
    t7DaysCovered: t7,
    t8DaysCovered: t8,
  };
}

function buildEmployeeTurnSnapshots(ws: GenerationWorkspace): EmployeeTurnSnapshot[] {
  const ctx = ws.rateioContext;
  return ws.paoEmps.map((c) => {
    const uuid = c.uuid;
    const turnsT6 = ctx?.currentT6Counts.get(uuid) ?? 0;
    const turnsT7 = ctx?.currentT7Counts.get(uuid) ?? 0;
    const turnsT8 = ctx?.currentT8Counts.get(uuid) ?? 0;
    const turnsT9 = ctx?.currentT9Counts.get(uuid) ?? 0;
    return {
      employeeUuid: uuid,
      name: c.employee.name,
      turnsT6,
      turnsT7,
      turnsT8,
      turnsT9,
      turnsTotal: turnsT6 + turnsT7 + turnsT8 + turnsT9,
      workdaysFromBreakdown: turnsT6 + turnsT7 + turnsT8 + turnsT9,
      minTurn: ctx?.minTurnCounts.get(uuid) ?? null,
      targetTurn: ctx?.targetTurnCounts.get(uuid) ?? null,
      maxTurn: ctx?.maxTurnCounts.get(uuid) ?? null,
    };
  });
}

/** Reconstrói o estado oficial a partir do workspace (sync rateio antes de chamar). */
export function buildScheduleGenerationState(
  ws: GenerationWorkspace,
  options: BuildScheduleGenerationStateOptions = {},
): ScheduleGenerationState {
  const stage = options.stage ?? "INPUT";
  const rateioContext = ws.rateioContext ?? null;

  return {
    stage,
    assignments: ws.toAssignments(),
    preAllocations: [...ws.allocations],
    coverage: buildCoverageSnapshot(ws),
    rateioContext,
    blockPlan: options.blockPlan ?? null,
    diagnostics: {
      stage,
      paoCount: ws.paoEmps.length,
      apaoCount: ws.apaoEmps.length,
      lockedPreAllocCount: ws.input.lockedAllocations.length,
      employeeTurns: buildEmployeeTurnSnapshots(ws),
      v3BlockMaterializeAudit: options.v3BlockMaterializeAudit,
      motorReport: options.motorReport,
    },
    warnings: options.warnings ?? [],
    errors: options.errors ?? [],
  };
}

/** Sincroniza rateio e reconstrói estado — padrão obrigatório entre checkpoints. */
export function refreshScheduleGenerationState(
  ws: GenerationWorkspace,
  options: BuildScheduleGenerationStateOptions = {},
): ScheduleGenerationState {
  ws.syncRateioContext();
  return buildScheduleGenerationState(ws, options);
}
