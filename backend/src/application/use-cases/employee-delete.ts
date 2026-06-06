export interface EmployeeOperationalHistory {
  scheduleAssignments: number;
  vacations: number;
  requestedDaysOff: number;
  flightAssignments: number;
  /** Pré-alocações manuais (simulador, curso, CMA, outro) — não inclui folgas geradas pelo motor. */
  preAllocations: number;
  /** Folgas/voos gerados pelo motor ainda persistidos (não bloqueiam exclusão). */
  generatorPreAllocations?: number;
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

const HISTORY_LABELS: Record<keyof Omit<EmployeeOperationalHistory, "generatorPreAllocations">, string> = {
  scheduleAssignments: "alocações em escala",
  vacations: "férias",
  requestedDaysOff: "folgas pedidas (FP)",
  flightAssignments: "voos",
  preAllocations: "pré-alocações manuais",
};

export function describeOperationalHistoryBlockers(
  history: EmployeeOperationalHistory,
): string[] {
  return (Object.keys(HISTORY_LABELS) as (keyof typeof HISTORY_LABELS)[])
    .filter((key) => history[key] > 0)
    .map((key) => `${history[key]} ${HISTORY_LABELS[key]}`);
}

export class EmployeeHasOperationalHistoryError extends Error {
  readonly code = "HAS_OPERATIONAL_HISTORY" as const;
  readonly history: EmployeeOperationalHistory;

  constructor(history: EmployeeOperationalHistory) {
    const blockers = describeOperationalHistoryBlockers(history);
    const detail =
      blockers.length > 0
        ? blockers.join("; ")
        : "histórico operacional";
    const hint =
      history.generatorPreAllocations && history.generatorPreAllocations > 0
        ? ` Há ${history.generatorPreAllocations} folga(s) gerada(s) pelo motor que não impedem exclusão — use Limpar geração na escala se ainda aparecerem na grade.`
        : "";
    super(
      `Funcionário possui histórico operacional (${detail}). Inative o funcionário em vez de excluir.${hint}`,
    );
    this.name = "EmployeeHasOperationalHistoryError";
    this.history = history;
  }
}