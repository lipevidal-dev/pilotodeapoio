import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PortalScheduleComponent } from './portal-schedule.component';
import { environment } from '../../../environments/environment';

describe('PortalScheduleComponent', () => {
  let fixture: ComponentFixture<PortalScheduleComponent>;
  let http: HttpTestingController;
  const base = environment.apiBaseUrl;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PortalScheduleComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(PortalScheduleComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
  });

  it('carrega escala publicada ao iniciar', () => {
    const now = new Date();
    const req = http.expectOne(`${base}/schedules/published/${now.getFullYear()}/${now.getMonth() + 1}`);
    expect(req.request.method).toBe('GET');
    req.flush({
      scheduleMonth: { id: 'sm1', year: now.getFullYear(), month: now.getMonth() + 1, status: 'PUBLISHED' },
      employees: [],
      shifts: [],
      assignments: [],
      preAllocations: [],
    });
    fixture.detectChanges();
    expect(fixture.componentInstance.scheduleData()?.scheduleMonth.status).toBe('PUBLISHED');
  });
});
