import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ConfirmationService, MessageService } from 'primeng/api';
import { EmployeesComponent } from './employees.component';
import { buildMonthGrid } from '../../components/operational-calendar/operational-calendar.utils';
import { environment } from '../../../environments/environment';

describe('EmployeesComponent — preferência de turno e FCF', () => {
  let fixture: ComponentFixture<EmployeesComponent>;
  let component: EmployeesComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmployeesComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        MessageService,
        ConfirmationService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EmployeesComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  function flushInit(): void {
    fixture.detectChanges();
    const base = environment.apiBaseUrl;
    http.expectOne(`${base}/roles?activeOnly=true`).flush([
      { id: 'role-pao', name: 'PAO', code: 'PAO', description: null, active: true, displayOrder: 1 },
    ]);
    http.expectOne(`${base}/shifts?activeOnly=true`).flush([
      { id: 's-t6', code: 'T6', name: 'Turno 6', startTime: '06:00', endTime: '12:00', roleType: 'PAO', durationHours: 6, active: true, displayOrder: 1, mandatoryCoverage: true, requiresT8PairNd: false, coverageType: 'REQUIRED' },
      { id: 's-t7', code: 'T7', name: 'Turno 7', startTime: '12:00', endTime: '18:00', roleType: 'PAO', durationHours: 6, active: true, displayOrder: 2, mandatoryCoverage: true, requiresT8PairNd: false, coverageType: 'REQUIRED' },
      { id: 's-t8', code: 'T8', name: 'Turno 8', startTime: '18:00', endTime: '00:00', roleType: 'PAO', durationHours: 6, active: true, displayOrder: 3, mandatoryCoverage: true, requiresT8PairNd: true, coverageType: 'REQUIRED' },
      { id: 's-t9', code: 'T9', name: 'Turno 9', startTime: '10:00', endTime: '18:00', roleType: 'PAO', durationHours: 8, active: true, displayOrder: 4, mandatoryCoverage: false, requiresT8PairNd: false, coverageType: 'PARALLEL' },
    ]);
    http.expectOne(`${base}/employees`).flush([]);
  }

  it('exibe seção FCF no popup', () => {
    flushInit();
    component.openNew();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('Não alocar voos');
    expect(html.textContent).not.toContain('Preferência de turno');
    expect(html.textContent).not.toContain('Preferência principal de turno');
    expect(html.textContent).toContain('Cargo FCF');
    expect(html.textContent).toContain('Motor de Escala');
    expect(html.textContent).not.toContain('Alocações FCF');
    expect(html.textContent).not.toContain('Preferência por dia específico');
    expect(html.textContent).not.toContain('Alocar em turno específico');
    expect(html.textContent).not.toContain('Alocar turno em dias específicos');
    expect(html.textContent).not.toContain('Não alocar turno');
  });

  it('calendário permite selecionar dias e resume bloqueios', () => {
    flushInit();
    component.openNew();
    component.formNoFlightDates = [new Date(2026, 5, 10)];
    fixture.detectChanges();
    expect(component.noFlightSummary()).toContain('1 dia');
  });

  it('selecionar mês inteiro adiciona todos os dias do mês visível', () => {
    flushInit();
    component.openNew();
    component.calendarViewYear = 2026;
    component.calendarViewMonth = 6;
    component.selectFullMonthForNoFlight();
    const expected = buildMonthGrid(2026, 6).filter((c) => c.inMonth).length;
    expect(component.formNoFlightDates.length).toBe(expected);
  });

  it('ao editar carrega dias sem voo do GET /employees/:id', () => {
    flushInit();
    component.openEdit({
      id: 'emp-1',
      name: 'Teste',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'PAO',
      active: true,
    });
    http.expectOne(`${environment.apiBaseUrl}/employees/emp-1`).flush({
      id: 'emp-1',
      name: 'Teste',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'PAO',
      seniorityNumber: 1,
      seniorityLabel: '1',
      active: true,
      birthDate: null,
      noFlightDates: ['2026-06-05', '2026-06-06'],
      restrictedShiftIds: ['s-t8'],
      restrictedShifts: [{ id: 's-t8', code: 'T8', name: 'Turno 8' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    fixture.detectChanges();
    expect(component.formNoFlightDates.length).toBe(2);
  });

  it('marca cargo FCF sem exibir alocações por dia', () => {
    flushInit();
    component.openNew();
    component.formIsFcf = true;
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('Cargo FCF');
    expect(html.textContent).not.toContain('Alocações FCF');
    expect(html.textContent).not.toContain('Adicionar dia');
  });

  it('ao editar carrega flag isFcf do GET /employees/:id', () => {
    flushInit();
    component.openEdit({
      id: 'emp-1',
      name: 'Teste',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'PAO',
      active: true,
    });
    http.expectOne(`${environment.apiBaseUrl}/employees/emp-1`).flush({
      id: 'emp-1',
      name: 'Teste',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'PAO',
      seniorityNumber: 1,
      seniorityLabel: '1',
      active: true,
      birthDate: null,
      noFlightDates: [],
      restrictedShiftIds: [],
      restrictedShifts: [],
      preferredShiftIds: [],
      preferredShifts: [],
      isFcf: true,
      fcfSchedule: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    fixture.detectChanges();
    expect(component.formIsFcf).toBeTrue();
  });
});
