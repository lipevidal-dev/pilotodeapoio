import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { LoginComponent } from './login.component';
import { environment } from '../../../environments/environment';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
  });

  it('renderiza formulário de login', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.login-title')?.textContent).toContain('Portal Escala PAO');
    expect(el.querySelector('input#email')).toBeTruthy();
  });

  it('submete credenciais para API', () => {
    const comp = fixture.componentInstance;
    comp.email = 'admin@escala.local';
    comp.password = 'changeme';
    comp.submit();

    const req = http.expectOne(`${environment.apiBaseUrl}/auth/login`);
    expect(req.request.body).toEqual({ email: 'admin@escala.local', password: 'changeme' });
    req.flush({
      token: 'token',
      user: { id: '1', name: 'Admin', email: 'admin@escala.local', role: 'ADMIN' },
    });
    expect(comp.showTransition()).toBeTrue();
  });
});
