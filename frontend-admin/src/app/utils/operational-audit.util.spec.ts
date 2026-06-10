import type { ScheduleCellData } from '../models/schedule-grid.models';
import {
  classifyAuditViolation,
  computeCoverageGapsByDay,
  computeCoveragePercents,
  computeEmployeeStatus,
  computeGridAuditTotals,
  enrichGridAudit,
  evaluateEmployeeOperationalStatus,
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
        statusReason: null,
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

  it('5. STATUS OK para 11 folgas (não gera ATENÇÃO)', () => {
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
        statusReason: null,
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
    const evaluation = evaluateEmployeeOperationalStatus(
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
        statusReason: null,
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
    expect(evaluation.statusReason).toBeNull();
  });

  it('5c. STATUS ATENÇÃO para 13+ folgas PAO', () => {
    const evaluation = evaluateEmployeeOperationalStatus(
      {
        t6: 7,
        t7: 7,
        t8: 6,
        nd: 0,
        turnos: 17,
        diasTrabalhados: 18,
        folgas: 13,
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
        statusReason: null,
        voos: 0,
        simuladores: 0,
        cursos: 0,
        cma: 0,
        outros: 0,
      },
      'PAO',
      31,
      [],
      'p1',
      'PAO',
    );
    expect(evaluation.status).toBe('ATENÇÃO');
    expect(evaluation.statusReason).toBe('FOLGAS_PAO_ABOVE_MAX (13)');
  });

  it('5d. 11–12 folgas ignoram violação FOLGAS PAO no status', () => {
    const evaluation = evaluateEmployeeOperationalStatus(
      {
        t6: 7,
        t7: 7,
        t8: 6,
        nd: 0,
        turnos: 19,
        diasTrabalhados: 19,
        folgas: 12,
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
        statusReason: null,
        voos: 0,
        simuladores: 0,
        cursos: 0,
        cma: 0,
        outros: 0,
      },
      'PAO',
      31,
      [{ severity: 'MÉDIA', ruleCode: 'FOLGAS PAO', employee: 'PAO', employeeId: 'p1' }],
      'p1',
      'PAO',
    );
    expect(evaluation.status).toBe('OK');
    expect(evaluation.statusReason).toBeNull();
  });

  it('5b. faixa saudável PAO: 20 dias + 12 folgas + maxConsec 5 = OK', () => {
    const evaluation = evaluateEmployeeOperationalStatus(
      {
        t6: 7,
        t7: 7,
        t8: 6,
        nd: 0,
        turnos: 20,
        diasTrabalhados: 20,
        folgas: 12,
        folgaSocial: 2,
        folgaSocialOk: true,
        fa: 0,
        fani: 0,
        fp: 0,
        ferias: 0,
        vooDisp: 0,
        disponivel: 0,
        maxConsec: 5,
        status: 'OK',
        statusReason: null,
        voos: 0,
        simuladores: 0,
        cursos: 0,
        cma: 0,
        outros: 0,
      },
      'PAO',
      31,
      [],
      'p1',
      'PAO',
    );
    expect(evaluation.status).toBe('OK');
    expect(evaluation.statusReason).toBeNull();
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
        statusReason: null,
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
    expect(
      evaluateEmployeeOperationalStatus(
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
          statusReason: null,
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
      ).statusReason,
    ).toBe('FOLGAS_PAO_BELOW_MIN (9)');
  });

  it('6a. APAO OK com monofolga na grade e faixa saudável', () => {
    const emp: Employee = {
      id: 'a1',
      name: 'APAO X',
      type: 'APAO',
      roleId: 'r1',
      cargoCode: 'APAO',
      cargoName: 'APAO',
      seniorityNumber: 1,
      active: true,
    };
    const cells: ScheduleCellData[] = Array.from({ length: 30 }, (_, i) => {
      if (i === 9) return { display: 'FOLGA', kind: 'folga' };
      return workCell('T1');
    });
    const evaluation = evaluateEmployeeOperationalStatus(
      {
        t6: 0,
        t7: 0,
        t8: 0,
        nd: 0,
        turnos: 25,
        diasTrabalhados: 25,
        folgas: 5,
        folgaSocial: 0,
        folgaSocialOk: true,
        fa: 0,
        fani: 0,
        fp: 0,
        ferias: 0,
        vooDisp: 0,
        disponivel: 0,
        maxConsec: 6,
        status: 'OK',
        statusReason: null,
        voos: 0,
        simuladores: 0,
        cursos: 0,
        cma: 0,
        outros: 0,
      },
      'APAO',
      30,
      [{ severity: 'WARNING', ruleCode: 'MONOFOLGA', employee: 'APAO X' }],
      'a1',
      'APAO X',
      cells,
      2026,
      6,
    );
    expect(evaluation.status).toBe('OK');
    expect(evaluation.statusReason).toBeNull();
    void emp;
  });

  it('6a3. APAO OK ignora FOLGAS PEDIDAS (regra exclusiva de PAO)', () => {
    const evaluation = evaluateEmployeeOperationalStatus(
      {
        t6: 0,
        t7: 0,
        t8: 0,
        nd: 0,
        turnos: 24,
        diasTrabalhados: 24,
        folgas: 6,
        folgaSocial: 0,
        folgaSocialOk: true,
        fa: 4,
        fani: 0,
        fp: 2,
        ferias: 0,
        vooDisp: 0,
        disponivel: 0,
        maxConsec: 6,
        status: 'OK',
        statusReason: null,
        voos: 0,
        simuladores: 0,
        cursos: 0,
        cma: 0,
        outros: 0,
      },
      'APAO',
      30,
      [
        { severity: 'WARNING', ruleCode: 'FOLGAS PEDIDAS', employee: 'Cesar Rocha' },
        { severity: 'WARNING', ruleCode: 'MONOFOLGA', employee: 'Cesar Rocha' },
      ],
      'a1',
      'Cesar Rocha',
    );
    expect(evaluation.status).toBe('OK');
    expect(evaluation.statusReason).toBeNull();
  });

  it('6a2. APAO OK com 4+ folgas e mais de 24 dias trabalhados (sem monofolga)', () => {
    const evaluation = evaluateEmployeeOperationalStatus(
      {
        t6: 5,
        t7: 5,
        t8: 5,
        nd: 0,
        turnos: 25,
        diasTrabalhados: 25,
        folgas: 5,
        folgaSocial: 0,
        folgaSocialOk: true,
        fa: 4,
        fani: 0,
        fp: 0,
        ferias: 0,
        vooDisp: 0,
        disponivel: 0,
        maxConsec: 6,
        status: 'OK',
        statusReason: null,
        voos: 0,
        simuladores: 0,
        cursos: 0,
        cma: 0,
        outros: 0,
      },
      'APAO',
      30,
      [{ severity: 'WARNING', ruleCode: 'MONOFOLGA', employee: 'APAO X' }],
      'a1',
      'APAO X',
    );
    expect(evaluation.status).toBe('OK');
    expect(evaluation.statusReason).toBeNull();
  });

  it('6b. monofolga some quando folga adjacente é alocada na grade', () => {
    const emp: Employee = {
      id: 'p1',
      name: 'PAO A',
      type: 'PAO',
      roleId: 'r1',
      cargoCode: 'PAO',
      cargoName: 'PAO',
      seniorityNumber: 1,
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [],
      preAllocations: [
        { id: '1', scheduleMonthId: 'm', employeeId: 'p1', date: '2026-06-14T00:00:00.000Z', label: 'FOLGA PEDIDA', employee: emp },
        { id: '2', scheduleMonthId: 'm', employeeId: 'p1', date: '2026-06-15T00:00:00.000Z', label: 'FOLGA', employee: emp },
      ],
      operationalCadastros: [],
    });
    const enriched = enrichGridAudit(grid, [
      { severity: 'WARNING', ruleCode: 'MONOFOLGA', employee: 'PAO A' },
    ]);
    const row = enriched.groups[0]?.rows[0];
    expect(row?.summary.statusReason).not.toBe('MONOFOLGA');
  });

  it('7. motivo CRÍTICO por violação individual classificada', () => {
    expect(classifyAuditViolation({ severity: 'ALTA', ruleCode: 'TRABALHO EM FÉRIAS', employee: 'X' })).toBe(
      'CRITICAL',
    );
    const evaluation = evaluateEmployeeOperationalStatus(
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
        vooDisp: 0,
        disponivel: 0,
        maxConsec: 6,
        status: 'OK',
        statusReason: null,
        voos: 0,
        simuladores: 0,
        cursos: 0,
        cma: 0,
        outros: 0,
      },
      'PAO',
      30,
      [{ severity: 'CRITICAL', ruleCode: 'TRABALHO EM FÉRIAS', employee: 'PAO Test', employeeId: 'p1' }],
      'p1',
      'PAO Test',
    );
    expect(evaluation.status).toBe('CRÍTICO');
    expect(evaluation.statusReason).toBe('TRABALHO_EM_FÉRIAS');
  });

  it('7b. 12 folgas na faixa saudável = OK verde', () => {
    const evaluation = evaluateEmployeeOperationalStatus(
      {
        t6: 7,
        t7: 7,
        t8: 6,
        nd: 0,
        turnos: 18,
        diasTrabalhados: 20,
        folgas: 12,
        folgaSocial: 2,
        folgaSocialOk: true,
        fa: 0,
        fani: 0,
        fp: 3,
        ferias: 0,
        vooDisp: 0,
        disponivel: 0,
        maxConsec: 5,
        status: 'OK',
        statusReason: null,
        voos: 0,
        simuladores: 0,
        cursos: 0,
        cma: 0,
        outros: 0,
      },
      'PAO',
      31,
      [],
      'p1',
      'Lucas',
    );
    expect(evaluation.status).toBe('OK');
    expect(evaluation.statusReason).toBeNull();
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

  it('9b. computeCoverageGapsByDay lista dias sem T6/T7/T8', () => {
    const emp: Employee = {
      id: 'p1',
      name: 'PAO',
      type: 'PAO',
      roleId: 'r1',
      cargoCode: 'PAO',
      cargoName: 'PAO',
      active: true,
    };
    const gaps = computeCoverageGapsByDay(
      3,
      [
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
          date: '2026-06-01T00:00:00.000Z',
          shiftCode: 'T7',
          label: null,
          source: 'generated',
          employee: emp,
        },
        {
          id: '3',
          scheduleMonthId: 'm',
          employeeId: 'p1',
          date: '2026-06-01T00:00:00.000Z',
          shiftCode: 'T8',
          label: null,
          source: 'generated',
          employee: emp,
        },
      ],
      new Set(['p1']),
    );
    expect(gaps[1]).toBeUndefined();
    expect(gaps[2]).toEqual(['T6', 'T7', 'T8']);
    expect(gaps[3]).toEqual(['T6', 'T7', 'T8']);
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
