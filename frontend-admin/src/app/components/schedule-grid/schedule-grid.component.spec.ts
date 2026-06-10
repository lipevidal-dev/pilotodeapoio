import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ScheduleGridComponent } from './schedule-grid.component';
import type { ScheduleGridData } from '../../models/schedule-grid.models';

function minimalGrid(): ScheduleGridData {
  return {
    year: 2026,
    month: 7,
    daysInMonth: 3,
    dayNumbers: [1, 2, 3],
    weekdayLabels: ['Qua', 'Qui', 'Sex'],
    groups: [
      {
        type: 'PAO',
        label: 'PAO',
        rows: [
          {
            employeeId: 'emp-1',
            name: 'PAO Test',
            type: 'PAO',
            cells: [
              { display: 'T6', kind: 't6' },
              { display: '', kind: 'empty' },
              { display: 'ND', kind: 'nd' },
            ],
            summary: {
              t6: 1,
              t7: 0,
              t8: 0,
              nd: 1,
              turnos: 1,
              diasTrabalhados: 1,
              folgas: 0,
              folgaSocial: 0,
              folgaSocialOk: false,
              fa: 0,
              fani: 0,
              fp: 0,
              ferias: 0,
              vooDisp: 0,
              disponivel: 1,
              maxConsec: 1,
              status: 'OK',
              statusReason: null,
              voos: 0,
              simuladores: 0,
              cursos: 0,
              cma: 0,
              outros: 0,
            },
          },
        ],
      },
    ],
  };
}

describe('ScheduleGridComponent — edição interativa 8.1A', () => {
  let fixture: ComponentFixture<ScheduleGridComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScheduleGridComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(ScheduleGridComponent);
    fixture.componentRef.setInput('grid', minimalGrid());
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();
  });

  it('3. drag-select em célula vazia abre seleção', () => {
    const comp = fixture.componentInstance;
    const emitted: unknown[] = [];
    comp.selectionCompleted.subscribe((v) => emitted.push(v));
    comp.onCellMouseDown(
      { button: 0, preventDefault: () => {} } as MouseEvent,
      'emp-1',
      2,
      { display: '', kind: 'empty' },
    );
    comp.onCellMouseEnter('emp-1', 3);
    comp.onDocumentMouseUp();
    expect(emitted.length).toBe(1);
  });

  it('2. célula preenchida não inicia drag-select', () => {
    const comp = fixture.componentInstance;
    const emitted: unknown[] = [];
    comp.selectionCompleted.subscribe((v) => emitted.push(v));
    comp.onCellMouseDown(
      { button: 0, preventDefault: () => {} } as MouseEvent,
      'emp-1',
      1,
      { display: 'T6', kind: 't6' },
    );
    comp.onDocumentMouseUp();
    expect(emitted.length).toBe(0);
  });

  it('1. drag em célula preenchida emite manual-move', () => {
    const comp = fixture.componentInstance;
    const moves: unknown[] = [];
    comp.moveRequested.subscribe((v) => moves.push(v));
    comp.onDragStart(
      {
        stopPropagation: () => {},
        dataTransfer: { setData: () => {}, effectAllowed: 'move', setDragImage: () => {} },
        currentTarget: document.createElement('td'),
      } as unknown as DragEvent,
      'emp-1',
      1,
      { display: 'T6', kind: 't6' },
    );
    comp.onDrop(
      { preventDefault: () => {}, stopPropagation: () => {} } as DragEvent,
      'emp-1',
      2,
    );
    expect(moves.length).toBe(1);
    expect(moves[0]).toEqual({
      source: { employeeId: 'emp-1', day: 1 },
      target: { employeeId: 'emp-1', day: 2 },
    });
  });

  it('4. Ctrl+clique multi-select emite ao soltar Control', () => {
    const grid = minimalGrid();
    grid.groups[0]!.rows[0]!.cells = [
      { display: '', kind: 'empty' },
      { display: '', kind: 'empty' },
      { display: '', kind: 'empty' },
    ];
    fixture.componentRef.setInput('grid', grid);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    const emitted: unknown[] = [];
    comp.selectionCompleted.subscribe((v) => emitted.push(v));
    const ctrlDown = { button: 0, preventDefault: () => {}, ctrlKey: true } as MouseEvent;

    comp.onCellMouseDown(ctrlDown, 'emp-1', 1, { display: '', kind: 'empty' });
    comp.onCellMouseDown(ctrlDown, 'emp-1', 3, { display: '', kind: 'empty' });
    comp.onDocumentKeyUp({ key: 'Control' } as KeyboardEvent);

    expect(emitted.length).toBe(1);
    expect(emitted[0]).toEqual({
      employeeId: 'emp-1',
      employeeName: 'PAO Test',
      startDay: 1,
      endDay: 3,
      days: [1, 3],
    });
  });

  it('destaca células selecionadas', () => {
    const comp = fixture.componentInstance;
    comp.onCellMouseDown(
      { button: 0, preventDefault: () => {} } as MouseEvent,
      'emp-1',
      2,
      { display: '', kind: 'empty' },
    );
    comp.onCellMouseEnter('emp-1', 2);
    expect(comp.isCellHighlighted('emp-1', 2)).toBe(true);
  });

  it('5. Shift+clique multi-select em células preenchidas emite ao soltar Shift', () => {
    const comp = fixture.componentInstance;
    const emitted: unknown[] = [];
    comp.deletionSelectionCompleted.subscribe((v) => emitted.push(v));
    const shiftDown = { button: 0, preventDefault: () => {}, shiftKey: true } as MouseEvent;

    comp.onCellMouseDown(shiftDown, 'emp-1', 1, { display: 'T6', kind: 't6' });
    comp.onCellMouseDown(shiftDown, 'emp-1', 3, { display: 'ND', kind: 'nd' });
    comp.onDocumentKeyUp({ key: 'Shift' } as KeyboardEvent);

    expect(emitted.length).toBe(1);
    expect(emitted[0]).toEqual({
      employeeId: 'emp-1',
      employeeName: 'PAO Test',
      startDay: 1,
      endDay: 3,
      days: [1, 3],
      cells: [
        { day: 1, display: 'T6', kind: 't6' },
        { day: 3, display: 'ND', kind: 'nd' },
      ],
    });
  });

  it('destaca células marcadas para exclusão', () => {
    const comp = fixture.componentInstance;
    comp.onCellMouseDown(
      { button: 0, preventDefault: () => {}, shiftKey: true } as MouseEvent,
      'emp-1',
      1,
      { display: 'T6', kind: 't6' },
    );
    expect(comp.isCellDeleteHighlighted('emp-1', 1)).toBe(true);
  });
});
