import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ScheduleAllocationPopupComponent } from './schedule-allocation-popup.component';
import type { Shift } from '../../models/api.models';

describe('ScheduleAllocationPopupComponent', () => {
  let fixture: ComponentFixture<ScheduleAllocationPopupComponent>;

  const mockShifts: Shift[] = [
    {
      id: 's6',
      code: 'T6',
      name: 'T6',
      startTime: '06:00',
      endTime: '14:00',
      roleType: 'PAO',
      active: true,
      displayOrder: 1,
      mandatoryCoverage: true,
      requiresT8PairNd: false,
      coverageType: 'REQUIRED',
      durationHours: 8,
    },
    {
      id: 's9',
      code: 'T9',
      name: 'T9',
      startTime: '10:00',
      endTime: '18:00',
      roleType: 'PAO',
      active: true,
      displayOrder: 4,
      mandatoryCoverage: false,
      requiresT8PairNd: false,
      coverageType: 'PARALLEL',
      durationHours: 8,
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScheduleAllocationPopupComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(ScheduleAllocationPopupComponent);
    fixture.componentRef.setInput('visible', true);
    fixture.componentRef.setInput('context', {
      employeeName: 'PAO Test',
      employeeType: 'PAO',
      startDay: 15,
      endDay: 17,
    });
    fixture.componentRef.setInput('month', 7);
    fixture.componentRef.setInput('shifts', mockShifts);
    fixture.detectChanges();
  });

  it('4. botão X fecha popup', () => {
    const comp = fixture.componentInstance;
    const closed: unknown[] = [];
    comp.closed.subscribe((v) => closed.push(v));
    comp.cancel();
    expect(closed.length).toBe(1);
    expect(comp.dialogVisible()).toBe(false);
  });

  it('5. ESC fecha via onDialogHide', () => {
    const comp = fixture.componentInstance;
    const closed: unknown[] = [];
    comp.closed.subscribe((v) => closed.push(v));
    comp.onDialogHide();
    expect(closed.length).toBe(1);
  });

  it('subtítulo formata período', () => {
    expect(fixture.componentInstance.subtitle()).toContain('PAO Test');
    expect(fixture.componentInstance.subtitle()).toContain('15/07');
    expect(fixture.componentInstance.subtitle()).toContain('17/07');
  });

  it('lista opções dinâmicas incluindo T9 paralelo para PAO', () => {
    const keys = fixture.componentInstance.selectOptions().map((o) => o.key);
    expect(keys).toContain('T6');
    expect(keys).toContain('T9');
  });

  it('lista turnos APAO quando contexto é APAO', () => {
    fixture.componentRef.setInput('shifts', [
      ...mockShifts,
      {
        id: 's1',
        code: 'T1',
        name: 'Turno 1 APAO',
        startTime: '06:00',
        endTime: '14:00',
        roleType: 'APAO',
        active: true,
        displayOrder: 0,
        mandatoryCoverage: true,
        requiresT8PairNd: false,
        coverageType: 'REQUIRED',
        durationHours: 8,
      },
    ]);
    fixture.componentRef.setInput('context', {
      employeeName: 'APAO César',
      employeeType: 'APAO',
      startDay: 10,
      endDay: 10,
    });
    fixture.detectChanges();

    const keys = fixture.componentInstance.selectOptions().map((o) => o.key);
    expect(keys).toContain('T1');
    expect(keys.includes('T6')).toBe(false);
    expect(keys.includes('T9')).toBe(false);
  });
});
