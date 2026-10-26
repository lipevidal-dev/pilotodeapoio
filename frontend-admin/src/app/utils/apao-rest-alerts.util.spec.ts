import type { Shift } from '../models/api.models';
import type {
  EmployeeRowData,
  ScheduleCellData,
  ScheduleGridData,
  ScheduleGridGroup,
} from '../models/schedule-grid.models';
import { computeApaoRestAlerts, groupApaoRestAlertsByDate } from './apao-rest-alerts.util';

const shifts: Shift[] = [
  {
    id: 't1',
    code: 'T1',
    name: 'Turno 1 APAO',
    startTime: '00:00',
    endTime: '06:00',
    roleType: 'APAO',
    active: true,
    displayOrder: 1,
    mandatoryCoverage: false,
    requiresT8PairNd: false,
    coverageType: 'REQUIRED',
    durationHours: 6,
  },
  {
    id: 't4',
    code: 'T4',
    name: 'Turno 4 APAO',
    startTime: '14:00',
    endTime: '22:00',
    roleType: 'APAO',
    active: true,
    displayOrder: 4,
    mandatoryCoverage: false,
    requiresT8PairNd: false,
    coverageType: 'REQUIRED',
    durationHours: 8,
  },
  {
    id: 't6',
    code: 'T6',
    name: 'Turno 6 PAO',
    startTime: '06:00',
    endTime: '14:00',
    roleType: 'PAO',
    active: true,
    displayOrder: 6,
    mandatoryCoverage: true,
    requiresT8PairNd: false,
    coverageType: 'REQUIRED',
    durationHours: 8,
  },
];

function cell(display: string, kind: ScheduleCellData['kind']): ScheduleCellData {
  return { display, kind };
}

function row(
  type: 'PAO' | 'APAO',
  name: string,
  cells: ScheduleCellData[],
  leadCells?: ScheduleCellData[],
): EmployeeRowData {
  return {
    employeeId: name.toLowerCase().replace(/\s/g, '-'),
    name,
    type,
    cells,
    leadCells,
    summary: {} as EmployeeRowData['summary'],
  };
}

function grid(groups: ScheduleGridGroup[], withLead = false): ScheduleGridData {
  const currentColumns = [1, 2, 3, 4].map((day) => ({
    isoDate: `2026-07-${String(day).padStart(2, '0')}`,
    day,
    year: 2026,
    month: 7,
    weekdayLabel: '',
    isWeekend: false,
    isLead: false,
    isMonthStart: day === 1,
    leadIndex: -1,
  }));
  return {
    year: 2026,
    month: 7,
    daysInMonth: 4,
    dayNumbers: [1, 2, 3, 4],
    weekdayLabels: ['', '', '', ''],
    columns: withLead
      ? [
          {
            isoDate: '2026-06-30',
            day: 30,
            year: 2026,
            month: 6,
            weekdayLabel: '',
            isWeekend: false,
            isLead: true,
            isMonthStart: false,
            leadIndex: 0,
          },
          ...currentColumns,
        ]
      : currentColumns,
    leadDayCount: withLead ? 1 : 0,
    groups,
  };
}

