import {
  isDeletableCell,
  isDraggableCell,
  isProtectedDeletableCell,
  isSelectableCell,
} from './schedule-grid-cell.util';
describe('schedule-grid-cell.util', () => {
  it('célula vazia é selecionável', () => {
    expect(isSelectableCell({ display: '', kind: 'empty' })).toBe(true);
    expect(isDraggableCell({ display: '', kind: 'empty' })).toBe(false);
  });

  it('célula T6 é arrastável', () => {
    expect(isDraggableCell({ display: 'T6', kind: 't6' })).toBe(true);
    expect(isSelectableCell({ display: 'T6', kind: 't6' })).toBe(false);
  });

  it('célula preenchida é deletável e férias não', () => {
    expect(isDeletableCell({ display: 'T6', kind: 't6' })).toBe(true);
    expect(isDeletableCell({ display: 'FER', kind: 'ferias' })).toBe(false);
    expect(isProtectedDeletableCell({ display: 'FP', kind: 'fp' })).toBe(true);
    expect(isProtectedDeletableCell({ display: 'T6', kind: 't6' })).toBe(false);
  });

  it('FP em fim de semana é deletável e protegida', () => {
    const cell = { display: 'FP', kind: 'folga-weekend' as const, folgaBaseKind: 'fp' as const };
    expect(isDeletableCell(cell)).toBe(true);
    expect(isProtectedDeletableCell(cell)).toBe(true);
  });
});
