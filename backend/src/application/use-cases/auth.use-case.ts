import type { UserRole } from "@prisma/client";
import { InvalidAuthTokenError, InvalidCredentialsError } from "../errors/auth.errors.js";
import { verifyPassword } from "../../infrastructure/auth/password.js";
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
    const user = await userRepository.findByEmail(email);
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
    const user = await userRepository.findById(payload.sub);
    if (!user) {
      throw new InvalidAuthTokenError();
    }
    return toAuthUser(user);
  }
}

export const authUseCase = new AuthUseCase();
