import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { AuthService } from '../services/auth.service';
import { isAdminRole, isEmployeeRole } from '../models/auth.models';

export const guestGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (!environment.authRequired) {
    return router.createUrlTree(['/dashboard']);
  }
  const auth = inject(AuthService);
  const user = auth.user();
  if (!auth.isAuthenticated() || !user) {
    return true;
  }
  return router.createUrlTree([isAdminRole(user.role) ? '/dashboard' : '/portal']);
};

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!environment.authRequired) {
    auth.ensureOpenAccessSession();
    return true;
  }
  const user = auth.user();
  if (!auth.isAuthenticated() || !user) {
    return router.createUrlTree(['/login']);
  }
  if (!isAdminRole(user.role)) {
    return router.createUrlTree(['/portal']);
  }
  return true;
};

export const employeeGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!environment.authRequired) {
    // Sem login, o acesso padrão é o painel admin.
    return router.createUrlTree(['/dashboard']);
  }
  const user = auth.user();
  if (!auth.isAuthenticated() || !user) {
    return router.createUrlTree(['/login']);
  }
  if (!isEmployeeRole(user.role)) {
    return router.createUrlTree(['/dashboard']);
  }
  return true;
};

export const authBootstrapGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!environment.authRequired) {
    auth.ensureOpenAccessSession();
    return router.createUrlTree(['/dashboard']);
  }
  const user = auth.user();
  if (!auth.isAuthenticated() || !user) {
    return router.createUrlTree(['/login']);
  }
  return router.createUrlTree([isAdminRole(user.role) ? '/dashboard' : '/portal']);
};
