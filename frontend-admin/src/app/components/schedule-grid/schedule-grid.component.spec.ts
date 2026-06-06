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
              { display: 'T6', kind: 'shift' },
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

describe('ScheduleGridComponent — edição interativa', () => {
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

  it('7. destaca células selecionadas', () => {
    const comp = fixture.componentInstance;
    comp.onCellMouseDown({ button: 0, preventDefault: () => {} } as MouseEvent, 'emp-1', 1);
    comp.onCellMouseEnter('emp-1', 2);
    expect(comp.isCellHighlighted('emp-1', 1)).toBe(true);
    expect(comp.isCellHighlighted('emp-1', 2)).toBe(true);
  });

  it('1. emite seleção ao soltar mouse', () => {
    const comp = fixture.componentInstance;
    const emitted: unknown[] = [];
    comp.selectionCompleted.subscribe((v) => emitted.push(v));
    comp.onCellMouseDown({ button: 0, preventDefault: () => {} } as MouseEvent, 'emp-1', 2);
    comp.onCellMouseEnter('emp-1', 3);
    comp.onDocumentMouseUp();
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toEqual({
      employeeId: 'emp-1',
      employeeName: 'PAO Test',
      startDay: 2,
      endDay: 3,
    });
  });
});
