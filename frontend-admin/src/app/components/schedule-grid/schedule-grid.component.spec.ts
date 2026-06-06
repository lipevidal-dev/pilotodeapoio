import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScheduleGridComponent } from './schedule-grid.component';
import type { ScheduleGridData } from '../../models/schedule-grid.models';

function minimalGrid(): ScheduleGridData {
  return {
    year: 2026,
    month: 6,
    daysInMonth: 30,
    dayNumbers: [1],
    weekdayLabels: ['Seg'],
    groups: [
      {
        type: 'PAO',
        label: 'PAO',
        rows: [
          {
            employeeId: 'e1',
            name: 'Test',
            type: 'PAO',
            cells: [{ display: '', kind: 'empty' }],
            summary: {
              t6: 0,
              t7: 0,
              t8: 0,
              nd: 0,
              turnos: 0,
              diasTrabalhados: 0,
              folgas: 10,
              folgaSocial: 0,
              folgaSocialOk: false,
              fa: 0,
              fani: 0,
              fp: 0,
              ferias: 0,
              vooDisp: 1,
              disponivel: 1,
              maxConsec: 0,
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

describe('ScheduleGridComponent', () => {
  let fixture: ComponentFixture<ScheduleGridComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScheduleGridComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ScheduleGridComponent);
    fixture.componentRef.setInput('grid', minimalGrid());
    fixture.detectChanges();
  });

  it('7. toggle esconde e mostra resumo', () => {
    const cmp = fixture.componentInstance;
    expect(cmp.summaryVisible()).toBe(true);
    cmp.toggleSummary();
    expect(cmp.summaryVisible()).toBe(false);
    expect(cmp.summaryToggleLabel()).toBe('Mostrar resumo');
    cmp.toggleSummary();
    expect(cmp.summaryVisible()).toBe(true);
  });
});
