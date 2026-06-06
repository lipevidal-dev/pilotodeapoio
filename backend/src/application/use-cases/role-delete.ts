export class RoleInUseError extends Error {
  readonly code = "ROLE_IN_USE" as const;

  constructor() {
    super(
      "Existem funcionários vinculados a este cargo. Inative o cargo em vez de excluir.",
    );
    this.name = "RoleInUseError";
  }
}
