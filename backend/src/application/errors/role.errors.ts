export class RoleNotFoundError extends Error {
  constructor() {
    super("Cargo não encontrado");
    this.name = "RoleNotFoundError";
  }
}

export class RoleInactiveError extends Error {
  constructor() {
    super("Cargo inativo não pode ser usado em novos cadastros");
    this.name = "RoleInactiveError";
  }
}

export class UnsupportedMotorRoleError extends Error {
  constructor(code: string) {
    super(`Cargo ${code} ainda não é suportado pelo motor de escala (use PAO ou APAO)`);
    this.name = "UnsupportedMotorRoleError";
  }
}
