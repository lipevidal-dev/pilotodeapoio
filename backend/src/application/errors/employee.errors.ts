export class EmployeeShiftPreferenceConflictError extends Error {
  readonly code = "EMPLOYEE_SHIFT_PREFERENCE_CONFLICT";

  constructor() {
    super("Turno não pode estar em restrição e preferência ao mesmo tempo");
    this.name = "EmployeeShiftPreferenceConflictError";
  }
}

export class EmployeePreferredShiftNotFoundError extends Error {
  readonly code = "EMPLOYEE_PREFERRED_SHIFT_NOT_FOUND";

  constructor(shiftId: string) {
    super(`Turno preferido não encontrado: ${shiftId}`);
    this.name = "EmployeePreferredShiftNotFoundError";
  }
}

export class EmployeeDuplicatePreferredShiftError extends Error {
  readonly code = "EMPLOYEE_DUPLICATE_PREFERRED_SHIFT";

  constructor() {
    super("preferredShiftIds contém IDs duplicados");
    this.name = "EmployeeDuplicatePreferredShiftError";
  }
}

export class EmployeeFcfConfigInvalidError extends Error {
  readonly code = "EMPLOYEE_FCF_CONFIG_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "EmployeeFcfConfigInvalidError";
  }
}

export class EmployeePortalLoginInUseError extends Error {
  readonly code = "EMPLOYEE_PORTAL_LOGIN_IN_USE";

  constructor() {
    super("Este login já está em uso por outro usuário.");
    this.name = "EmployeePortalLoginInUseError";
  }
}

export class EmployeePortalPasswordRequiredError extends Error {
  readonly code = "EMPLOYEE_PORTAL_PASSWORD_REQUIRED";

  constructor() {
    super("Informe a senha para criar o acesso ao portal colaborador.");
    this.name = "EmployeePortalPasswordRequiredError";
  }
}

export class EmployeeFcfShiftNotFoundError extends Error {
  readonly code = "EMPLOYEE_FCF_SHIFT_NOT_FOUND";

  constructor(shiftId: string) {
    super(`Turno FCF não encontrado ou inativo: ${shiftId}`);
    this.name = "EmployeeFcfShiftNotFoundError";
  }
}
