import type { EmployeeType } from "@prisma/client";
import {
  RoleInactiveError,
  RoleNotFoundError,
  UnsupportedMotorRoleError,
} from "../errors/role.errors.js";
import { employeeToApi } from "../../infrastructure/mappers/employee-api.mapper.js";
import { EmployeeRepository } from "../../infrastructure/repositories/employee.repository.js";
import { RoleRepository } from "../../infrastructure/repositories/role.repository.js";
import {
  canPhysicallyDeleteEmployee,
  EmployeeHasOperationalHistoryError,
} from "./employee-delete.js";

function toEmployeeType(code: string): EmployeeType {
  const upper = code.toUpperCase();
  if (upper === "APAO") return "APAO";
  if (upper === "PAO") return "PAO";
  throw new UnsupportedMotorRoleError(code);
}

export class EmployeeUseCase {
  constructor(
    private readonly repo = new EmployeeRepository(),
    private readonly roleRepo = new RoleRepository(),
  ) {}

  async list(activeOnly = false) {
    const rows = await this.repo.findAll(activeOnly);
    return rows.map(employeeToApi);
  }

  async getById(id: string) {
    const row = await this.repo.findById(id);
    return row ? employeeToApi(row) : null;
  }

  private async resolveRoleForCreate(roleId?: string, type?: string) {
    if (roleId) {
      const role = await this.roleRepo.findById(roleId);
      if (!role) throw new RoleNotFoundError();
      if (!role.active) throw new RoleInactiveError();
      return { roleId: role.id, type: toEmployeeType(role.code) };
    }
    const code = type!.toUpperCase();
    const role = await this.roleRepo.findByCode(code);
    return {
      roleId: role?.id ?? null,
      type: toEmployeeType(code),
    };
  }

  private async resolveRoleForUpdate(
    roleId: string | undefined,
    type: string | undefined,
    isCreate: boolean,
  ) {
    if (roleId !== undefined) {
      const role = await this.roleRepo.findById(roleId);
      if (!role) throw new RoleNotFoundError();
      if (isCreate && !role.active) throw new RoleInactiveError();
      return { roleId: role.id, type: toEmployeeType(role.code) };
    }
    if (type !== undefined) {
      const role = await this.roleRepo.findByCode(type);
      return {
        roleId: role?.id ?? null,
        type: toEmployeeType(type),
      };
    }
    return null;
  }

  async create(data: {
    name: string;
    roleId?: string;
    type?: string;
    birthDate?: string | null;
    active?: boolean;
  }) {
    const resolved = await this.resolveRoleForCreate(data.roleId, data.type);
    const row = await this.repo.create({
      name: data.name,
      type: resolved.type,
      roleId: resolved.roleId,
      birthDate: data.birthDate ?? null,
      active: data.active ?? true,
    });
    return employeeToApi(row);
  }

  async update(
    id: string,
    data: { name?: string; roleId?: string; type?: string; birthDate?: string | null; active?: boolean },
  ) {
    const current = await this.repo.findById(id);
    if (!current) throw new Error("NOT_FOUND");

    const resolved = await this.resolveRoleForUpdate(data.roleId, data.type, false);
    const patch: Parameters<EmployeeRepository["update"]>[1] = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.active !== undefined) patch.active = data.active;
    if (data.birthDate !== undefined) patch.birthDate = data.birthDate;
    if (resolved) {
      patch.roleId = resolved.roleId;
      patch.type = resolved.type;
    }

    const row = await this.repo.update(id, patch);
    return employeeToApi(row);
  }

  async remove(id: string) {
    const row = await this.repo.findById(id);
    if (!row) throw new Error("NOT_FOUND");

    const history = await this.repo.countOperationalHistory(id);
    if (!canPhysicallyDeleteEmployee(history)) {
      throw new EmployeeHasOperationalHistoryError();
    }

    await this.repo.delete(id);
  }
}

export const employeeUseCase = new EmployeeUseCase();
