import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ShiftsComponent } from './shifts.component';
import { environment } from '../../../../environments/environment';

describe('ShiftsComponent — coverageType', () => {
  let fixture: ComponentFixture<ShiftsComponent>;
  let component: ShiftsComponent;
  let http: HttpTestingController;

  const sampleShifts = [
    {
      id: 's-t6',
      code: 'T6',
      name: 'Turno 6',
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
      id: 's-t9',
      code: 'T9',
      name: 'Turno 9',
      startTime: '10:00',
      endTime: '18:00',
      roleType: 'PAO',
      active: true,
      displayOrder: 8,
      mandatoryCoverage: false,
      requiresT8PairNd: false,
      coverageType: 'PARALLEL',
      durationHours: 8,
    },
  ] as const;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ShiftsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        MessageService,
        ConfirmationService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ShiftsComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  function flushInit(): void {
    fixture.detectChanges();
    http.expectOne(`${environment.apiBaseUrl}/shifts`).flush([...sampleShifts]);
  }

  it('1. exibe coluna Tipo na tabela', () => {
    flushInit();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('Tipo');
  });

  it('2. turnos existentes aparecem como Cobertura obrigatória', () => {
    flushInit();
    expect(component.coverageTypeLabel('REQUIRED')).toBe('Cobertura obrigatória');
  });

  it('3. T9 pode ser marcado como Especial/paralelo', () => {
    flushInit();
    component.openEdit({ ...sampleShifts[1] });
    expect(component.formCoverageType).toBe('PARALLEL');
    expect(component.coverageTypeLabel('PARALLEL')).toBe('Especial/paralelo');
  });

  it('4. popup de novo turno inclui Tipo de uso', () => {
    flushInit();
    component.openNew();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Tipo de uso');
  });
});
