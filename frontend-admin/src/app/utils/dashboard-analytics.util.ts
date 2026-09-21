import { Chart, type ChartData, type ChartOptions } from 'chart.js';
import type {
  Employee,
  EmployeeMonthlyShiftPreferenceRow,
  ScheduleAssignmentRow,
  ScheduleMonthResponse,
} from '../models/api.models';
import { mapLabelToCell, mapShiftToCell } from './schedule-cell.mapper';
import { isRateioShiftCode } from './shift-code.util';

const DASHBOARD_BAR_VALUES_PLUGIN_ID = 'dashboardBarValueLabels';

/** Plugin: desenha o valor total em cima de cada coluna do gráfico. */
function ensureBarValueLabelsPlugin(): void {
  if (Chart.registry.plugins.get(DASHBOARD_BAR_VALUES_PLUGIN_ID)) return;
  Chart.register({
    id: DASHBOARD_BAR_VALUES_PLUGIN_ID,
    afterDatasetsDraw(chart) {
      const conf = (chart.options.plugins as Record<string, { display?: boolean }> | undefined)
        ?.['dashboardBarValues'];
      if (!conf?.display) return;
      const { ctx } = chart;
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        const meta = chart.getDatasetMeta(datasetIndex);
        if (meta.hidden) return;
        meta.data.forEach((element, index) => {
          const value = dataset.data[index];
          if (value == null || typeof value === 'object') return;
          const { x, y } = element.getProps(['x', 'y'], true);
          ctx.save();
          ctx.fillStyle = '#2d2d2d';
          ctx.font = "bold 11px 'Segoe UI', system-ui, sans-serif";
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(String(value), x, y - 4);
          ctx.restore();
        });
      });
    },
  });
}

ensureBarValueLabelsPlugin();

export type DashboardRoleFilter = 'ALL' | 'PAO' | 'APAO';
export type DashboardCategoryFilter = 'ALL' | 'SHIFTS' | 'OFF' | 'OTHER';

export interface DashboardFilters {
  year: number;
  month: number;
  employeeId: string | null;
  role: DashboardRoleFilter;
  category: DashboardCategoryFilter;
}

export interface DashboardKpi {
  label: string;
  value: string | number;
  hint?: string;
  tone: 'orange' | 'dark' | 'success' | 'warning' | 'neutral';
}

export interface DashboardAnalytics {
  kpis: DashboardKpi[];
  shiftDistribution: ChartData<'doughnut'>;
  shiftDistributionOptions: ChartOptions<'doughnut'>;
  dailyTrend: ChartData<'line'>;
  dailyTrendOptions: ChartOptions<'line'>;
  shiftBar: ChartData<'bar'>;
  shiftBarOptions: ChartOptions<'bar'>;
  employeeWorkload: ChartData<'bar'>;
  employeeWorkloadOptions: ChartOptions<'bar'>;
  portalPreferences: ChartData<'doughnut'>;
  portalPreferencesOptions: ChartOptions<'doughnut'>;
}

export const GOL_CHART_PALETTE = [
  '#f15a22',
  '#d94e1a',
  '#ff9a3c',
  '#2d2d2d',
  '#6b7280',
  '#16a34a',
  '#3b82f6',
  '#f59e0b',
  '#94a3b8',
  '#fb923c',
];

const RATEIO_COLORS: Record<string, string> = {
  T6: '#f15a22',
  T7: '#d94e1a',
  T8: '#ff9a3c',
  T9: '#2d2d2d',
};

function legendOptions() {
  return {
    labels: {
      color: '#2d2d2d',
      font: { family: "'Segoe UI', system-ui, sans-serif", size: 11 },
      boxWidth: 12,
    },
  };
}

function axisGridColor() {
  return 'rgba(45, 45, 45, 0.06)';
}

function employeeRole(emp: Employee): 'PAO' | 'APAO' | 'OTHER' {
  const type = (emp.type ?? '').toUpperCase();
  if (type === 'APAO') return 'APAO';
  if (type === 'PAO') return 'PAO';
  const code = (emp.cargoCode ?? '').toUpperCase();
  if (code.includes('APAO')) return 'APAO';
  if (code.includes('PAO')) return 'PAO';
  return 'OTHER';
}

