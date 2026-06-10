import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { adminGuard, employeeGuard, guestGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';
import type { AuthUser } from '../models/auth.models';

describe('auth guards', () => {
  let auth: jasmine.SpyObj<Pick<AuthService, 'user' | 'isAuthenticated'>>;
  let router: Router;

  beforeEach(() => {
    auth = jasmine.createSpyObj('AuthService', ['user', 'isAuthenticated']);
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: auth }],
    });
    router = TestBed.inject(Router);
  });

  function runGuard(guard: typeof adminGuard, user: AuthUser | null, authenticated: boolean) {
    auth.isAuthenticated.and.returnValue(authenticated);
    auth.user.and.returnValue(user);
    return TestBed.runInInjectionContext(() => guard(null!, null!));
  }

  it('guestGuard redireciona admin autenticado para dashboard', () => {
    const result = runGuard(guestGuard, { id: '1', name: 'A', email: 'a@b.c', role: 'ADMIN' }, true);
    expect(result).toEqual(router.createUrlTree(['/dashboard']));
  });

  it('adminGuard bloqueia colaborador', () => {
    const result = runGuard(
      adminGuard,
      { id: '2', name: 'F', email: 'f@b.c', role: 'OPERATOR' },
      true,
    );
    expect(result).toEqual(router.createUrlTree(['/portal']));
  });

  it('employeeGuard bloqueia admin', () => {
    const result = runGuard(employeeGuard, { id: '1', name: 'A', email: 'a@b.c', role: 'ADMIN' }, true);
    expect(result).toEqual(router.createUrlTree(['/dashboard']));
  });
});
