export type FlightPlanningEmailLine = {
  date: string;
  description: string;
};

export type FlightPlanningEmailRequest = {
  employeeId: string;
  employeeName: string;
  createdAt: string;
  lines: FlightPlanningEmailLine[];
};

function formatBrDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

/**
 * Texto único para colar no e-mail ao setor de planejamento.
 * Um bloco por colaborador, com todas as linhas que ele enviou.
 */
export function formatFlightPlanningEmail(requests: FlightPlanningEmailRequest[]): string {
  const order: string[] = [];
  const names = new Map<string, string>();
  const linesByEmployee = new Map<string, FlightPlanningEmailLine[]>();

  const sorted = [...requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const request of sorted) {
    const id = request.employeeId;
    if (!linesByEmployee.has(id)) {
      linesByEmployee.set(id, []);
      names.set(id, request.employeeName.trim() || "Colaborador");
      order.push(id);
    }
    const bucket = linesByEmployee.get(id)!;
    const lines = [...request.lines].sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description));
    bucket.push(...lines);
  }

  return order
    .map((id) => {
      const body = (linesByEmployee.get(id) ?? [])
        .map(
          (line) =>
            `Data: ${formatBrDate(line.date)}\nSolicitação do voo: ${line.description.trim()}`,
        )
        .join("\n\n");
      return `${names.get(id)} solicita:\n${body}`;
    })
    .join("\n\n");
}