/** Total de Turnos: só PAO de rateio — sem APAO e sem comandantes. */
function isRateioPaoForWorkloadChart(emp: Employee): boolean {
  if (!emp.active) return false;
  if (emp.isCmte) return false;
  return employeeRole(emp) === 'PAO';
}

function classifyBucket(row: ScheduleAssignmentRow): string {
  const code = row.shiftCode?.toUpperCase() ?? '';
  if (isRateioShiftCode(code)) return code;
  if (code === 'ND') return 'ND';
  const cell = row.label ? mapLabelToCell(row.label, null) : mapShiftToCell(code);
  switch (cell.kind) {
    case 'shift':
    case 'instruction-shift':
      return code || 'Turno';
    case 'folga':
      return 'Folga';
    case 'fs':
      return 'Folga social';
    case 'fp':
      return 'Folga pedida';
    case 'fa':
      return 'Folga agrupada';
    case 'ferias':
      return 'Férias';
    case 'voo':
      return 'Voo';
    case 'nd':
      return 'ND';
    default:
      return cell.display || 'Outros';
  }
}

function isShiftBucket(bucket: string): boolean {
  return isRateioShiftCode(bucket);
}

function isOffBucket(bucket: string): boolean {
  return /folga|férias|ferias/i.test(bucket);
}

function matchesCategory(bucket: string, category: DashboardCategoryFilter): boolean {
  if (category === 'ALL') return true;
  if (category === 'SHIFTS') return isShiftBucket(bucket);
  if (category === 'OFF') return isOffBucket(bucket);
  return !isShiftBucket(bucket) && !isOffBucket(bucket);
}

function filterAssignments(
  data: ScheduleMonthResponse,
  filters: DashboardFilters,
): ScheduleAssignmentRow[] {
  const employeeMap = new Map(data.employees.map((e) => [e.id, e]));
  return data.assignments.filter((row) => {
    if (filters.employeeId && row.employeeId !== filters.employeeId) return false;
    const emp = employeeMap.get(row.employeeId);
    if (!emp) return false;
    if (filters.role !== 'ALL' && employeeRole(emp) !== filters.role) return false;
    const bucket = classifyBucket(row);
    return matchesCategory(bucket, filters.category);
  });
}

