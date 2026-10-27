import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ConfirmationService, MessageService } from 'primeng/api';
import { EmployeesComponent } from './employees.component';
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
    http.expectOne(`${base}/employees/license-alerts`).flush({ alerts: [] });
  }

  it('agrupa os checkboxes e mostra login e senha visíveis', () => {
    flushInit();
    component.openNew();
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).not.toContain('Não alocar voos');
    expect(html.textContent).not.toContain('Preferência de turno');
    expect(html.textContent).not.toContain('Preferência principal de turno');
    expect(html.textContent).toContain('Opções');
    expect(html.textContent).toContain('PAO');
    expect(html.textContent).toContain('Cargo FCF');
    expect(html.textContent).toContain('Comandante (CMTE)');
    expect(html.textContent).toContain('Somente escala manual');
    expect(html.textContent).toContain('Em instrução');
    expect(html.textContent).toContain('Ativo');
    expect(html.textContent).toContain('Licenças e Habilitações');
    expect(html.textContent).toContain('Cadastro');
    expect(html.textContent).toContain('Observação');
    expect(html.querySelector('#formObservation')).not.toBeNull();
    expect(html.textContent).toContain('Motor de Escala');
    expect(html.querySelector('#formPortalPassword')?.getAttribute('type')).toBe('text');
    expect(html.querySelector('#formPortalLogin')).not.toBeNull();
    expect(html.textContent).not.toContain('Alocações FCF');
    expect(html.textContent).not.toContain('Não alocar turno');
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
    http.expectOne(`${environment.apiBaseUrl}/employees/emp-1/licenses`).flush({
      today: '2026-10-15',
      alertUntil: '2026-12-14',
      items: [],
    });
    http.expectOne(`${environment.apiBaseUrl}/employees/emp-1/portal-access`).flush({
      portalLogin: null,
      portalPassword: null,
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
    http.expectOne(`${environment.apiBaseUrl}/employees/emp-1/licenses`).flush({
      today: '2026-10-15',
      alertUntil: '2026-12-14',
      items: [],
    });
    http.expectOne(`${environment.apiBaseUrl}/employees/emp-1/portal-access`).flush({
      portalLogin: null,
      portalPassword: null,
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

  it('salvar edição não envia dias sem voo nem preferência de turno', () => {
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
    http.expectOne(`${environment.apiBaseUrl}/employees/emp-1/licenses`).flush({
      today: '2026-10-15',
      alertUntil: '2026-12-14',
      items: [{ id: 'lic-1', dueOn: '2026-11-01', description: 'CMA', alert: true }],
    });
    http.expectOne(`${environment.apiBaseUrl}/employees/emp-1/portal-access`).flush({
      portalLogin: 'teste',
      portalPassword: 'senha-vista',
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
      noFlightDates: ['2026-06-05'],
      restrictedShiftIds: ['s-t8'],
      restrictedShifts: [],
      preferredShiftIds: ['s-t6'],
      preferredShifts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(component.formPortalPassword).toBe('senha-vista');
    component.formObservation = ' Prefere voo manhã ';
    component.save();
    const req = http.expectOne(`${environment.apiBaseUrl}/employees/emp-1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.observation).toBe('Prefere voo manhã');
    expect(req.request.body.noFlightDates).toBeUndefined();
    expect(req.request.body.preferredShiftIds).toBeUndefined();
    expect(req.request.body.restrictedShiftIds).toBeUndefined();
    expect(req.request.body.roleId).toBe('role-pao');
    req.flush({
      id: 'emp-1',
      name: 'Teste',
      type: 'PAO',
      roleId: 'role-pao',
      cargoCode: 'PAO',
      cargoName: 'PAO',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    http.expectOne(`${environment.apiBaseUrl}/employees`).flush([]);
    http.expectOne(`${environment.apiBaseUrl}/employees/license-alerts`).flush({ alerts: [] });
  });
});
