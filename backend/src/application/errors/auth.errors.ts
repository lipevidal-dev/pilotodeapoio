export class InvalidCredentialsError extends Error {
  readonly code = "INVALID_CREDENTIALS";
  constructor() {
    super("E-mail ou senha inválidos.");
    this.name = "InvalidCredentialsError";
  }
}

export class InvalidAuthTokenError extends Error {
  readonly code = "INVALID_TOKEN";
  constructor() {
    super("Token de autenticação inválido ou expirado.");
    this.name = "InvalidAuthTokenError";
  }
}
