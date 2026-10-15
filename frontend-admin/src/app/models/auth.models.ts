export type UserRole = 'ADMIN' | 'OPERATOR' | 'PILOT';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  employeeId?: string | null;
  notificationEmail?: string | null;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface MeResponse {
  user: AuthUser;
}

export interface MfaChallengeResponse {
  mfaRequired: true;
  challengeToken: string;
}

export interface MfaSetupChallengeResponse {
  mfaSetupRequired: true;
  challengeToken: string;
  qrCodeDataUrl: string;
  manualKey: string;
}

/** Roles de colaborador (portal /portal) — OPERATOR e PILOT mapeiam para EMPLOYEE na spec. */
export function isEmployeeRole(role: UserRole): boolean {
  return role === 'OPERATOR' || role === 'PILOT';
}

export function isAdminRole(role: UserRole): boolean {
  return role === 'ADMIN';
}

function asciiLogin(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function isEmployeesOnlyAdminLogin(value: string | null | undefined): boolean {
  const normalized = asciiLogin(value).replace(/[^a-z0-9._@-]/g, '');
  return normalized === 'licencasadmin' || normalized === 'licenasadmin';
}

export function isEmployeesOnlyAdminUser(
  user: { role: UserRole; email?: string | null } | null | undefined,
): boolean {
  if (!user) return false;
  return isEmployeesOnlyAdminLogin(user.email);
}

export function homeRouteForRole(role: UserRole, email?: string | null): string {
  if (isEmployeesOnlyAdminLogin(email)) return '/funcionarios';
  return isAdminRole(role) ? '/dashboard' : '/portal';
}

export function homeRouteForUser(user: { role: UserRole; email?: string | null }): string {
  return homeRouteForRole(user.role, user.email);
}
