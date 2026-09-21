/**
 * Rateio justo da demanda obrigatória PAO (T6/T7/T8…):
 * meta igual = floor(demanda / N(m)), onde N(m) = nº de colaboradores
 * ativos no mês m (oscila: pode ser <12 ou >12).
 * Resto da divisão (parte quebrada) permanece como gap de cobertura —
 * não dá +1 para uns e deixa outros com menos.
 *
 * Extras de cobertura (+1/+2) usam o contador acumulado no ano civil
 * para escolher quem fica acima da meta no mês (compensado nos meses seguintes).
 *
 * Esperado YTD por pessoa = soma das metas só nos meses em que estava ativa,
 * cada uma com o N(m) daquele mês — nunca um N fixo “12” o ano inteiro.
 */

import { iterDays } from "../../rules/dates.js";

/** Máximo de turnos acima da meta mensal justa na fase EXTRA_COBERTURA. */
export const MAX_MONTHLY_RATEIO_OVERSHOOT = 2;

/** Headcount e quem entrou no pool de rateio em um mês passado do ano civil. */
export type YearRateioMonthSnapshot = {
  month: number;
  employeeCount: number;
  employeeUuids: string[];
};

export function calculateCoverageDemand(
  daysInMonth: number,
  coverageShiftCodes: string[],
): number {
  const codes = coverageShiftCodes.length > 0 ? coverageShiftCodes : ["T6", "T7", "T8"];
  return Math.max(0, daysInMonth) * codes.length;
}

/** Meta inteira idêntica por colaborador; sobra da divisão vira gap. */
export function fairRateioTargetPerEmployee(
  daysInMonth: number,
  coverageShiftCodes: string[],
  employeeCount: number,
): number {
  if (employeeCount <= 0) return 0;
  const demand = calculateCoverageDemand(daysInMonth, coverageShiftCodes);
  return Math.floor(demand / employeeCount);
}

export function fairRateioRemainderGaps(
  daysInMonth: number,
  coverageShiftCodes: string[],
  employeeCount: number,
): number {
  if (employeeCount <= 0) return calculateCoverageDemand(daysInMonth, coverageShiftCodes);
  const demand = calculateCoverageDemand(daysInMonth, coverageShiftCodes);
  return demand - fairRateioTargetPerEmployee(daysInMonth, coverageShiftCodes, employeeCount) * employeeCount;
}

function resolveCountForMonth(
  month: number,
  employeeCountOrByMonth: number | ReadonlyMap<number, number> | ReadonlyArray<number>,
): number {
  if (typeof employeeCountOrByMonth === "number") {
    return employeeCountOrByMonth;
  }
  if (Array.isArray(employeeCountOrByMonth)) {
    // Aceita índice 0-based (mês-1) ou esparso via Map.
    return employeeCountOrByMonth[month - 1] ?? 0;
  }
  return employeeCountOrByMonth.get(month) ?? 0;
}

/**
 * Meta justa acumulada de jan até `throughMonth` inclusive (ano civil).
 * `employeeCountOrByMonth`:
 *  - number → legado: mesmo N em todos os meses;
 *  - Map/Array → N(m) oscilante por mês (0 = mês sem escala / sem pool).
 */
export function fairRateioExpectedYearToDate(
  year: number,
  throughMonth: number,
  coverageShiftCodes: string[],
  employeeCountOrByMonth: number | ReadonlyMap<number, number> | ReadonlyArray<number>,
): number {
  if (throughMonth < 1) return 0;
  const last = Math.min(12, Math.max(1, Math.floor(throughMonth)));
  let sum = 0;
  for (let month = 1; month <= last; month++) {
    const n = resolveCountForMonth(month, employeeCountOrByMonth);
    if (n <= 0) continue;
    sum += fairRateioTargetPerEmployee(
      iterDays(year, month).length,
      coverageShiftCodes,
      n,
    );
  }
  return sum;
}

/**
 * Esperado YTD só nos meses em que a pessoa estava no pool (admissão/demissão /
 * oscilação de quadro). Cada mês usa o N(m) daquele mês.
 */
export function fairRateioExpectedForEmployee(
  year: number,
  throughMonth: number,
  coverageShiftCodes: string[],
  employeeCountByMonth: ReadonlyMap<number, number> | ReadonlyArray<number>,
  activeMonths: ReadonlySet<number>,
): number {
  if (throughMonth < 1 || activeMonths.size === 0) return 0;
  const last = Math.min(12, Math.max(1, Math.floor(throughMonth)));
  let sum = 0;
  for (let month = 1; month <= last; month++) {
    if (!activeMonths.has(month)) continue;
    const n = resolveCountForMonth(month, employeeCountByMonth);
    if (n <= 0) continue;
    sum += fairRateioTargetPerEmployee(
      iterDays(year, month).length,
      coverageShiftCodes,
      n,
    );
  }
  return sum;
}

