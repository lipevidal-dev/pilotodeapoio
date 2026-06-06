export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  timestamp: string;
}

/** Código do cargo — compatível com PAO/APAO e futuros cargos. */
export type EmployeeType = 'PAO' | 'APAO' | string;

export interface Employee {
  id: string;
  name: string;
  /** Compatibilidade — código do cargo */
  type: EmployeeType;
  roleId: string | null;
  cargoCode: string;
  cargoName: string;
  active: boolean;
  birthDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateEmployeePayload {
  name: string;
  roleId: string;
  birthDate?: string | null;
  active?: boolean;
}

export interface UpdateEmployeePayload {
  name?: string;
  roleId?: string;
  birthDate?: string | null;
  active?: boolean;
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

export interface EmployeeDeleteError {
  error: string;
  code?: 'HAS_OPERATIONAL_HISTORY';
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