function colorForBucket(bucket: string, index: number): string {
  return RATEIO_COLORS[bucket] ?? GOL_CHART_PALETTE[index % GOL_CHART_PALETTE.length];
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function buildShiftDistribution(filtered: ScheduleAssignmentRow[]): ChartData<'doughnut'> {
  const counts = new Map<string, number>();
  for (const row of filtered) {
    const bucket = classifyBucket(row);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const labels = [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  return {
    labels,
    datasets: [
      {
        data: labels.map((l) => counts.get(l) ?? 0),
        backgroundColor: labels.map((l, i) => colorForBucket(l, i)),
        borderWidth: 2,
        borderColor: '#ffffff',
      },
    ],
  };
}

function buildDailyTrend(
  filtered: ScheduleAssignmentRow[],
  year: number,
  month: number,
): ChartData<'line'> {
  const days = daysInMonth(year, month);
  const shiftByDay = Array.from({ length: days }, () => 0);
  const offByDay = Array.from({ length: days }, () => 0);

  for (const row of filtered) {
    const day = Number(row.date.slice(8, 10));
    if (!Number.isFinite(day) || day < 1 || day > days) continue;
    const bucket = classifyBucket(row);
    const idx = day - 1;
    if (isShiftBucket(bucket)) shiftByDay[idx] += 1;
    else if (isOffBucket(bucket)) offByDay[idx] += 1;
  }

  const labels = Array.from({ length: days }, (_, i) => `${i + 1}`);
  return {
    labels,
    datasets: [
      {
        label: 'Turnos rateio (T6–T9)',
        data: shiftByDay,
        borderColor: '#f15a22',
        backgroundColor: 'rgba(241, 90, 34, 0.15)',
        fill: true,
        tension: 0.25,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: '#f15a22',
      },
      {
        label: 'Folgas e férias',
        data: offByDay,
        borderColor: '#6b7280',
        backgroundColor: 'rgba(107, 114, 128, 0.1)',
        fill: true,
        tension: 0.25,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: '#6b7280',
      },
    ],
  };
}

function buildShiftBar(filtered: ScheduleAssignmentRow[]): ChartData<'bar'> {
  const rateio = ['T6', 'T7', 'T8', 'T9'] as const;
  const counts = Object.fromEntries(rateio.map((c) => [c, 0])) as Record<(typeof rateio)[number], number>;
  for (const row of filtered) {
    const code = row.shiftCode?.toUpperCase() ?? '';
    if (isRateioShiftCode(code)) counts[code as (typeof rateio)[number]] += 1;
  }
  return {
    labels: [...rateio],
    datasets: [
      {
        label: 'Alocações',
        data: rateio.map((c) => counts[c]),
        backgroundColor: rateio.map((c) => RATEIO_COLORS[c]),
        borderRadius: 6,
        maxBarThickness: 48,
      },
    ],
  };
}

function buildEmployeeWorkload(
  filtered: ScheduleAssignmentRow[],
  employees: Employee[],
): ChartData<'bar'> {
  const eligible = employees.filter(isRateioPaoForWorkloadChart);
  const eligibleIds = new Set(eligible.map((e) => e.id));
  const counts = new Map<string, number>();
  for (const emp of eligible) {
    counts.set(emp.id, 0);
  }
  for (const row of filtered) {
    if (!eligibleIds.has(row.employeeId)) continue;
    if (!isShiftBucket(classifyBucket(row))) continue;
    counts.set(row.employeeId, (counts.get(row.employeeId) ?? 0) + 1);
  }
  const nameById = new Map(employees.map((e) => [e.id, e.name]));
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (nameById.get(a[0]) ?? '').localeCompare(nameById.get(b[0]) ?? ''),
  );
  return {
    labels: ranked.map(([id]) => {
      const name = nameById.get(id) ?? id;
      return name.length > 14 ? `${name.slice(0, 12)}…` : name;
    }),
    datasets: [
      {
        label: 'Total de turnos',
        data: ranked.map(([, n]) => n),
        backgroundColor: 'rgba(241, 90, 34, 0.75)',
        borderRadius: 6,
        maxBarThickness: 42,
      },
    ],
  };
}

function buildPortalPreferences(
  preferences: EmployeeMonthlyShiftPreferenceRow[],
): ChartData<'doughnut'> {
  const counts = new Map<string, number>();
  for (const pref of preferences) {
    const code = pref.shiftCode?.toUpperCase() ?? '—';
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const labels = [...counts.keys()];
  return {
    labels,
    datasets: [
      {
        data: labels.map((l) => counts.get(l) ?? 0),
        backgroundColor: labels.map((l, i) => colorForBucket(l, i)),
        borderColor: '#ffffff',
        borderWidth: 2,
      },
    ],
  };
}

function radialChartOptions(cutout = '52%'): ChartOptions<'doughnut'> {
  return {
    // Altura vem do container fixo no SCSS; aspectRatio + CSS forçado causava loop de resize (gráfico "tremendo").
    maintainAspectRatio: false,
    resizeDelay: 150,
    layout: { padding: { top: 2, bottom: 2, left: 4, right: 4 } },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: '#2d2d2d',
          font: { family: "'Segoe UI', system-ui, sans-serif", size: 10 },
          boxWidth: 10,
          padding: 6,
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const value = ctx.parsed ?? 0;
            const total = (ctx.dataset.data as number[]).reduce((s, n) => s + n, 0);
            const pct = total > 0 ? Math.round((value / total) * 100) : 0;
            return ` ${ctx.label}: ${value} (${pct}%)`;
          },
        },
      },
    },
    radius: '78%',
    cutout,
  };
}

function countPortalMatches(
  data: ScheduleMonthResponse,
  preferences: EmployeeMonthlyShiftPreferenceRow[],
): { matched: number; total: number } {
  const prefByEmp = new Map(preferences.map((p) => [p.employeeId, p.shiftCode?.toUpperCase()]));
  let matched = 0;
  let total = 0;
  for (const [employeeId, prefCode] of prefByEmp) {
    if (!prefCode) continue;
    total += 1;
    const hasShift = data.assignments.some(
      (a) =>
        a.employeeId === employeeId &&
        a.shiftCode?.toUpperCase() === prefCode,
    );
    if (hasShift) matched += 1;
  }
  return { matched, total };
}

