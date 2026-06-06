import { roleToApi } from "../../infrastructure/mappers/role-api.mapper.js";
import { RoleRepository } from "../../infrastructure/repositories/role.repository.js";
import { RoleInUseError } from "./role-delete.js";

export class RoleUseCase {
  constructor(private readonly repo = new RoleRepository()) {}

  async list(activeOnly = false) {
    const rows = await this.repo.findAll(activeOnly);
    return rows.map(roleToApi);
  }

  async getById(id: string) {
    const row = await this.repo.findById(id);
    return row ? roleToApi(row) : null;
  }

  async create(data: {
    name: string;
    code: string;
    description?: string | null;
    active?: boolean;
    displayOrder?: number;
  }) {
    const row = await this.repo.create(data);
    return roleToApi(row);
  }

  async update(
    id: string,
    data: {
      name?: string;
      code?: string;
      description?: string | null;
      active?: boolean;
      displayOrder?: number;
    },
  ) {
    const current = await this.repo.findById(id);
    if (!current) throw new Error("NOT_FOUND");
    const row = await this.repo.update(id, data);
    return roleToApi(row);
  }

  async remove(id: string) {
    const row = await this.repo.findById(id);
    if (!row) throw new Error("NOT_FOUND");

    const linked = await this.repo.countEmployees(id);
    if (linked > 0) throw new RoleInUseError();

    await this.repo.delete(id);
  }
}

export const roleUseCase = new RoleUseCase();
