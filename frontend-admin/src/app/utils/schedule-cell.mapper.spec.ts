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

describe('schedule-cell.mapper — cor única dos turnos', () => {
  it('6. todos os turnos usam kind shift', () => {
    for (const code of ['T6', 'T7', 'T8', 'T1', 'T2', 'T3', 'T4', 'TX']) {
      expect(mapShiftToCell(code).kind).toBe('shift');
    }
  });

  it('7. legenda usa classe cell-shift', () => {
    expect(cellKindClass('shift')).toBe('cell-shift');
    expect(mapShiftToCell('T6').kind).toBe('shift');
    expect(cellKindClass(mapShiftToCell('T6').kind)).toBe('cell-shift');
  });

  it('ND permanece separado', () => {
    expect(mapShiftToCell('ND').kind).toBe('nd');
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

  it('não exibe VOO fantasma de preAllocation quando operationalCadastros vazio', () => {
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
          id: 'ghost',
          employeeId: 'pao-1',
          date: '2026-06-05T12:00:00.000Z',
          label: 'VOO',
        },
      ],
      operationalCadastros: [],
    });
    expect(grid.groups[0].rows[0].cells[4].kind).toBe('empty');
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

  it('calendário usa sigla compacta SIM e escala mantém SIMULADOR', () => {
    const full = mapLabelToCell('SIMULADOR');
    const compact = mapCellToCalendarDisplay(full);
    expect(full.display).toBe('SIMULADOR');
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
      ['FOLGA PEDIDA'],
    );
    expect(cell.display).toBe('FP');
    expect(cell.kind).toBe('fp');
  });

  it('férias têm prioridade sobre FP no mesmo dia', () => {
    expect(labelDisplayPriority('FÉRIAS')).toBeGreaterThan(labelDisplayPriority('FOLGA PEDIDA'));
    const cell = resolveScheduleCell(undefined, ['FOLGA PEDIDA', 'FÉRIAS']);
    expect(cell.kind).toBe('ferias');
  });

  it('operationalCadastros exibe FÉRIAS no último dia inclusivo do período', () => {
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
    expect(cells[0].display).toBe('FÉRIAS');
    expect(cells[14].display).toBe('FÉRIAS');
    expect(cells[15].kind).toBe('empty');
    expect(grid.groups[0].rows[0].summary.ferias).toBe(15);
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
