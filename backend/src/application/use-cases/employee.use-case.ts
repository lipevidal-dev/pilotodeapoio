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

import {
  EmployeeDuplicatePreferredShiftError,
  EmployeePreferredShiftNotFoundError,
  EmployeeShiftPreferenceConflictError,
} from "../errors/employee.errors.js";

import { ShiftRepository } from "../../infrastructure/repositories/shift.repository.js";



function toEmployeeType(code: string): EmployeeType {

  const upper = code.toUpperCase();

  if (upper === "APAO") return "APAO";

  if (upper === "PAO") return "PAO";

  throw new UnsupportedMotorRoleError(code);

}



type RestrictionFields = {

  noFlightDates?: string[];

  restrictedShiftIds?: string[];

  preferredShiftIds?: string[];

  specificShiftRequests?: Array<{
    shiftId: string;
    year?: number | null;
    month?: number | null;
    dayOfMonth?: number | null;
    weekday?: number | null;
  }>;

};



export class EmployeeUseCase {

  constructor(

    private readonly repo = new EmployeeRepository(),

    private readonly roleRepo = new RoleRepository(),

    private readonly shiftRepo = new ShiftRepository(),

  ) {}



  async list(activeOnly = false) {

    const rows = await this.repo.findAll(activeOnly);

    return rows.map((row) =>

      employeeToApi({

        ...row,

        flightRestrictions: [],

        shiftRestrictions: [],

        preferredShifts: [],

      }),

    );

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



  private async validateShiftPreferences(
    restrictedShiftIds: string[] | undefined,
    preferredShiftIds: string[] | undefined,
    current?: { restrictedShiftIds: string[]; preferredShiftIds: string[] },
  ): Promise<void> {
    const restricted = restrictedShiftIds ?? current?.restrictedShiftIds ?? [];
    const preferred = preferredShiftIds ?? current?.preferredShiftIds ?? [];

    if (preferred.length !== new Set(preferred).size) {
      throw new EmployeeDuplicatePreferredShiftError();
    }

    if (preferred.length > 0) {
      const shifts = await this.shiftRepo.findAll(false);
      const validIds = new Set(shifts.map((s) => s.id));
      for (const shiftId of preferred) {
        if (!validIds.has(shiftId)) {
          throw new EmployeePreferredShiftNotFoundError(shiftId);
        }
      }
    }

    const restrictedSet = new Set(restricted);
    for (const shiftId of preferred) {
      if (restrictedSet.has(shiftId)) {
        throw new EmployeeShiftPreferenceConflictError();
      }
    }
  }



  async create(

    data: {

      name: string;

      roleId?: string;

      type?: string;

      birthDate?: string | null;

      seniorityNumber?: number;

      active?: boolean;

    } & RestrictionFields,

  ) {

    const resolved = await this.resolveRoleForCreate(data.roleId, data.type);

    await this.validateShiftPreferences(data.restrictedShiftIds, data.preferredShiftIds);

    const row = await this.repo.create({

      name: data.name,

      type: resolved.type,

      roleId: resolved.roleId,

      birthDate: data.birthDate ?? null,

      seniorityNumber: data.seniorityNumber,

      active: data.active ?? true,

      noFlightDates: data.noFlightDates,

      restrictedShiftIds: data.restrictedShiftIds,

      preferredShiftIds: data.preferredShiftIds,

      specificShiftRequests: data.specificShiftRequests,

    });

    return employeeToApi(row);

  }



  async update(

    id: string,

    data: {

      name?: string;

      roleId?: string;

      type?: string;

      birthDate?: string | null;

      seniorityNumber?: number | null;

      active?: boolean;

    } & RestrictionFields,

  ) {

    const current = await this.repo.findById(id);

    if (!current) throw new Error("NOT_FOUND");



    const currentDetail = await this.repo.findById(id);

    await this.validateShiftPreferences(
      data.restrictedShiftIds,
      data.preferredShiftIds,
      currentDetail
        ? {
            restrictedShiftIds: (currentDetail.shiftRestrictions ?? []).map((r) => r.shiftId),
            preferredShiftIds: (currentDetail.preferredShifts ?? []).map((r) => r.shiftId),
          }
        : undefined,
    );

    const resolved = await this.resolveRoleForUpdate(data.roleId, data.type, false);

    const patch: Parameters<EmployeeRepository["update"]>[1] = {};

    if (data.name !== undefined) patch.name = data.name;

    if (data.active !== undefined) patch.active = data.active;

    if (data.birthDate !== undefined) patch.birthDate = data.birthDate;

    if (data.seniorityNumber !== undefined) patch.seniorityNumber = data.seniorityNumber;

    if (data.noFlightDates !== undefined) patch.noFlightDates = data.noFlightDates;

    if (data.restrictedShiftIds !== undefined) patch.restrictedShiftIds = data.restrictedShiftIds;

    if (data.preferredShiftIds !== undefined) patch.preferredShiftIds = data.preferredShiftIds;

    if (data.specificShiftRequests !== undefined) patch.specificShiftRequests = data.specificShiftRequests;

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

      throw new EmployeeHasOperationalHistoryError(history);

    }



    await this.repo.delete(id);

  }

}



export const employeeUseCase = new EmployeeUseCase();

