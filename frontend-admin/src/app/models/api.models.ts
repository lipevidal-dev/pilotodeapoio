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

export interface PreferredShiftSummary {
  id: string;
  code: string;
  name: string;
}

export interface SpecificShiftRequestPayload {
  shiftId: string;
  year?: number | null;
  month?: number | null;
  dayOfMonth?: number | null;
  weekday?: number | null;
}

export interface SpecificShiftRequestSummary extends SpecificShiftRequestPayload {
  shiftCode: string;
  shiftName: string;
}

export interface FcfScheduleEntry {
  shiftId: string;
  weekday: number;
  shiftCode?: string;
  shiftName?: string;
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
  preferredShiftIds?: string[];
  preferredShifts?: PreferredShiftSummary[];
  specificShiftRequests?: SpecificShiftRequestSummary[];
  isFcf?: boolean;
  fcfSchedule?: FcfScheduleEntry[];
  inInstruction?: boolean;
  instructionStartDate?: string | null;
  instructionEndDate?: string | null;
  portalLogin?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EmployeeMonthlyShiftPreferenceRow {
  employeeId: string;
  shiftId: string;
  shiftCode: string;
}

export interface EmployeeMonthlyShiftPreferencesResponse {
  year: number;
  month: number;
  preferences: EmployeeMonthlyShiftPreferenceRow[];
}

export interface CreateEmployeePayload {
  name: string;
  roleId: string;
  birthDate?: string | null;
  seniorityNumber?: number;
  active?: boolean;
  noFlightDates?: string[];
  restrictedShiftIds?: string[];
  preferredShiftIds?: string[];
  isFcf?: boolean;
  fcfSchedule?: FcfScheduleEntry[];
  inInstruction?: boolean;
  instructionStartDate?: string | null;
  instructionEndDate?: string | null;
  portalLogin?: string | null;
  portalPassword?: string | null;
}

export interface UpdateEmployeePayload {
  name?: string;
  roleId?: string;
  birthDate?: string | null;
  seniorityNumber?: number | null;
  active?: boolean;
  noFlightDates?: string[];
  restrictedShiftIds?: string[];
  preferredShiftIds?: string[];
  isFcf?: boolean;
  fcfSchedule?: FcfScheduleEntry[];
  inInstruction?: boolean;
  instructionStartDate?: string | null;
  instructionEndDate?: string | null;
  portalLogin?: string | null;
  portalPassword?: string | null;
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

export type ShiftCoverageType = 'REQUIRED' | 'PARALLEL';

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
  coverageType: ShiftCoverageType;
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
  coverageType?: ShiftCoverageType;
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
  coverageType?: ShiftCoverageType;
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
  blockOptimizerMetrics?: {
    turnosIsolados: number;
    blocosDe2: number;
    tamanhoMedioBlocos: number;
    desvioPadraoBlocos: number;
    espacamentoMedioBlocos: number;
    blockOptimizerScore: number;
  };
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

export interface GenerateApaoScheduleResponse {
  scheduleMonthId: string;
  assignmentsCreated: number;
  allocationsCreated: number;
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

export interface UnpublishScheduleResponse {
  scheduleMonthId: string;
  year: number;
  month: number;
  status: 'GENERATED';
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

export type ManualAllocationType =
  | 'T1'
  | 'T2'
  | 'T3'
  | 'T4'
  | 'T6'
  | 'T7'
  | 'T8'
  | 'T9'
  | 'T8_BLOCK'
  | 'ND'
  | 'FOLGA'
  | 'FS'
  | 'FA'
  | 'FP'
  | 'FANI'
  | 'VOO'
  | 'CURSO'
  | 'SIMULADOR'
  | 'CMA'
  | 'OUTRO'
  | 'CLEAR';

export interface ManualEditConflict {
  code: string;
  message: string;
  requiresConfirmation?: boolean;
}

export interface ManualEditResponse {
  success: boolean;
  applied: number;
  conflicts: ManualEditConflict[];
  warnings: string[];
  scheduleMonth: ScheduleMonthRecord;
  employees: Employee[];
  shifts: Shift[];
  assignments: ScheduleAssignmentRow[];
  preAllocations: PreAllocationRow[];
  operationalCadastros: OperationalCadastroRow[];
  validation: {
    valid: boolean;
    violations: Array<{
      severity: string;
      ruleCode: string;
      message: string;
      date?: string;
      employee?: string;
      detail?: string;
    }>;
  };
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
  startTime?: string | null;
  endTime?: string | null;
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
  startTime?: string;
  endTime?: string;
}

export interface UpdateLabeledPreAllocationPayload {
  date?: string;
  notes?: string | null;
  employeeId?: string;
  startTime?: string | null;
  endTime?: string | null;
}

export interface UpdateRequestedDayOffPayload {
  employeeId?: string;
  date?: string;
  status?: RequestedDayOffStatus;
  notes?: string | null;
}

export interface UpdateFlightAssignmentPayload {
  employeeId?: string;
  date?: string;
  description?: string | null;
}

export interface UpdateVacationPayload {
  employeeId?: string;
  startDate?: string;
  endDate?: string;
  notes?: string | null;
}

export type RequestedDayOffStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Vacation {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
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
  startTime?: string | null;
  endTime?: string | null;
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
  shifts: Shift[];
  assignments: ScheduleAssignmentRow[];
  preAllocations: PreAllocationRow[];
  operationalCadastros?: OperationalCadastroRow[];
  shiftSwaps?: ShiftSwapRequest[];
  ruleViolations?: RuleViolationRow[];
  validation?: unknown;
}

export type ShiftSwapStatus =
  | 'OFFERED'
  | 'AWAITING_ADMIN'
  | 'APPROVED'
  | 'REJECTED_BY_TARGET'
  | 'REJECTED_BY_ADMIN'
  | 'CANCELLED';

export type ShiftSwapKind = 'PEER' | 'SELF';

export interface ShiftSwapRequest {
  id: string;
  scheduleMonthId: string;
  kind: ShiftSwapKind;
  year: number;
  month: number;
  date: string;
  targetDate: string | null;
  pairLength: number;
  requesterDates?: string[];
  targetDates?: string[];
  requesterEmployeeId: string;
  requesterName: string;
  requesterShiftCode: string;
  targetEmployeeId: string;
  targetName: string;
  targetShiftCode: string;
  status: ShiftSwapStatus;
  notes: string | null;
  createdAt: string;
  respondedAt: string | null;
  resolvedAt: string | null;
}

export interface PortalScheduleResponse extends ScheduleMonthResponse {
  isPublished: boolean;
  portalFpRequestedCount?: number;
  portalFpRequestedLimit?: number;
}

export interface PortalShiftOption {
  id: string;
  code: string;
  name: string;
}

export interface PortalMonthShiftPreference {
  month: number;
  shiftId: string | null;
  shiftCode: string | null;
  shiftName: string | null;
}

export interface PortalShiftPreferencesResponse {
  year: number;
  employeeType: string;
  availableShifts: PortalShiftOption[];
  months: PortalMonthShiftPreference[];
}

export interface SetPortalShiftPreferencePayload {
  year: number;
  month: number;
  shiftId: string | null;
}

export type PortalRequestType =
  | 'FP'
  | 'VOO'
  | 'SIMULADOR'
  | 'CURSO'
  | 'CMA'
  | 'OUTRO'
  | 'FOLGA'
  | 'FS'
  | 'FA'
  | 'FANI'
  | 'ND'
  | 'FERIAS'
  | 'TURNO';

export interface CreatePortalRequestPayload {
  year: number;
  month: number;
  date: string;
  endDate?: string;
  type: PortalRequestType;
  notes?: string;
  thirteenthAdvanceRequested?: boolean;
  sellTenDaysRequested?: boolean;
}

export interface PendingPortalRequest {
  id: string;
  employeeId: string;
  employee?: Pick<Employee, 'id' | 'name'>;
  year: number;
  month: number;
  date: string;
  endDate?: string;
  type: PortalRequestType;
  notes?: string | null;
  thirteenthAdvanceRequested?: boolean;
  thirteenthAdvanceStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  sellTenDaysRequested?: boolean;
  sellTenDaysStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  source: 'pre_allocation' | 'flight' | 'requested_day_off' | 'vacation';
}

export interface RegisteredApaoPortalFolga {
  id: string;
  employeeId: string;
  employee?: Pick<Employee, 'id' | 'name'>;
  year: number;
  month: number;
  date: string;
  type: Exclude<PortalRequestType, 'FP' | 'VOO' | 'SIMULADOR' | 'CURSO' | 'CMA' | 'OUTRO' | 'FERIAS' | 'TURNO'>;
  notes?: string | null;
  source: 'pre_allocation';
}

export type FolgasPedidasCadastroRow =
  | (RequestedDayOff & { cadastroKind: 'FP'; cadastroType: 'FP' })
  | (RegisteredApaoPortalFolga & {
      cadastroKind: 'APAO_PORTAL';
      cadastroType: RegisteredApaoPortalFolga['type'];
      status: 'APPROVED';
    });

export type NextMotorRuleCategory =
  | 'bloqueios'
  | 'preferencias'
  | 'cobertura'
  | 'pao'
  | 'apao'
  | 'validacao';

export interface NextMotorRuleRow {
  id: string;
  label: string;
  description: string;
  category: NextMotorRuleCategory;
  enabled: boolean;
  locked: boolean;
}

export interface NextMotorParamRow {
  id: string;
  label: string;
  description: string;
  category: NextMotorRuleCategory;
  ruleId: string;
  value: number;
  min: number;
  max: number;
  locked: boolean;
}

export interface PaoShiftParamFieldRow {
  id: string;
  kind: string;
  label: string;
  description: string;
  ruleId: string;
  value: number;
  min: number;
  max: number;
  locked: boolean;
  inputMode?: 'number' | 't8_block_pattern';
  displayHint?: string;
}

export interface PaoShiftRuleFieldRow {
  id: string;
  globalRuleId: string;
  label: string;
  description: string;
  enabled: boolean;
  locked: boolean;
}

export interface PaoShiftParamsRow {
  shiftCode: string;
  shiftName: string;
  fields: PaoShiftParamFieldRow[];
  rules: PaoShiftRuleFieldRow[];
}

export interface EmployeeMotorPref {
  preferredShiftId: string | null;
  restrictedShiftIds: string[];
  /** Turno prioritário FCF (ex.: T9) — configurado no escopo do motor. */
  fcfPriorityShiftId?: string | null;
  /** 0=domingo … 6=sábado */
  fcfWeekday?: number | null;
}

export interface NextMotorConfigResponse {
  motorId: string;
  motorLabel: string;
  ready: boolean;
  enabledCount: number;
  totalCount: number;
  scopeEmployeeIds: string[] | null;
  scopeMode: 'all' | 'selected';
  scopeSelectedCount: number | null;
  employeePrefs: Record<string, EmployeeMotorPref>;
  /** Turnos rateio que o motor pode alocar na geração automática. */
  allowedShiftCodes: string[];
  categories: Array<{ id: NextMotorRuleCategory; label: string }>;
  rules: NextMotorRuleRow[];
  params: NextMotorParamRow[];
  paoShiftParams: PaoShiftParamsRow[];
}

export interface UpdateNextMotorRulesPayload {
  enabled?: Record<string, boolean>;
  params?: Record<string, number>;
  scopeEmployeeIds?: string[] | null;
  employeePrefs?: Record<string, EmployeeMotorPref>;
  allowedShiftCodes?: string[] | null;
}

