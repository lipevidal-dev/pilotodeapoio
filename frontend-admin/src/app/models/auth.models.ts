export type UserRole = 'ADMIN' | 'EMPLOYEES_ADMIN' | 'OPERATOR' | 'PILOT';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface MeResponse {
  user: AuthUser;
}

/** Roles de colaborador (portal /portal) — OPERATOR e PILOT mapeiam para EMPLOYEE na spec. */
export function isEmployeeRole(role: UserRole): boolean {
  return role === 'OPERATOR' || role === 'PILOT';
}

export function isAdminRole(role: UserRole): boolean {
  return role === 'ADMIN' || role === 'EMPLOYEES_ADMIN';
}

export function isFullAdminRole(role: UserRole): boolean {
  return role === 'ADMIN';
}

export function isEmployeesOnlyAdminRole(role: UserRole): boolean {
  return role === 'EMPLOYEES_ADMIN';
}

export function homeRouteForRole(role: UserRole): string {
  if (role === 'EMPLOYEES_ADMIN') return '/funcionarios';
  return isAdminRole(role) ? '/dashboard' : '/portal';
}