describe('computeApaoRestAlerts', () => {
  it('gera alerta quando o descanso entre turnos APAO é menor que 11h', () => {
    const result = computeApaoRestAlerts(
      grid([
        {
          type: 'APAO',
          label: 'APAO',
          rows: [
            row('APAO', 'Ana APAO', [
              cell('T4', 'shift'),
              cell('T1', 'shift'),
              cell('', 'empty'),
              cell('', 'empty'),
            ]),
          ],
        },
      ]),
      shifts,
    );

    const alert = result.find((item) => item.kind === 'SHIFT_REST_11H');
    expect(alert?.count).toBe(1);
    expect(alert?.violations[0]?.restHours).toBe(2);
    expect(alert?.tooltip).toContain('Ana APAO');
    expect(alert?.tooltip).toContain('menor que 11 horas');
  });

  it('gera alerta de 36h para turno, folga e novo turno', () => {
    const result = computeApaoRestAlerts(
      grid([
        {
          type: 'APAO',
          label: 'APAO',
          rows: [
            row('APAO', 'Bia APAO', [
              cell('T4', 'shift'),
              cell('F', 'folga'),
              cell('T1', 'shift'),
              cell('', 'empty'),
            ]),
          ],
        },
      ]),
      shifts,
    );

    const alert = result.find((item) => item.kind === 'POST_DAY_OFF_36H');
    expect(alert?.count).toBe(1);
    expect(alert?.violations[0]?.restHours).toBe(26);
    expect(alert?.tooltip).toContain('turno + folga');
  });

  it('não alerta quando os períodos mínimos são respeitados', () => {
    const result = computeApaoRestAlerts(
      grid([
        {
          type: 'APAO',
          label: 'APAO',
          rows: [
            row('APAO', 'Clara APAO', [
              cell('T1', 'shift'),
              cell('T4', 'shift'),
              cell('F', 'folga'),
              cell('', 'empty'),
            ]),
          ],
        },
      ]),
      shifts,
    );

    expect(result).toEqual([]);
  });

  it('ignora completamente o grupo PAO', () => {
    const result = computeApaoRestAlerts(
      grid([
        {
          type: 'PAO',
          label: 'PAO',
          rows: [
            row('PAO', 'PAO Teste', [
              cell('T4', 'shift'),
              cell('T1', 'shift'),
              cell('', 'empty'),
              cell('', 'empty'),
            ]),
          ],
        },
      ]),
      shifts,
    );

    expect(result).toEqual([]);
  });

  it('considera o último dia do mês anterior para alertar o dia 1', () => {
    const result = computeApaoRestAlerts(
      grid(
        [
          {
            type: 'APAO',
            label: 'APAO',
            rows: [
              row(
                'APAO',
                'Dora APAO',
                [
                  cell('T1', 'shift'),
                  cell('', 'empty'),
                  cell('', 'empty'),
                  cell('', 'empty'),
                ],
                [cell('T4', 'shift')],
              ),
            ],
          },
        ],
        true,
      ),
      shifts,
    );

    const alert = result.find((item) => item.kind === 'SHIFT_REST_11H');
    expect(alert?.count).toBe(1);
    expect(alert?.violations[0]?.previousDate).toBe('2026-06-30');
    expect(alert?.violations[0]?.nextDate).toBe('2026-07-01');
  });

  it('coloca o alerta na coluna do próximo turno', () => {
    const shiftRest = computeApaoRestAlerts(
      grid([
        {
          type: 'APAO',
          label: 'APAO',
          rows: [
            row('APAO', 'Ana APAO', [
              cell('T4', 'shift'),
              cell('T1', 'shift'),
              cell('', 'empty'),
              cell('', 'empty'),
            ]),
          ],
        },
      ]),
      shifts,
    );
    const afterDayOff = computeApaoRestAlerts(
      grid([
        {
          type: 'APAO',
          label: 'APAO',
          rows: [
            row('APAO', 'Bia APAO', [
              cell('T4', 'shift'),
              cell('F', 'folga'),
              cell('T1', 'shift'),
              cell('', 'empty'),
            ]),
          ],
        },
      ]),
      shifts,
    );

    expect(groupApaoRestAlertsByDate(shiftRest).get('2026-07-02')?.[0]?.kind).toBe('SHIFT_REST_11H');
    expect(groupApaoRestAlertsByDate(shiftRest).has('2026-07-01')).toBe(false);
    expect(groupApaoRestAlertsByDate(afterDayOff).get('2026-07-03')?.[0]?.kind).toBe('POST_DAY_OFF_36H');
    expect(groupApaoRestAlertsByDate(afterDayOff).has('2026-07-01')).toBe(false);
  });
});
