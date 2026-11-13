export type FlightPlanningRosterEmployee = {
  id: string;
  name: string;
  active: boolean;
  type: string;
  isFcf: boolean;
  isCmte: boolean;
};

export type FlightPlanningRosterEntry = {
  employeeId: string;
  name: string;
  requested: boolean;
};

/** PAO ativo ou copiloto FCF. Comandante (CMTE) fica de fora desta lista. */
export function isFlightPlanningAudience(employee: FlightPlanningRosterEmployee): boolean {
  return employee.active && !employee.isCmte && (employee.type === "PAO" || employee.isFcf);
}

export function buildFlightPlanningRoster(
  employees: FlightPlanningRosterEmployee[],
  requestedIds: Iterable<string>,
): FlightPlanningRosterEntry[] {
  const requested = new Set(requestedIds);
  return employees
    .filter(isFlightPlanningAudience)
    .map((employee) => ({
      employeeId: employee.id,
      name: employee.name.trim() || "Colaborador",
      requested: requested.has(employee.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
