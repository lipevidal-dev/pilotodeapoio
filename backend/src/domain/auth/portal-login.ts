export const PORTAL_LOGIN_MAX = 20;
export const PORTAL_PASSWORD_MIN = 6;
/** Igual ao limite do login. Antes o cadastro aceitava só 20 e a senha digitada na entrada era cortada. */
export const PORTAL_PASSWORD_MAX = 120;

const LOGIN_PATTERN = /^[a-z0-9._@-]+$/;

export function normalizePortalLogin(value: string | null | undefined): string | null {
  if (value == null) return null;
  const login = value.trim().toLowerCase();
  return login.length === 0 ? null : login;
}

export function isValidPortalLogin(login: string): boolean {
  return (
    login.length >= 3 &&
    login.length <= PORTAL_LOGIN_MAX &&
    LOGIN_PATTERN.test(login)
  );
}

export interface PortalLoginOwner {
  id: string;
  employeeId: string | null;
  role: string;
}

/**
 * Conflito real: admin, ou login já vinculado a outro funcionário.
 * O próprio usuário (mesmo employeeId) e uma conta de portal ainda sem vínculo
 * não bloqueiam — esse falso conflito impedia trocar a senha.
 */
export function isPortalLoginTaken(
  owner: PortalLoginOwner | null,
  employeeId: string,
): boolean {
  if (!owner) return false;
  if (owner.role === "ADMIN") return true;
  if (owner.employeeId && owner.employeeId !== employeeId) return true;
  return false;
}

export function displayPortalLogin(
  users: Array<{ login?: string | null; email: string; role: string }> | undefined,
): string | null {
  const portal = (users ?? []).find((user) => user.role !== "ADMIN");
  if (!portal) return null;
  const login = portal.login?.trim();
  return login || portal.email;
}