export function buildDashboardAnalytics(
  data: ScheduleMonthResponse,
  preferences: EmployeeMonthlyShiftPreferenceRow[],
  filters: DashboardFilters,
): DashboardAnalytics {
  const filtered = filterAssignments(data, filters);
  const shiftRows = filtered.filter((r) => isShiftBucket(classifyBucket(r)));
  const portalMatch = countPortalMatches(data, preferences);
  const activeEmployees = data.employees.filter((e) => e.active);
  const paoCount = activeEmployees.filter((e) => employeeRole(e) === 'PAO').length;

  const shiftDistribution = buildShiftDistribution(filtered);
  const dailyTrend = buildDailyTrend(filtered, filters.year, filters.month);
  const shiftBar = buildShiftBar(filtered);
  const employeeWorkload = buildEmployeeWorkload(filtered, data.employees);
  const portalPreferences = buildPortalPreferences(preferences);

  const kpis: DashboardKpi[] = [
    {
      label: 'Alocações filtradas',
      value: filtered.length,
      hint: `${shiftRows.length} turnos rateio`,
      tone: 'orange',
    },
    {
      label: 'Colaboradores ativos',
      value: activeEmployees.length,
      hint: `${paoCount} PAO`,
      tone: 'dark',
    },
    {
      label: 'Prefs. portal atendidas',
      value: portalMatch.total > 0 ? `${portalMatch.matched}/${portalMatch.total}` : '—',
      hint: portalMatch.total > 0 ? 'Com ≥1 dia no turno preferido' : 'Sem prefs. no mês',
      tone: 'neutral',
    },
  ];

  const lineOptions: ChartOptions<'line'> = {
    maintainAspectRatio: false,
    resizeDelay: 150,
    plugins: {
      legend: legendOptions(),
      tooltip: {
        callbacks: {
          title: (items) => {
            const day = items[0]?.label ?? '';
            return `Dia ${day} do mês`;
          },
          label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y} alocação(ões)`,
        },
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Dia do mês',
          color: '#6b7280',
          font: { size: 11, weight: 'bold' },
        },
        ticks: { color: '#6b7280', maxTicksLimit: 16 },
        grid: { color: axisGridColor() },
      },
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'Alocações no dia',
          color: '#6b7280',
          font: { size: 11, weight: 'bold' },
        },
        ticks: { color: '#6b7280', precision: 0 },
        grid: { color: axisGridColor() },
      },
    },
  };

  const shiftBarOptions: ChartOptions<'bar'> = {
    maintainAspectRatio: false,
    resizeDelay: 150,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        ticks: { color: '#6b7280' },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: { color: '#6b7280', precision: 0 },
        grid: { color: axisGridColor() },
      },
    },
  };

  const employeeWorkloadOptions: ChartOptions<'bar'> = {
    maintainAspectRatio: false,
    resizeDelay: 150,
    layout: { padding: { top: 18, bottom: 2, left: 4, right: 4 } },
    plugins: {
      legend: { display: false },
      // plugin custom dashboardBarValueLabels
      dashboardBarValues: { display: true },
      tooltip: {
        callbacks: {
          label: (ctx) => ` Total de turnos: ${ctx.parsed.y}`,
        },
      },
    } as ChartOptions<'bar'>['plugins'],
    scales: {
      x: {
        ticks: {
          color: '#6b7280',
          maxRotation: 60,
          minRotation: 40,
          autoSkip: false,
          font: { size: 10 },
        },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: { color: '#6b7280', precision: 0 },
        grid: { color: axisGridColor() },
        title: {
          display: true,
          text: 'Turnos',
          color: '#6b7280',
          font: { size: 11, weight: 'bold' },
        },
      },
    },
  };

  return {
    kpis,
    shiftDistribution,
    shiftDistributionOptions: radialChartOptions('50%'),
    dailyTrend,
    dailyTrendOptions: lineOptions,
    shiftBar,
    shiftBarOptions,
    employeeWorkload,
    employeeWorkloadOptions,
    portalPreferences,
    portalPreferencesOptions: radialChartOptions('45%'),
  };
}