/**
 * Monta Map N(m) + Set de meses ativos por uuid a partir dos snapshots
 * históricos (jan..mês−1) e do pool corrente.
 */
export function buildYearRateioExpectedContext(params: {
  year: number;
  currentMonth: number;
  currentEmployeeCount: number;
  currentEmployeeUuids: readonly string[];
  priorMonths: readonly YearRateioMonthSnapshot[];
}): {
  employeeCountByMonth: Map<number, number>;
  activeMonthsByUuid: Map<string, Set<number>>;
} {
  const employeeCountByMonth = new Map<number, number>();
  const activeMonthsByUuid = new Map<string, Set<number>>();

  const markActive = (uuid: string, month: number) => {
    let set = activeMonthsByUuid.get(uuid);
    if (!set) {
      set = new Set<number>();
      activeMonthsByUuid.set(uuid, set);
    }
    set.add(month);
  };

  for (const snap of params.priorMonths) {
    if (snap.month < 1 || snap.month >= params.currentMonth) continue;
    if (snap.employeeCount > 0) {
      employeeCountByMonth.set(snap.month, snap.employeeCount);
    }
    for (const uuid of snap.employeeUuids) {
      markActive(uuid, snap.month);
    }
  }

  if (params.currentMonth >= 1 && params.currentMonth <= 12 && params.currentEmployeeCount > 0) {
    employeeCountByMonth.set(params.currentMonth, params.currentEmployeeCount);
    for (const uuid of params.currentEmployeeUuids) {
      markActive(uuid, params.currentMonth);
    }
  }

  return { employeeCountByMonth, activeMonthsByUuid };
}

/**
 * Saldo do contador: acumulado − esperado YTD.
 * Mais negativo = mais prioritário para receber extras de cobertura.
 */
export function yearRateioSaldo(
  priorYearCount: number,
  currentMonthCount: number,
  expectedYearToDate: number,
): number {
  return priorYearCount + currentMonthCount - expectedYearToDate;
}

/** Linha do relatório de rateio justo (para UI / toast pós-geração). */
export type FairRateioEmployeeRow = {
  uuid: string;
  name: string;
  prior: number;
  monthCount: number;
  accumulated: number;
  expected: number;
  saldo: number;
  activeMonths: number[];
};

export type FairRateioReport = {
  year: number;
  month: number;
  daysInMonth: number;
  employeeCount: number;
  demand: number;
  meta: number;
  remainderGaps: number;
  coverageShiftCodes: string[];
  /** N(m) conhecido no ano até o mês corrente (oscilação de quadro). */
  employeeCountByMonth: Record<string, number>;
  employees: FairRateioEmployeeRow[];
};

export function buildFairRateioReport(params: {
  year: number;
  month: number;
  daysInMonth: number;
  coverageShiftCodes: string[];
  employeeCount: number;
  employeeCountByMonth: ReadonlyMap<number, number>;
  employees: Array<{
    uuid: string;
    name: string;
    prior: number;
    monthCount: number;
    expected: number;
    activeMonths: ReadonlySet<number> | number[];
  }>;
}): FairRateioReport {
  const codes =
    params.coverageShiftCodes.length > 0 ? params.coverageShiftCodes : ["T6", "T7", "T8"];
  const demand = calculateCoverageDemand(params.daysInMonth, codes);
  const meta = fairRateioTargetPerEmployee(params.daysInMonth, codes, params.employeeCount);
  const remainderGaps = fairRateioRemainderGaps(params.daysInMonth, codes, params.employeeCount);

  const employeeCountByMonth: Record<string, number> = {};
  for (const [m, n] of params.employeeCountByMonth) {
    employeeCountByMonth[String(m)] = n;
  }

  const employees: FairRateioEmployeeRow[] = params.employees.map((e) => {
    const accumulated = e.prior + e.monthCount;
    const activeMonths = Array.isArray(e.activeMonths)
      ? [...e.activeMonths].sort((a, b) => a - b)
      : [...e.activeMonths].sort((a, b) => a - b);
    return {
      uuid: e.uuid,
      name: e.name,
      prior: e.prior,
      monthCount: e.monthCount,
      accumulated,
      expected: e.expected,
      saldo: yearRateioSaldo(e.prior, e.monthCount, e.expected),
      activeMonths,
    };
  });
  employees.sort((a, b) => a.saldo - b.saldo || a.name.localeCompare(b.name, "pt-BR"));

  return {
    year: params.year,
    month: params.month,
    daysInMonth: params.daysInMonth,
    employeeCount: params.employeeCount,
    demand,
    meta,
    remainderGaps,
    coverageShiftCodes: codes,
    employeeCountByMonth,
    employees,
  };
}
