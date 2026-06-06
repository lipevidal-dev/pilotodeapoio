export interface EmployeeOperationalHistory {
  scheduleAssignments: number;
  vacations: number;
  requestedDaysOff: number;
  flightAssignments: number;
  preAllocations: number;
}

export function canPhysicallyDeleteEmployee(history: EmployeeOperationalHistory): boolean {
  return (
    history.scheduleAssignments === 0 &&
    history.vacations === 0 &&
    history.requestedDaysOff === 0 &&
    history.flightAssignments === 0 &&
    history.preAllocations === 0
  );
}

export class EmployeeHasOperationalHistoryError extends Error {
  readonly code = "HAS_OPERATIONAL_HISTORY" as const;

  constructor() {
    super(
      "Funcionário possui histórico operacional (escalas, férias, FP, voos ou pré-alocações). Inative o funcionário em vez de excluir.",
    );
    this.name = "EmployeeHasOperationalHistoryError";
  }
}
