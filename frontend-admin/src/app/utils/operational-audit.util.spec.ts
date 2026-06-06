import type { ScheduleCellData } from '../models/schedule-grid.models';
import {
  computeCoveragePercents,
  computeEmployeeStatus,
  computeGridAuditTotals,
  enrichGridAudit,
  maxConsecutiveWorkDays,
  turnosTooltip,
} from './operational-audit.util';
import { buildScheduleGrid } from './schedule-cell.mapper';
import type { Employee } from '../models/api.models';

function workCell(display: string): ScheduleCellData {
  return { display, kind: 'shift' };
}

function emptyCell(): ScheduleCellData {
  return { display: '', kind: 'empty' };
}

describe('operational-audit.util', () => {
  it('1. VOO DISP conta dias vazios', () => {
    const emp: Employee = {
      id: 'p1',
      name: 'PAO',
      type: 'PAO',
      roleId: 'r1',
      cargoCode: 'PAO',
      cargoName: 'PAO',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [
        {
          id: '1',
          scheduleMonthId: 'm',
          employeeId: 'p1',
          date: '2026-06-01T00:00:00.000Z',
          shiftCode: 'T6',
          label: null,
          source: 'generated',
          employee: emp,
        },
      ],
      preAllocations: [],
    });
    const enriched = enrichGridAudit(grid);
    expect(enriched.groups[0].rows[0].summary.vooDisp).toBe(29);
  });

  it('2. FANI no resumo enriquecido', () => {
    const emp: Employee = {
      id: 'p1',
      name: 'PAO',
      type: 'PAO',
      roleId: 'r1',
      cargoCode: 'PAO',
      cargoName: 'PAO',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [
        {
          id: '1',
          scheduleMonthId: 'm',
          employeeId: 'p1',
          date: '2026-06-15T12:00:00.000Z',
          shiftCode: '',
          label: 'FOLGA ANIVERSÁRIO',
          source: 'GENERATOR',
        },
      ],
      preAllocations: [],
    });
    const enriched = enrichGridAudit(grid);
    expect(enriched.groups[0].rows[0].summary.fani).toBe(1);
  });

  it('3. MAX CONSEC calcula sequência', () => {
    const cells = [
      workCell('T6'),
      workCell('T7'),
      workCell('T8'),
      emptyCell(),
      workCell('T6'),
    ];
    expect(maxConsecutiveWorkDays(cells, 2026, 6)).toBe(3);
  });

  it('4. STATUS OK para PAO regular', () => {
    const status = computeEmployeeStatus(
      {
        t6: 7,
        t7: 7,
        t8: 6,
        nd: 0,
        turnos: 20,
        diasTrabalhados: 20,
        folgas: 10,
        folgaSocial: 2,
        folgaSocialOk: true,
        fa: 0,
        fani: 0,
        fp: 0,
        ferias: 0,
        vooDisp: 5,
        disponivel: 5,
        maxConsec: 4,
        status: 'OK',
        voos: 0,
        simuladores: 0,
        cursos: 0,
        cma: 0,
        outros: 0,
      },
      'PAO',
      30,
      [],
      'p1',
      'PAO',
    );
    expect(status).toBe('OK');
  });

  it('5. STATUS ATENÇÃO para 11 folgas', () => {
    const status = computeEmployeeStatus(
      {
        t6: 7,
        t7: 7,
        t8: 6,
        nd: 0,
        turnos: 19,
        diasTrabalhados: 19,
        folgas: 11,
        folgaSocial: 2,
        folgaSocialOk: true,
        fa: 0,
        fani: 0,
        fp: 0,
        ferias: 0,
        vooDisp: 0,
        disponivel: 0,
        maxConsec: 4,
        status: 'OK',
        voos: 0,
        simuladores: 0,
        cursos: 0,
        cma: 0,
        outros: 0,
      },
      'PAO',
      30,
      [],
      'p1',
      'PAO',
    );
    expect(status).toBe('ATENÇÃO');
  });

  it('6. STATUS CRÍTICO para folgas insuficientes', () => {
    const status = computeEmployeeStatus(
      {
        t6: 7,
        t7: 7,
        t8: 6,
        nd: 0,
        turnos: 21,
        diasTrabalhados: 21,
        folgas: 9,
        folgaSocial: 2,
        folgaSocialOk: true,
        fa: 0,
        fani: 0,
        fp: 0,
        ferias: 0,
        vooDisp: 0,
        disponivel: 0,
        maxConsec: 4,
        status: 'OK',
        voos: 0,
        simuladores: 0,
        cursos: 0,
        cma: 0,
        outros: 0,
      },
      'PAO',
      30,
      [{ severity: 'WARNING', ruleCode: 'MONOFOLGA', employee: 'PAO' }],
      'p1',
      'PAO',
    );
    expect(status).toBe('CRÍTICO');
  });

  it('8. totalizadores batem com linhas', () => {
    const emp: Employee = {
      id: 'p1',
      name: 'PAO',
      type: 'PAO',
      roleId: 'r1',
      cargoCode: 'PAO',
      cargoName: 'PAO',
      active: true,
    };
    const grid = enrichGridAudit(
      buildScheduleGrid({
        year: 2026,
        month: 6,
        employees: [emp],
        assignments: [
          {
            id: '1',
            scheduleMonthId: 'm',
            employeeId: 'p1',
            date: '2026-06-01T00:00:00.000Z',
            shiftCode: 'T6',
            label: null,
            source: 'generated',
            employee: emp,
          },
        ],
        preAllocations: [],
      }),
    );
    const totals = computeGridAuditTotals(grid, [
      {
        id: '1',
        scheduleMonthId: 'm',
        employeeId: 'p1',
        date: '2026-06-01T00:00:00.000Z',
        shiftCode: 'T6',
        label: null,
        source: 'generated',
        employee: emp,
      },
    ]);
    expect(totals.totalTurnos).toBe(grid.groups[0].rows[0].summary.turnos);
    expect(totals.totalPaos).toBe(1);
  });

  it('9. cobertura T6 percentual', () => {
    const emp: Employee = {
      id: 'p1',
      name: 'PAO',
      type: 'PAO',
      roleId: 'r1',
      cargoCode: 'PAO',
      cargoName: 'PAO',
      active: true,
    };
    const pct = computeCoveragePercents(2026, 6, 30, [
      {
        id: '1',
        scheduleMonthId: 'm',
        employeeId: 'p1',
        date: '2026-06-01T00:00:00.000Z',
        shiftCode: 'T6',
        label: null,
        source: 'generated',
        employee: emp,
      },
      {
        id: '2',
        scheduleMonthId: 'm',
        employeeId: 'p1',
        date: '2026-06-02T00:00:00.000Z',
        shiftCode: 'T6',
        label: null,
        source: 'generated',
        employee: emp,
      },
    ], new Set(['p1']));
    expect(pct.t6).toBe(7);
  });

  it('turnos tooltip detalha T6/T7/T8', () => {
    expect(turnosTooltip({ t6: 5, t7: 4, t8: 3 } as never)).toContain('T6: 5');
  });
});
