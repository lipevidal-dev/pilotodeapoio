import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { UserRole } from "@prisma/client";
import { AuthUseCase } from "../application/use-cases/auth.use-case.js";
import { InvalidCredentialsError, InvalidAuthTokenError } from "../application/errors/auth.errors.js";
import { createAuthToken } from "../infrastructure/auth/token.js";
import { hashPassword } from "../infrastructure/auth/password.js";
import * as userRepoModule from "../infrastructure/repositories/user.repository.js";

describe("AuthUseCase", () => {
  const adminUser = {
    id: "user-admin",
    name: "Admin",
    email: "admin@test.local",
    passwordHash: hashPassword("secret123"),
    role: UserRole.ADMIN,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("login retorna token e usuário com credenciais válidas", async () => {
    vi.spyOn(userRepoModule.userRepository, "findByEmail").mockResolvedValue(adminUser);
    const uc = new AuthUseCase();
    const result = await uc.login("admin@test.local", "secret123");
    expect(result.user.role).toBe("ADMIN");
    expect(result.token).toBeTruthy();
    expect(result.user.email).toBe("admin@test.local");
  });

  it("login falha com senha incorreta", async () => {
    vi.spyOn(userRepoModule.userRepository, "findByEmail").mockResolvedValue(adminUser);
    const uc = new AuthUseCase();
    await expect(uc.login("admin@test.local", "wrong")).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("me retorna usuário com token válido", async () => {
    const token = createAuthToken({
      sub: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      role: adminUser.role,
    });
    vi.spyOn(userRepoModule.userRepository, "findById").mockResolvedValue(adminUser);
    const uc = new AuthUseCase();
    const user = await uc.me(token);
    expect(user.id).toBe(adminUser.id);
  });

  it("me falha com token inválido", async () => {
    const uc = new AuthUseCase();
    await expect(uc.me("invalid.token.here")).rejects.toBeInstanceOf(InvalidAuthTokenError);
  });
});
