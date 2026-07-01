import { buildCellHoverDetail } from './schedule-cell-hover.util';

describe('schedule-cell-hover.util', () => {
  it('monta detalhe de turno com horário', () => {
    expect(
      buildCellHoverDetail('shift', 'T6', { shiftStart: '06:00', shiftEnd: '14:00' }),
    ).toBe('Turno T6\n06:00 – 14:00');
  });

  it('monta turno em instrução', () => {
    expect(buildCellHoverDetail('instruction-shift', 'TI8', { shiftStart: '22:00', shiftEnd: '06:00' })).toBe(
      'Turno em Instrução\n22:00 – 06:00',
    );
    expect(buildCellHoverDetail('instruction-shift', 'TI6')).toBe('Turno em Instrução');
  });

  it('monta voo com observação', () => {
    expect(buildCellHoverDetail('voo', 'VOO', { notes: 'GRU–CGH' })).toBe('Voo\nGRU–CGH');
  });

  it('monta simulador com horário e observação', () => {
    expect(
      buildCellHoverDetail('simulador', 'SIM', {
        startTime: '14:00',
        endTime: '18:00',
        notes: 'Sessão B',
      }),
    ).toBe('Simulador\n14:00 – 18:00\nSessão B');
  });

  it('monta OUTRO com descrição', () => {
    expect(buildCellHoverDetail('outro', 'OTR', { notes: 'Visita médica' })).toBe('Visita médica');
  });
});
