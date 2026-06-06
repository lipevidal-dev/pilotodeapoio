export interface ShiftOperationalHistory {
  scheduleAssignments: number;
}

export function canPhysicallyDeleteShift(history: ShiftOperationalHistory): boolean {
  return history.scheduleAssignments === 0;
}

export class ShiftHasOperationalHistoryError extends Error {
  readonly code = "SHIFT_HAS_OPERATIONAL_HISTORY" as const;

  constructor() {
    super(
      "Este turno possui histórico operacional. Inative o turno em vez de excluir.",
    );
    this.name = "ShiftHasOperationalHistoryError";
  }
}
