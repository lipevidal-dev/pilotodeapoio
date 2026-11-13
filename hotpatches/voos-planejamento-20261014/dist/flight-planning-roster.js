/** PAO ativo ou copiloto FCF. Comandante (CMTE) fica de fora desta lista. */
export function isFlightPlanningAudience(employee) {
    return employee.active && !employee.isCmte && (employee.type === "PAO" || employee.isFcf);
}
export function buildFlightPlanningRoster(employees, requestedIds) {
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
//# sourceMappingURL=flight-planning-roster.js.map