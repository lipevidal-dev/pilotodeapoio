import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { ScheduleComponent } from './schedule.component';
import { environment } from '../../../environments/environment';

describe('ScheduleComponent — geração principal', () => {
  let fixture: ComponentFixture<ScheduleComponent>;
  let component: ScheduleComponent;
  let http: HttpTestingController;

  const base = environment.apiBaseUrl;

  const emptyMonth = {
    scheduleMonth: { id: 'sm-1', year: 2026, month: 6, status: 'DRAFT' },
    employees: [
      {
        id: 'emp-1',
        name: 'PAO A',
        type: 'PAO',
        roleId: 'r1',
        cargoCode: 'PAO',
        cargoName: 'PAO',
        active: true,
      },
    ],
    shifts: [],
    assignments: [],
    preAllocations: [],
    operationalCadastros: [],
  };

  const nextMotorConfig = {
    motorId: 'NEXT',
    motorLabel: 'Motor automático',
    ready: true,
    enabledCount: 18,
    totalCount: 20,
    scopeEmployeeIds: null,
    scopeMode: 'all' as const,
    scopeSelectedCount: null,
    employeePrefs: {},
    categories: [],
    rules: [],
    params: [
      { id: 'pao_meta_turnos', value: 20, min: 0, max: 31, ruleId: 'pao_meta_turnos', category: 'pao', label: '', description: '', locked: false },
      { id: 'pao_meta_dias_trabalhados', value: 20, min: 0, max: 31, ruleId: 'pao_meta_dias_trabalhados', category: 'pao', label: '', description: '', locked: false },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScheduleComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ScheduleComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  function flushScheduleView(): void {
    fixture.detectChanges();
    http.expectOne(`${base}/schedules/2026/6`).flush(emptyMonth);
    http.expectOne(`${base}/config/next-motor`).flush(nextMotorConfig);
  }

  it('exibe botão Gerar Escala Automática (sem motor legado)', () => {
    flushScheduleView();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('Gerar Escala Automática');
    expect(html.textContent).not.toContain('Gerar Escala APAO');
    expect(html.textContent).not.toMatch(/Gerar Escala(?! Automática)/);
  });

  it('botão Gerar Escala Automática chama POST /schedules/generate', () => {
    flushScheduleView();
    spyOn(window, 'confirm').and.returnValue(true);
    component.generateWithNextMotor();
    const req = http.expectOne(`${base}/schedules/generate`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ year: 2026, month: 6 });
    req.flush({
      scheduleMonthId: 'sm-1',
      status: 'GENERATED',
      assignmentsCreated: 10,
      allocationsCreated: 2,
      violations: [],
      summary: { coverageGaps: 0 },
      success: true,
      suggestions: [],
      motorVersion: 'NEXT',
      enginePath: 'domain/schedule/clean-engine/clean-engine.ts',
      realEngineExecuted: true,
    });
    http.expectOne(`${base}/schedules/2026/6`);
  });
});
