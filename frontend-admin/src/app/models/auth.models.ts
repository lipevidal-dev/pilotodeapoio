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

export function homeRouteForRole(role: UserRole): string {
  return isAdminRole(role) ? '/dashboard' : '/portal';
}
