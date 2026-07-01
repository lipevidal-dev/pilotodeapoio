import {
  buildScheduleGrid,
  cellKindClass,
  labelDisplayPriority,
  mapCellToCalendarDisplay,
  mapLabelToCell,
  mapShiftToCell,
  resolveScheduleCell,
} from './schedule-cell.mapper';
import type { Employee } from '../models/api.models';

describe('schedule-cell.mapper — cores por turno', () => {
  it('6. turnos T6–T9 usam kind shift', () => {
    for (const code of ['T6', 'T7', 'T8', 'T9', 'T1', 'T2', 'T3', 'T4', 'TX']) {
      expect(mapShiftToCell(code).kind).toBe('shift');
    }
  });

  it('7. cellKindClass aplica classe por código de exibição', () => {
    expect(cellKindClass('shift', 'T6')).toBe('cell-t6');
    expect(cellKindClass('shift', 'T7')).toBe('cell-t7');
    expect(cellKindClass('shift', 'T8')).toBe('cell-t8');
    expect(cellKindClass('shift', 'T9')).toBe('cell-t9');
    expect(cellKindClass('shift', 'T1')).toBe('cell-shift');
    expect(cellKindClass('instruction-shift', 'TI6')).toBe('cell-instruction');
  });

  it('mapeia turno em instrução como TI*', () => {
    const cell = mapShiftToCell('TI7');
    expect(cell.display).toBe('TI7');
    expect(cell.kind).toBe('instruction-shift');
  });

  it('ND permanece separado', () => {
    expect(mapShiftToCell('ND').kind).toBe('nd');
  });

  it('ND gerado em preAllocations aparece na escala visual', () => {
    const emp: Employee = {
      id: 'pao-1',
      name: 'PAO Test',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [
        {
          id: '1',
          scheduleMonthId: 'm1',
          employeeId: 'pao-1',
          date: '2026-06-10T12:00:00.000Z',
          shiftCode: 'T8',
          label: null,
          source: 'GENERATOR',
        },
        {
          id: '2',
          scheduleMonthId: 'm1',
          employeeId: 'pao-1',
          date: '2026-06-11T12:00:00.000Z',
          shiftCode: 'T8',
          label: null,
          source: 'GENERATOR',
        },
      ],
      preAllocations: [
        {
          id: 'nd-1',
          employeeId: 'pao-1',
          date: '2026-06-12T12:00:00.000Z',
          label: 'ND',
        },
      ],
      operationalCadastros: [],
    });
    expect(grid.groups[0].rows[0].cells[11].display).toBe('ND');
    expect(grid.groups[0].rows[0].cells[11].kind).toBe('nd');
    expect(grid.groups[0].rows[0].summary.nd).toBe(1);
  });

  it('VOO gerado em preAllocations aparece na escala visual', () => {
    const emp: Employee = {
      id: 'pao-1',
      name: 'PAO Test',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [],
      preAllocations: [
        {
          id: 'voo-1',
          employeeId: 'pao-1',
          date: '2026-06-08T12:00:00.000Z',
          label: 'VOO',
        },
      ],
      operationalCadastros: [],
    });
    expect(grid.groups[0].rows[0].cells[7].display).toBe('VOO');
    expect(grid.groups[0].rows[0].cells[7].kind).toBe('voo');
  });

  it('ND em preAllocation tem prioridade sobre turno na mesma célula', () => {
    const cell = resolveScheduleCell(
      {
        id: '1',
        scheduleMonthId: 'm1',
        employeeId: 'pao-1',
        date: '2026-06-12T00:00:00.000Z',
        shiftCode: 'T6',
        label: null,
        source: 'GENERATOR',
      },
      [{ label: 'ND' }],
    );
    expect(cell.kind).toBe('nd');
    expect(cell.display).toBe('ND');
  });

  it('8. T1–T4 contam em turnos e dias trabalhados (APAO)', () => {
    const emp: Employee = {
      id: 'apao-1',
      name: 'APAO Test',
      type: 'APAO',
      roleId: 'role-apao',
      cargoCode: 'APAO',
      cargoName: 'Auxiliar de Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [
        { id: '1', scheduleMonthId: 'm1', employeeId: 'apao-1', date: '2026-06-01T00:00:00.000Z', shiftCode: 'T2', label: null, source: 'generated', employee: emp },
        { id: '2', scheduleMonthId: 'm1', employeeId: 'apao-1', date: '2026-06-02T00:00:00.000Z', shiftCode: 'T3', label: null, source: 'generated', employee: emp },
      ],
      preAllocations: [],
    });
    const summary = grid.groups[0].rows[0].summary;
    expect(summary.turnos).toBe(2);
    expect(summary.diasTrabalhados).toBe(2);
  });

  it('9. T9 conta em turnos e dias trabalhados como turno normal', () => {
    const emp: Employee = {
      id: 'pao-t9',
      name: 'PAO T9',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [
        { id: '1', scheduleMonthId: 'm1', employeeId: 'pao-t9', date: '2026-06-01T00:00:00.000Z', shiftCode: 'T7', label: null, source: 'generated', employee: emp },
        { id: '2', scheduleMonthId: 'm1', employeeId: 'pao-t9', date: '2026-06-02T00:00:00.000Z', shiftCode: 'T8', label: null, source: 'generated', employee: emp },
        { id: '3', scheduleMonthId: 'm1', employeeId: 'pao-t9', date: '2026-06-03T00:00:00.000Z', shiftCode: 'T9', label: null, source: 'generated', employee: emp },
      ],
      preAllocations: [],
      shifts: [
        { id: 's-t7', code: 'T7', name: 'T7', startTime: '12:00', endTime: '18:00', roleType: 'PAO', durationHours: 6, active: true, displayOrder: 1, mandatoryCoverage: true, requiresT8PairNd: false, coverageType: 'REQUIRED' },
        { id: 's-t8', code: 'T8', name: 'T8', startTime: '18:00', endTime: '00:00', roleType: 'PAO', durationHours: 6, active: true, displayOrder: 2, mandatoryCoverage: true, requiresT8PairNd: true, coverageType: 'REQUIRED' },
        { id: 's-t9', code: 'T9', name: 'T9', startTime: '10:00', endTime: '18:00', roleType: 'PAO', durationHours: 8, active: true, displayOrder: 3, mandatoryCoverage: false, requiresT8PairNd: false, coverageType: 'PARALLEL' },
      ],
    });
    const summary = grid.groups[0].rows[0].summary;
    expect(summary.turnos).toBe(3);
    expect(summary.diasTrabalhados).toBe(3);
    expect(summary.t7).toBe(1);
    expect(summary.t8).toBe(1);
  });

  it('10. FANI exibe sigla e conta em folgas', () => {
    expect(mapLabelToCell('FOLGA ANIVERSÁRIO').display).toBe('FANI');
    expect(mapLabelToCell('FOLGA ANIVERSÁRIO').kind).toBe('fani');

    const emp: Employee = {
      id: 'pao-1',
      name: 'PAO Test',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [
        {
          id: '1',
          scheduleMonthId: 'm1',
          employeeId: 'pao-1',
          date: '2026-06-15T12:00:00.000Z',
          shiftCode: '',
          label: 'FOLGA ANIVERSÁRIO',
          source: 'GENERATOR',
        },
      ],
      preAllocations: [],
    });
    const summary = grid.groups[0].rows[0].summary;
    expect(summary.fani).toBe(1);
    expect(summary.folgas).toBe(1);
  });

  it('exibe VOO do motor em preAllocation na grade visual', () => {
    const emp: Employee = {
      id: 'pao-1',
      name: 'PAO Test',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [],
      preAllocations: [
        {
          id: 'motor-voo',
          employeeId: 'pao-1',
          date: '2026-06-05T12:00:00.000Z',
          label: 'VOO',
        },
      ],
      operationalCadastros: [],
    });
    expect(grid.groups[0].rows[0].cells[4].kind).toBe('voo');
    expect(grid.groups[0].rows[0].cells[4].display).toBe('VOO');
  });

  it('assignment com label VOO é ignorado sem operationalCadastro', () => {
    const emp: Employee = {
      id: 'pao-1',
      name: 'PAO Test',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [
        {
          id: 'a1',
          scheduleMonthId: 'm1',
          employeeId: 'pao-1',
          date: '2026-06-05T12:00:00.000Z',
          shiftCode: '',
          label: 'VOO',
          source: 'generated',
        },
      ],
      preAllocations: [],
      operationalCadastros: [],
    });
    expect(grid.groups[0].rows[0].cells[4].kind).toBe('empty');
  });

  it('VOO válido via operationalCadastros aparece na escala', () => {
    const emp: Employee = {
      id: 'pao-1',
      name: 'PAO Test',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [],
      preAllocations: [],
      operationalCadastros: [
        {
          id: 'f1',
          employeeId: 'pao-1',
          date: '2026-06-05T12:00:00.000Z',
          label: 'VOO',
          source: 'flight',
          sourceId: 'flight-uuid',
        },
      ],
    });
    expect(grid.groups[0].rows[0].cells[4].display).toBe('VOO');
  });

  it('assignment T9 aparece na grade como turno', () => {
    const emp: Employee = {
      id: 'pao-1',
      name: 'Palombino',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [
        {
          id: 'a-t9',
          scheduleMonthId: 'm1',
          employeeId: 'pao-1',
          date: '2026-06-18T12:00:00.000Z',
          shiftCode: 'T9',
          label: null,
          source: 'MANUAL',
        },
      ],
      preAllocations: [],
      operationalCadastros: [],
    });
    expect(grid.groups[0].rows[0].cells[17].display).toBe('T9');
    expect(grid.groups[0].rows[0].cells[17].kind).toBe('shift');
  });

  it('preAllocation CURSO aparece na grade mesmo sem operationalCadastros', () => {
    const emp: Employee = {
      id: 'pao-1',
      name: 'PAO Test',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [],
      preAllocations: [
        {
          id: 'pre-curso',
          employeeId: 'pao-1',
          date: '2026-06-10T12:00:00.000Z',
          label: 'CURSO',
        },
      ],
      operationalCadastros: [],
    });
    expect(grid.groups[0].rows[0].cells[9].display).toBe('CRS');
    expect(grid.groups[0].rows[0].summary.cursos).toBe(1);
  });

  it('preAllocation FOLGA PEDIDA aparece como FP na grade', () => {
    const emp: Employee = {
      id: 'pao-1',
      name: 'PAO Test',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [],
      preAllocations: [
        {
          id: 'pre-fp',
          employeeId: 'pao-1',
          date: '2026-06-11T12:00:00.000Z',
          label: 'FOLGA PEDIDA',
        },
      ],
      operationalCadastros: [],
    });
    expect(grid.groups[0].rows[0].cells[10].display).toBe('FP');
    expect(grid.groups[0].rows[0].summary.fp).toBe(1);
  });

  it('escala e calendário usam sigla compacta SIM para simulador', () => {
    const full = mapLabelToCell('SIMULADOR');
    const compact = mapCellToCalendarDisplay(full);
    expect(full.display).toBe('SIM');
    expect(compact.display).toBe('SIM');
  });

  it('cadastro operacional FP tem prioridade sobre turno gerado', () => {
    const cell = resolveScheduleCell(
      {
        id: '1',
        scheduleMonthId: 'm1',
        employeeId: 'pao-1',
        date: '2026-06-01T00:00:00.000Z',
        shiftCode: 'T6',
        label: null,
        source: 'generated',
      },
      [{ label: 'FOLGA PEDIDA' }],
    );
    expect(cell.display).toBe('FP');
    expect(cell.kind).toBe('fp');
  });

  it('férias têm prioridade sobre FP no mesmo dia', () => {
    expect(labelDisplayPriority('FÉRIAS')).toBeGreaterThan(labelDisplayPriority('FOLGA PEDIDA'));
    const cell = resolveScheduleCell(undefined, [
      { label: 'FOLGA PEDIDA' },
      { label: 'FÉRIAS' },
    ]);
    expect(cell.kind).toBe('ferias');
  });

  it('OUTRO exibe OTR com descrição no title', () => {
    expect(mapLabelToCell('OUTRO', 'Reunião interna').display).toBe('OTR');
    expect(mapLabelToCell('OUTRO', 'Reunião interna').title).toBe('Reunião interna');
    expect(mapCellToCalendarDisplay(mapLabelToCell('OUTRO', 'Treinamento')).display).toBe('OTR');

    const emp: Employee = {
      id: 'pao-1',
      name: 'PAO Test',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [],
      preAllocations: [
        {
          id: 'outro-1',
          employeeId: 'pao-1',
          date: '2026-06-09T12:00:00.000Z',
          label: 'OUTRO',
          notes: 'Visita médica',
        },
      ],
      operationalCadastros: [],
    });
    const cell = grid.groups[0].rows[0].cells[8];
    expect(cell.display).toBe('OTR');
    expect(cell.kind).toBe('outro');
    expect(cell.title).toBe('Visita médica');
  });

  it('operationalCadastros exibe FER no último dia inclusivo do período', () => {
    const emp: Employee = {
      id: 'pao-1',
      name: 'PAO Test',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const vacationCadastros = Array.from({ length: 15 }, (_, i) => ({
      id: `vac-${i}`,
      employeeId: 'pao-1',
      date: `2026-06-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`,
      label: 'FÉRIAS',
      source: 'vacation' as const,
    }));
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [],
      preAllocations: [],
      operationalCadastros: vacationCadastros,
    });
    const cells = grid.groups[0].rows[0].cells;
    expect(cells[0].display).toBe('FER');
    expect(cells[14].display).toBe('FER');
    expect(cells[15].kind).toBe('empty');
    expect(grid.groups[0].rows[0].summary.ferias).toBe(15);
  });

  it('FP sábado+domingo usa fundo verde (folga social) mantendo sigla FP', () => {
    const emp: Employee = {
      id: 'pao-1',
      name: 'Lucas Flavio',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 7,
      employees: [emp],
      assignments: [],
      preAllocations: [],
      operationalCadastros: [
        {
          id: 'fp-sat',
          employeeId: 'pao-1',
          date: '2026-07-11T12:00:00.000Z',
          label: 'FOLGA PEDIDA',
          source: 'requested_day_off',
        },
        {
          id: 'fp-sun',
          employeeId: 'pao-1',
          date: '2026-07-12T12:00:00.000Z',
          label: 'FOLGA PEDIDA',
          source: 'requested_day_off',
        },
      ],
    });
    const cells = grid.groups[0].rows[0].cells;
    expect(cells[10].display).toBe('FP');
    expect(cells[10].kind).toBe('folga-weekend');
    expect(cells[10].folgaBaseKind).toBe('fp');
    expect(cells[11].display).toBe('FP');
    expect(cells[11].kind).toBe('folga-weekend');
    expect(cellKindClass('folga-weekend')).toBe('cell-folga-weekend');
    expect(grid.groups[0].rows[0].summary.fp).toBe(2);
    expect(grid.groups[0].rows[0].summary.folgaSocial).toBe(2);
    expect(grid.groups[0].rows[0].summary.folgaSocialOk).toBe(true);
  });

  it('folga sábado+domingo usa cor de folga social mantendo siglas originais', () => {
    const emp: Employee = {
      id: 'pao-1',
      name: 'Lucas Flavio',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 7,
      employees: [emp],
      assignments: [],
      preAllocations: [
        {
          id: 'f-sat',
          scheduleMonthId: 'm1',
          employeeId: 'pao-1',
          date: '2026-07-11T12:00:00.000Z',
          label: 'FOLGA',
        },
        {
          id: 'f-sun',
          scheduleMonthId: 'm1',
          employeeId: 'pao-1',
          date: '2026-07-12T12:00:00.000Z',
          label: 'FOLGA',
        },
      ],
    });
    const cells = grid.groups[0].rows[0].cells;
    expect(cells[10].display).toBe('F');
    expect(cells[10].kind).toBe('folga-weekend');
    expect(cells[11].display).toBe('F');
    expect(cells[11].kind).toBe('folga-weekend');
    expect(grid.groups[0].rows[0].summary.folgaSocial).toBe(2);
    expect(grid.groups[0].rows[0].summary.folgas).toBe(2);
  });

  it('FP sábado + folga domingo usa cor de folga social com siglas distintas', () => {
    const emp: Employee = {
      id: 'pao-1',
      name: 'Lucas Flavio',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 7,
      employees: [emp],
      assignments: [],
      preAllocations: [
        {
          id: 'fp-sat',
          scheduleMonthId: 'm1',
          employeeId: 'pao-1',
          date: '2026-07-11T12:00:00.000Z',
          label: 'FOLGA PEDIDA',
        },
        {
          id: 'f-sun',
          scheduleMonthId: 'm1',
          employeeId: 'pao-1',
          date: '2026-07-12T12:00:00.000Z',
          label: 'FOLGA',
        },
      ],
    });
    const cells = grid.groups[0].rows[0].cells;
    expect(cells[10].display).toBe('FP');
    expect(cells[10].folgaBaseKind).toBe('fp');
    expect(cells[11].display).toBe('F');
    expect(cells[11].folgaBaseKind).toBe('folga');
    expect(cells[10].kind).toBe('folga-weekend');
    expect(cells[11].kind).toBe('folga-weekend');
  });

  it('operationalCadastros exibe FP sem gerar escala', () => {
    const emp: Employee = {
      id: 'pao-1',
      name: 'PAO Test',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [],
      preAllocations: [],
      operationalCadastros: [
        {
          id: 'fp-1',
          employeeId: 'pao-1',
          date: '2026-06-01T12:00:00.000Z',
          label: 'FOLGA PEDIDA',
          source: 'requested_day_off',
        },
      ],
    });
    expect(grid.groups[0].rows[0].cells[0].display).toBe('FP');
    expect(grid.groups[0].rows[0].summary.fp).toBe(1);
  });

  it('9. FA conta em folgas e fa', () => {
    expect(mapLabelToCell('FA').kind).toBe('fa');
    const emp: Employee = {
      id: 'apao-1',
      name: 'APAO Test',
      type: 'APAO',
      roleId: 'role-apao',
      cargoCode: 'APAO',
      cargoName: 'Auxiliar de Piloto de Apoio Operacional',
      active: true,
    };
    const grid = buildScheduleGrid({
      year: 2026,
      month: 6,
      employees: [emp],
      assignments: [
        { id: '1', scheduleMonthId: 'm1', employeeId: 'apao-1', date: '2026-06-07T00:00:00.000Z', shiftCode: '', label: 'FOLGA AGRUPADA', source: 'generated', employee: emp },
        { id: '2', scheduleMonthId: 'm1', employeeId: 'apao-1', date: '2026-06-08T00:00:00.000Z', shiftCode: '', label: 'FOLGA AGRUPADA', source: 'generated', employee: emp },
      ],
      preAllocations: [],
    });
    const summary = grid.groups[0].rows[0].summary;
    expect(summary.fa).toBe(2);
    expect(summary.folgas).toBe(2);
  });
});
