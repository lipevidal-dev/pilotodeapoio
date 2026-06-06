import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScheduleComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
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
  }

  it('exibe botão Gerar Escala (sem Gerar por Etapas)', () => {
    flushScheduleView();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('Gerar Escala');
    expect(html.textContent).not.toContain('Gerar por Etapas');
  });

  it('Gerar Escala chama POST /schedules/generate', () => {
    flushScheduleView();
    component.generate();

    const req = http.expectOne(`${base}/schedules/generate`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ year: 2026, month: 6 });
    req.flush({
      scheduleMonthId: 'sm-1',
      status: 'GENERATED',
      assignmentsCreated: 10,
      allocationsCreated: 5,
      violations: [],
      success: true,
      suggestions: [],
      motorVersion: 'REAL_V1',
      enginePath: 'GenerateScheduleUseCase -> RealScheduleEngine',
      realEngineExecuted: true,
      summary: {
        motorVersion: 'REAL_V1',
        enginePath: 'GenerateScheduleUseCase -> RealScheduleEngine',
        realEngineExecuted: true,
        criticalCount: 0,
        totalAssignments: 10,
      },
    });

    http.expectOne(`${base}/schedules/2026/6`).flush({
      ...emptyMonth,
      scheduleMonth: { id: 'sm-1', year: 2026, month: 6, status: 'GENERATED' },
    });
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('REAL_V1');
  });
});
