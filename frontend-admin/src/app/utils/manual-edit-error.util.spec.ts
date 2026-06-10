import { HttpErrorResponse } from '@angular/common/http';
import { extractManualEditConflictMessage } from './manual-edit-error.util';

describe('manual-edit-error.util', () => {
  it('6. extrai mensagem do array conflicts', () => {
    const err = new HttpErrorResponse({
      status: 409,
      error: {
        message: 'Edição bloqueada',
        conflicts: [{ code: 'SHIFT_COVERAGE', message: 'Conflito: turno T6 já está coberto por PAO Beta em 01/07.' }],
      },
    });
    expect(extractManualEditConflictMessage(err)).toBe(
      'Conflito: turno T6 já está coberto por PAO Beta em 01/07.',
    );
  });

  it('informa falha de rede quando status é 0', () => {
    const err = new HttpErrorResponse({ status: 0, error: null });
    expect(extractManualEditConflictMessage(err)).toContain('contactar o servidor');
  });

  it('usa message quando conflicts ausente', () => {
    const err = new HttpErrorResponse({
      status: 409,
      error: { message: 'Conflito: funcionário está de férias.' },
    });
    expect(extractManualEditConflictMessage(err)).toBe('Conflito: funcionário está de férias.');
  });
});
