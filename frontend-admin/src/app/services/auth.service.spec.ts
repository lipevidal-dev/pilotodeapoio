import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), AuthService],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
  });

  it('login persiste token e usuário', () => {
    service.login('admin@escala.local', 'changeme').subscribe((res) => {
      expect('token' in res && res.token).toBeTruthy();
      if ('user' in res) {
        expect(res.user.role).toBe('ADMIN');
      }
      expect(service.isAuthenticated()).toBeTrue();
    });

    const req = http.expectOne(`${environment.apiBaseUrl}/auth/login`);
    expect(req.request.method).toBe('POST');
    req.flush({
      token: 'test-token',
      user: { id: '1', name: 'Admin', email: 'admin@escala.local', role: 'ADMIN' },
    });
  });

  it('logout limpa sessão', () => {
    sessionStorage.setItem('escala_auth_token', 'x');
    sessionStorage.setItem(
      'escala_auth_user',
      JSON.stringify({ id: '1', name: 'Admin', email: 'a@b.c', role: 'ADMIN' }),
    );
    // Re-cria o serviço com a sessão já gravada (authRequired=false reseeds open-access).
    service.logout();
    if (environment.authRequired) {
      expect(sessionStorage.getItem('escala_auth_token')).toBeNull();
    } else {
      expect(service.isAuthenticated()).toBeTrue();
      expect(service.user()?.role).toBe('ADMIN');
    }
  });
});
