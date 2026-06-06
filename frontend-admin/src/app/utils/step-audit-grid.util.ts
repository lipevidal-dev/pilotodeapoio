import type {
  GenerateByStepsResponse,
  OperationalCadastroRow,
  ScheduleAssignmentRow,
  ScheduleMonthResponse,
} from '../models/api.models';

export function auditAssignmentsToRows(
  audit: GenerateByStepsResponse,
  scheduleMonthId: string,
): ScheduleAssignmentRow[] {
  return audit.assignments.map((a, index) => ({
    id: `audit-assignment-${index}`,
    scheduleMonthId,
    employeeId: a.employeeUuid,
    date: a.date,
    shiftCode: a.shiftCode,
    label: null,
    source: 'AUDIT',
  }));
}

export function auditAllocationsToCadastros(
  audit: GenerateByStepsResponse,
): OperationalCadastroRow[] {
  return audit.allocations.map((a, index) => ({
    id: `audit-allocation-${index}`,
    employeeId: a.employeeUuid,
    date: a.date,
    label: a.label,
    source: 'pre_allocation',
  }));
}

export function applyAuditPreviewToSchedule(
  data: ScheduleMonthResponse,
  audit: GenerateByStepsResponse,
): ScheduleMonthResponse {
  const auditCadastros = auditAllocationsToCadastros(audit);
  return {
    ...data,
    assignments: auditAssignmentsToRows(audit, data.scheduleMonth.id),
    operationalCadastros: [...(data.operationalCadastros ?? []), ...auditCadastros],
  };
}
