export interface MotorRoleCodes {
  pao: string;
  apao: string;
}

export const DEFAULT_MOTOR_ROLE_CODES: MotorRoleCodes = {
  pao: "PAO",
  apao: "APAO",
};

export function resolveMotorRoleCodes(
  roles: Array<{ code: string; active?: boolean }>,
): MotorRoleCodes {
  const active = roles.filter((r) => r.active !== false);
  const byCode = new Map(active.map((r) => [r.code.toUpperCase(), r.code]));
  return {
    pao: byCode.get("PAO") ?? DEFAULT_MOTOR_ROLE_CODES.pao,
    apao: byCode.get("APAO") ?? DEFAULT_MOTOR_ROLE_CODES.apao,
  };
}

export function isMotorPaoRole(role: string, codes: MotorRoleCodes): boolean {
  return role.toUpperCase() === codes.pao.toUpperCase();
}

export function isMotorApaoRole(role: string, codes: MotorRoleCodes): boolean {
  return role.toUpperCase() === codes.apao.toUpperCase();
}
