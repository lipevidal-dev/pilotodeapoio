import { Prisma } from "@prisma/client";
import {
  EmployeePortalLoginInUseError,
  EmployeePortalPasswordRequiredError,
} from "../errors/employee.errors.js";
import { isPortalLoginTaken, normalizePortalLogin } from "../../domain/auth/portal-login.js";
import { hashPassword } from "../../infrastructure/auth/password.js";
import { userRepository } from "../../infrastructure/repositories/user.repository.js";

export interface SyncPortalAccessInput {
  employeeId: string;
  employeeName: string;
  portalLogin?: string | null;
  portalPassword?: string | null;
}

function isUniqueConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

async function clearPortalAccess(employeeId: string): Promise<void> {
  const linked = await userRepository.findPortalUserByEmployeeId(employeeId);
  if (!linked || linked.role === "ADMIN") return;
  await userRepository.deleteById(linked.id);
}

/**
 * Cria ou atualiza o acesso do colaborador.
 * Salvar o mesmo login (só para trocar a senha) não é tratado como duplicata.
 */
export async function syncPortalAccess(input: SyncPortalAccessInput): Promise<void> {
  const password = input.portalPassword?.trim() ? input.portalPassword.trim() : null;
  if (input.portalLogin === undefined && !password) return;

  const login = normalizePortalLogin(input.portalLogin ?? null);
  if (!login) {
    if (input.portalLogin !== undefined) await clearPortalAccess(input.employeeId);
    return;
  }

  const owner = await userRepository.findByLogin(login);
  if (isPortalLoginTaken(owner, input.employeeId)) {
    throw new EmployeePortalLoginInUseError();
  }

  const linked = await userRepository.findPortalUserByEmployeeId(input.employeeId);
  if (owner && linked && owner.id !== linked.id) {
    throw new EmployeePortalLoginInUseError();
  }

  const target = owner ?? linked;
  if (!target) {
    if (!password) throw new EmployeePortalPasswordRequiredError();
    try {
      await userRepository.createPortalUser({
        employeeId: input.employeeId,
        name: input.employeeName,
        login,
        passwordHash: hashPassword(password),
      });
    } catch (err) {
      if (isUniqueConflict(err)) throw new EmployeePortalLoginInUseError();
      throw err;
    }
    return;
  }

  const email = target.email.includes("@") ? target.email : login;
  try {
    await userRepository.updatePortalUser(target.id, {
      employeeId: input.employeeId,
      name: input.employeeName,
      login,
      email,
      ...(password ? { passwordHash: hashPassword(password) } : {}),
    });
  } catch (err) {
    if (isUniqueConflict(err)) throw new EmployeePortalLoginInUseError();
    throw err;
  }
}
