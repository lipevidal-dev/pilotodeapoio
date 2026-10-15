import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PortalVacationRequestComponent } from './portal-vacation-request.component';
import { environment } from '../../../environments/environment';

describe('PortalVacationRequestComponent', () => {
  let fixture: ComponentFixture<PortalVacationRequestComponent>;
  let http: HttpTestingController;
  const base = environment.apiBaseUrl;
  const now = new Date();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PortalVacationRequestComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(PortalVacationRequestComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
  });

  it('carrega o espelho de férias do mês atual', () => {
    const req = http.expectOne(
      (r) =>
        r.url === `${base}/portal/vacations/calendar` &&
        r.params.get('year') === String(now.getFullYear()) &&
        r.params.get('month') === String(now.getMonth() + 1),
    );
    expect(req.request.method).toBe('GET');
    req.flush({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      periods: [
        {
          id: 'v1',
          employeeId: 'e-2',
          employeeName: 'Bruno',
          startDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`,
          endDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-12`,
          status: 'APPROVED',
          mine: false,
        },
      ],
    });
    fixture.detectChanges();
    expect(fixture.componentInstance.periods().length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Bruno');
  });
});
