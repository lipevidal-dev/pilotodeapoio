import type { UserRole } from "@prisma/client";
import { InvalidAuthTokenError, InvalidCredentialsError } from "../errors/auth.errors.js";
import { hashPassword, verifyPassword } from "../../infrastructure/auth/password.js";
import { createAuthToken, verifyAuthToken } from "../../infrastructure/auth/token.js";
import { userRepository } from "../../infrastructure/repositories/user.repository.js";

export interface AuthUserDto {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface LoginResultDto {
  token: string;
  user: AuthUserDto;
}

const BUILTIN_USERS: Array<{
  id: string;
  name: string;
  email: string;
  aliases: string[];
  passwordHash: string;
  role: UserRole;
}> = [
  {
    id: "builtin-licencas-admin",
    name: "Admin Licenças",
    email: "licençasadmin",
    aliases: ["licençasadmin", "licencasadmin"],
    passwordHash: hashPassword("@Boeing300*"),
    role: "EMPLOYEES_ADMIN",
  },
];

function findBuiltinUserByLogin(login: string) {
  const normalized = login.toLowerCase().trim();
  return BUILTIN_USERS.find((u) => u.aliases.includes(normalized)) ?? null;
}

function findBuiltinUserById(id: string) {
  return BUILTIN_USERS.find((u) => u.id === id) ?? null;
}

function toAuthUser(row: { id: string; name: string; email: string; role: UserRole }): AuthUserDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
  };
}

export class AuthUseCase {
  async login(email: string, password: string): Promise<LoginResultDto> {
    const dbUser = await userRepository.findByEmail(email);
    const user = dbUser ?? findBuiltinUserByLogin(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new InvalidCredentialsError();
    }
    const token = createAuthToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
    return { token, user: toAuthUser(user) };
  }

  async me(token: string): Promise<AuthUserDto> {
    const payload = verifyAuthToken(token);
    if (!payload) {
      throw new InvalidAuthTokenError();
    }
    const dbUser = await userRepository.findById(payload.sub);
    const user = dbUser ?? findBuiltinUserById(payload.sub);
    if (!user) {
      throw new InvalidAuthTokenError();
    }
    return toAuthUser(user);
  }
}

export const authUseCase = new AuthUseCase();
