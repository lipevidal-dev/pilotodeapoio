import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { adminGuard, employeeGuard, fullAdminGuard, guestGuard } from './auth.guard';
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

  it('guestGuard redireciona EMPLOYEES_ADMIN autenticado para funcionarios', () => {
    const result = runGuard(
      guestGuard,
      { id: '3', name: 'Licenças', email: 'licençasadmin', role: 'EMPLOYEES_ADMIN' },
      true,
    );
    expect(result).toEqual(router.createUrlTree(['/funcionarios']));
  });

  it('adminGuard bloqueia colaborador', () => {
    const result = runGuard(
      adminGuard,
      { id: '2', name: 'F', email: 'f@b.c', role: 'OPERATOR' },
      true,
    );
    expect(result).toEqual(router.createUrlTree(['/portal']));
  });

  it('adminGuard permite EMPLOYEES_ADMIN', () => {
    const result = runGuard(
      adminGuard,
      { id: '3', name: 'Licenças', email: 'licençasadmin', role: 'EMPLOYEES_ADMIN' },
      true,
    );
    expect(result).toBeTrue();
  });

  it('fullAdminGuard redireciona EMPLOYEES_ADMIN para /funcionarios', () => {
    const result = runGuard(
      fullAdminGuard,
      { id: '3', name: 'Licenças', email: 'licençasadmin', role: 'EMPLOYEES_ADMIN' },
      true,
    );
    expect(result).toEqual(router.createUrlTree(['/funcionarios']));
  });

  it('employeeGuard bloqueia admin', () => {
    const result = runGuard(employeeGuard, { id: '1', name: 'A', email: 'a@b.c', role: 'ADMIN' }, true);
    expect(result).toEqual(router.createUrlTree(['/dashboard']));
  });
});
