import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ConfirmationService, MessageService } from 'primeng/api';
import { EmployeesComponent } from './employees.component';
import { buildMonthGrid } from '../../components/operational-calendar/operational-calendar.utils';
import { environment } from '../../../environments/environment';

describe('EmployeesComponent — restrições 6.3', () => {
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

  it('exibe seções de restrição no popup', () => {
    flushInit();
    component.openNew();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('Não alocar voos');
    expect(html.textContent).toContain('Não alocar turno');
    expect(html.textContent).toContain('Alocar em turno específico');
    expect(html.querySelectorAll('p-multiSelect').length).toBe(2);
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

  it('multiselect de turnos mantém IDs selecionados', () => {
    flushInit();
    component.openNew();
    component.formRestrictedShiftIds = ['s-t6', 's-t8'];
    fixture.detectChanges();
    expect(component.formRestrictedShiftIds).toEqual(['s-t6', 's-t8']);
    expect(component.allShiftsRestricted()).toBe(false);
    component.formRestrictedShiftIds = ['s-t6', 's-t7', 's-t8', 's-t9'];
    expect(component.allShiftsRestricted()).toBe(true);
  });

  it('bloqueia conflito restrito + preferido', () => {
    flushInit();
    component.openNew();
    component.formRestrictedShiftIds = ['s-t9'];
    component.formPreferredShiftIds = ['s-t9'];
    expect(component.restrictedPreferredConflict()).toBeTrue();
  });

  it('ao editar carrega preferredShiftIds do GET /employees/:id', () => {
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
      preferredShiftIds: ['s-t9'],
      preferredShifts: [{ id: 's-t9', code: 'T9', name: 'Turno 9' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    fixture.detectChanges();
    expect(component.formPreferredShiftIds).toEqual(['s-t9']);
  });

  it('ao editar carrega restrições do GET /employees/:id', () => {
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
    expect(component.formRestrictedShiftIds).toEqual(['s-t8']);
  });
});
