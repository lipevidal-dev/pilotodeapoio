export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  timestamp: string;
}

/** Código do cargo — compatível com PAO/APAO e futuros cargos. */
export type EmployeeType = 'PAO' | 'APAO' | string;

export interface RestrictedShiftSummary {
  id: string;
  code: string;
  name: string;
}

export interface Employee {
  id: string;
  name: string;
  /** Compatibilidade — código do cargo */
  type: EmployeeType;
  roleId: string | null;
  cargoCode: string;
  cargoName: string;
  seniorityNumber?: number;
  seniorityLabel?: string;
  active: boolean;
  birthDate?: string | null;
  noFlightDates?: string[];
  restrictedShiftIds?: string[];
  restrictedShifts?: RestrictedShiftSummary[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateEmployeePayload {
  name: string;
  roleId: string;
  birthDate?: string | null;
  seniorityNumber?: number;
  active?: boolean;
  noFlightDates?: string[];
  restrictedShiftIds?: string[];
}

export interface UpdateEmployeePayload {
  name?: string;
  roleId?: string;
  birthDate?: string | null;
  seniorityNumber?: number | null;
  active?: boolean;
  noFlightDates?: string[];
  restrictedShiftIds?: string[];
}

export interface JobRole {
  id: string;
  name: string;
  code: string;
  description: string | null;
  active: boolean;
  displayOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateJobRolePayload {
  name: string;
  code: string;
  description?: string | null;
  active?: boolean;
  displayOrder?: number;
}

export interface UpdateJobRolePayload {
  name?: string;
  code?: string;
  description?: string | null;
  active?: boolean;
  displayOrder?: number;
}

export interface EmployeeOperationalHistorySummary {
  scheduleAssignments: number;
  vacations: number;
  requestedDaysOff: number;
  flightAssignments: number;
  preAllocations: number;
  generatorPreAllocations?: number;
}

export interface EmployeeDeleteError {
  error: string;
  code?: 'HAS_OPERATIONAL_HISTORY';
  history?: EmployeeOperationalHistorySummary;
}

export type ShiftRoleType = 'PAO' | 'APAO' | 'BOTH';

export interface Shift {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  roleType: ShiftRoleType;
  active: boolean;
  displayOrder: number;
  mandatoryCoverage: boolean;
  requiresT8PairNd: boolean;
  durationHours: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateShiftPayload {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  roleType: ShiftRoleType;
  active?: boolean;
  displayOrder?: number;
  mandatoryCoverage?: boolean;
  requiresT8PairNd?: boolean;
}

export interface UpdateShiftPayload {
  code?: string;
  name?: string;
  startTime?: string;
  endTime?: string;
  roleType?: ShiftRoleType;
  active?: boolean;
  displayOrder?: number;
  mandatoryCoverage?: boolean;
  requiresT8PairNd?: boolean;
}

export interface ShiftDeleteError {
  error: string;
  code?: 'SHIFT_HAS_OPERATIONAL_HISTORY' | 'SHIFT_CODE_EXISTS';
}

export type ViolationSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface ScheduleViolation {
  severity: string;
  ruleCode: string;
  message: string;
  date: string;
  employee: string;
  detail?: string;
  employeeId?: string | null;
}

export interface OperationalTotals {
  totalPaos?: number;
  totalApaos?: number;
  totalTurnos: number;
  totalDiasTrabalhados: number;
  totalFolgas: number;
  totalFolgaSocial?: number;
  totalFp: number;
  totalFani?: number;
  totalFerias: number;
  totalVoos: number;
  totalSimuladores: number;
  totalCursos: number;
  totalNd?: number;
  totalCma?: number;
  totalOutros?: number;
  totalDisponiveis?: number;
  totalDiasVazios?: number;
  coverageT6?: number;
  coverageT7?: number;
  coverageT8?: number;
}

export interface BalanceAction {
  kind: string;
  employee: string;
  employeeUuid: string;
  date?: string;
  detail: string;
}

export interface OperationalBalanceReport {
  iterations: number;
  acceptable: boolean;
  before: Array<{ name: string; folgas: number; maxConsec: number; voos: number; turnos: number }>;
  after: Array<{ name: string; folgas: number; maxConsec: number; voos: number; turnos: number }>;
  actions: BalanceAction[];
  warnings: Array<{ type: string; detail: string; employee?: string }>;
  flightsRemoved: number;
  flightsRelocated: number;
  folgasInserted: number;
  shiftsRemoved: number;
  shiftsRelocated: number;
  shiftsAdded: number;
}

export interface GenerationSummary {
  totalViolations?: number;
  criticalCount?: number;
  warningCount?: number;
  infoCount?: number;
  coverageMissingCount?: number;
  daysWithFullCoverage?: number;
  generationMs?: number;
  impossibleScenario?: boolean;
  mainBlockingReasons?: string[];
  totalAssignments?: number;
  operationalTotals?: OperationalTotals;
  t6BlockCoverage?: { blockCount: number; averageDays: number; unitOccurrences: number };
  t7BlockCoverage?: { blockCount: number; averageDays: number; unitOccurrences: number };
  unitCoverageTotal?: number;
  balanceReport?: OperationalBalanceReport;
  motorVersion?: string;
  enginePath?: string;
  realEngineExecuted?: boolean;
  realMotorReport?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GenerateScheduleResponse {
  scheduleMonthId: string;
  status: string;
  assignmentsCreated: number;
  allocationsCreated: number;
  violations: ScheduleViolation[];
  summary: GenerationSummary;
  success: boolean;
  suggestions: string[];
  motorVersion?: string;
  enginePath?: string;
  realEngineExecuted?: boolean;
}

export interface GenerateFlightsResponse {
  scheduleMonthId: string;
  flightsCreated: number;
  violations: ScheduleViolation[];
  summary: GenerationSummary;
}

export interface PublishScheduleResponse {
  scheduleMonthId: string;
  year: number;
  month: number;
  status: 'PUBLISHED';
  warnings?: number;
}

export interface PublishBlockedResponse {
  code: string;
  message: string;
  criticalViolations: Array<{
    level: string;
    ruleCode: string;
    message: string;
    date?: string;
    employee?: string;
    detail?: string;
  }>;
}

export interface ScheduleMonthRecord {
  id: string;
  year: number;
  month: number;
  status: string;
}

export interface ScheduleAssignmentRow {
  id: string;
  scheduleMonthId: string;
  employeeId: string;
  date: string;
  shiftCode: string;
  label: string | null;
  source: string;
  employee?: Employee;
}

export interface RuleViolationRow {
  id: string;
  severity: string;
  ruleCode: string;
  message: string;
  date: string | null;
  employeeId: string | null;
}

export interface PreAllocationRow {
  id: string;
  scheduleMonthId?: string;
  employeeId: string;
  date: string;
  label: string;
  notes?: string | null;
  employee?: Employee;
}

export interface OperationalCadastroRow {
  id: string;
  employeeId: string;
  date: string;
  label: string;
  source: 'vacation' | 'requested_day_off' | 'flight' | 'pre_allocation';
  sourceId?: string;
  priority?: number;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateLabeledPreAllocationBatchPayload {
  year: number;
  month: number;
  employeeId: string;
  dates: string[];
  notes?: string;
}

export interface UpdateLabeledPreAllocationPayload {
  date?: string;
  notes?: string | null;
  employeeId?: string;
}

export type RequestedDayOffStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Vacation {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  employee?: Employee;
}

export interface CreateVacationPayload {
  employeeId: string;
  startDate: string;
  endDate: string;
  notes?: string;
}

export interface CreateVacationBatchPayload {
  employeeId: string;
  periods: { startDate: string; endDate: string }[];
  notes?: string;
}

export interface VacationBatchResult {
  created: number;
  skipped: number;
  items: Vacation[];
  skippedPeriods: { startDate: string; endDate: string }[];
}

export interface RequestedDayOff {
  id: string;
  employeeId: string;
  date: string;
  status: RequestedDayOffStatus;
  notes: string | null;
  employee?: Employee;
}

export interface CreateRequestedDayOffPayload {
  employeeId: string;
  date: string;
  status?: RequestedDayOffStatus;
  notes?: string;
}

export interface CreateRequestedDayOffBatchPayload {
  employeeId: string;
  dates: string[];
  status: RequestedDayOffStatus;
  notes?: string;
}

export interface RequestedDayOffBatchResult {
  created: number;
  skipped: number;
  items: RequestedDayOff[];
  skippedDates: string[];
}

export interface FlightAssignment {
  id: string;
  employeeId: string;
  date: string;
  description: string | null;
  source: string;
  employee?: Employee;
}

export interface CreateFlightAssignmentPayload {
  employeeId: string;
  date: string;
  description?: string;
  source?: string;
}

export interface CreateFlightAssignmentBatchPayload {
  employeeId: string;
  dates: string[];
  description?: string;
  source?: string;
}

export interface FlightAssignmentBatchResult {
  created: number;
  skipped: number;
  items: FlightAssignment[];
  skippedDates: string[];
}

export interface PreAllocation {
  id: string;
  scheduleMonthId: string;
  employeeId: string;
  date: string;
  label: string;
  notes: string | null;
  employee?: Employee;
  scheduleMonth?: ScheduleMonthRecord;
}

export interface CreatePreAllocationPayload {
  year: number;
  month: number;
  employeeId: string;
  date: string;
  label: string;
  notes?: string;
}

export interface CreatePreAllocationBatchPayload {
  year: number;
  month: number;
  employeeId: string;
  dates: string[];
  label: string;
  notes?: string;
}

export interface PreAllocationBatchResult {
  created: number;
  skipped: number;
  items: PreAllocation[];
  skippedDates: string[];
}

export interface BatchCreateResult {
  created: number;
  skipped: number;
}

export interface BatchDeleteResult {
  deleted: number;
  failed: Array<{ id: string; error: string }>;
}

export interface ScheduleMonthResponse {
  scheduleMonth: ScheduleMonthRecord;
  employees: Employee[];
  shifts: unknown[];
  assignments: ScheduleAssignmentRow[];
  preAllocations: PreAllocationRow[];
  operationalCadastros?: OperationalCadastroRow[];
  ruleViolations?: RuleViolationRow[];
  validation?: unknown;
}

export interface DemandPlanningReport {
  demand: {
    daysInMonth: number;
    shiftsPerDay: number;
    totalDemand: number;
    perShift: { T6: number; T7: number; T8: number };
  };
  capacity: {
    byEmployee: Array<{
      employeeUuid: string;
      name: string;
      group: string;
      capacity: number;
      adjusted: boolean;
      detail: string;
    }>;
    totalCapacity: number;
  };
  operationalBalance: number;
  targets: Array<{
    employeeUuid: string;
    name: string;
    group: string;
    seniority: number;
    target: number;
    capacity: number;
  }>;
  blockPlans: Array<{
    employeeUuid: string;
    name: string;
    group: string;
    seniority: number;
    target: number;
    plannedBlocks: Array<{ size: number; shiftCode?: string }>;
    executedBlocks: Array<{ startDate: string; size: number; shiftCode: string; endDate: string }>;
  }>;
  averageBlockSize: number;
  unitCoverageBefore: number;
  unitCoverageApplied: number;
  unitCoverageAfter: number;
  stepNotes: string[];
  warnings?: Array<{ type: string; detail: string; employee?: string }>;
}

export interface StepGenerationOptions {
  paoCheckPreAllocations: boolean;
  paoCheckRestrictions: boolean;
  paoDemandPlanning: boolean;
  paoCoverageT6: boolean;
  paoCoverageT7: boolean;
  paoCoverageT8: boolean;
  paoAllocateFolgas: boolean;
  paoAllocateFlights: boolean;
  apaoCheckPreAllocations: boolean;
  apaoCheckShiftPreference: boolean;
  apaoCheckShiftRestrictions: boolean;
  apaoAllocate: boolean;
}

export interface StepGenerationAuditAssignment {
  employeeUuid: string;
  date: string;
  shiftCode: string;
}

export interface StepGenerationAuditAllocation {
  employeeUuid: string;
  date: string;
  label: string;
}

export interface StepGenerationReport {
  mode: 'AUDIT_PARTIAL';
  persisted: false;
  executedSteps: string[];
  skippedSteps: string[];
  allocationsByStep: Record<string, { assignments: number; allocations: number }>;
  blockedEmployees: Array<{
    employee: string;
    employeeUuid: string;
    date: string;
    reason: string;
  }>;
  coverageGaps: Array<{ date: string; shiftCode: string }>;
  coverageDecisions: Array<{
    date: string;
    shiftCode: string;
    selectedEmployee: string | null;
    selectedEmployeeUuid: string | null;
    selectionReasons: string[];
    blockedEmployees: Array<{ employee: string; reason: string }>;
  }>;
  violations: ScheduleViolation[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  selectionWarnings: string[];
  stepNotes: string[];
  demandPlanningReport?: DemandPlanningReport;
  paoCoverageAudit?: {
    fullMonthNoFlight: Array<{
      employeeUuid: string;
      employeeName: string;
      shiftCount: number;
      reached20: boolean;
      breakdown: Record<string, number>;
    }>;
    vacationPao: Array<{
      employeeUuid: string;
      employeeName: string;
      vacationDays: number;
      shiftsBeforeVacation: number;
      shiftsAfterVacation: number;
      totalOperationalShifts: number;
    }>;
    t6Blocks: { blockCount: number; averageBlockSize: number; unitCoverageCount: number };
    t7Blocks: { blockCount: number; averageBlockSize: number; unitCoverageCount: number };
    unitCoverageTotal: number;
    monoFolgas: {
      detected: number;
      corrected: number;
      kept: Array<{ employee: string; date: string; reason: string }>;
    };
  };
}

export interface GenerateByStepsResponse {
  year: number;
  month: number;
  mode: 'AUDIT_PARTIAL';
  persisted: false;
  assignments: StepGenerationAuditAssignment[];
  allocations: StepGenerationAuditAllocation[];
  report: StepGenerationReport;
}
