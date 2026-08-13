import { buildCellHoverDetail, sanitizeHoverNotes } from './schedule-cell-hover.util';

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

  it('mostra observação em FP, férias, ND e turno', () => {
    expect(buildCellHoverDetail('fp', 'FP', { notes: 'Consulta' })).toBe('Folga pedida\nConsulta');
    expect(buildCellHoverDetail('ferias', 'FER', { notes: 'Adiantamento 13º' })).toBe(
      'Férias\nAdiantamento 13º',
    );
    expect(buildCellHoverDetail('nd', 'ND', { notes: 'Bloqueio operacional' })).toBe(
      'Não disponível\nBloqueio operacional',
    );
    expect(
      buildCellHoverDetail('t6', 'T6', {
        shiftStart: '06:00',
        shiftEnd: '14:00',
        notes: 'Troca combinada',
      }),
    ).toBe('Turno T6\n06:00 – 14:00\nTroca combinada');
  });

  it('sanitizeHoverNotes remove marcadores internos e mantém texto do usuário', () => {
    expect(sanitizeHoverNotes('__PENDING__ pedido APAO')).toBe('pedido APAO');
    expect(sanitizeHoverNotes('__PORTAL_APPROVED__ ok')).toBe('ok');
    expect(sanitizeHoverNotes('__PORTAL_FP__ preferência')).toBe('preferência');
    expect(sanitizeHoverNotes('__PENDING__')).toBeNull();
    expect(sanitizeHoverNotes('escala-manual')).toBeNull();
    expect(sanitizeHoverNotes('auto:birthday-fani')).toBeNull();
    expect(sanitizeHoverNotes('CHECK ROTA')).toBe('CHECK ROTA');
  });
});
