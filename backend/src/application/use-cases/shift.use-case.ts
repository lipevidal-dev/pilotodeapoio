import type { EmployeeTypeAllowed } from "@prisma/client";
import { computeShiftDurationHours } from "../../domain/shift/duration.js";
import { shiftToApi } from "../../infrastructure/mappers/shift-api.mapper.js";
import { ShiftRepository } from "../../infrastructure/repositories/shift.repository.js";
import {
  canPhysicallyDeleteShift,
  ShiftHasOperationalHistoryError,
} from "./shift-delete.js";

function toPrismaRole(roleType: string): EmployeeTypeAllowed {
  if (roleType === "APAO") return "APAO";
  if (roleType === "BOTH") return "BOTH";
  return "PAO";
}

export class ShiftUseCase {
  constructor(private readonly repo = new ShiftRepository()) {}

  async list(activeOnly = false) {
    const rows = await this.repo.findAll(activeOnly);
    return rows.map(shiftToApi);
  }

  async getById(id: string) {
    const row = await this.repo.findById(id);
    return row ? shiftToApi(row) : null;
  }

  async create(data: {
    code: string;
    name: string;
    startTime: string;
    endTime: string;
    roleType: string;
    active?: boolean;
    displayOrder?: number;
    mandatoryCoverage?: boolean;
    requiresT8PairNd?: boolean;
    coverageType?: "REQUIRED" | "PARALLEL";
  }) {
    const durationHours = computeShiftDurationHours(data.startTime, data.endTime);
    const coverageType = data.coverageType ?? "REQUIRED";
    const row = await this.repo.create({
      code: data.code,
      name: data.name,
      startTime: data.startTime,
      endTime: data.endTime,
      durationHours,
      employeeTypeAllowed: toPrismaRole(data.roleType),
      active: data.active ?? true,
      displayOrder: data.displayOrder ?? 0,
      mandatoryCoverage: coverageType === "PARALLEL" ? false : (data.mandatoryCoverage ?? false),
      requiresT8PairNd: data.requiresT8PairNd ?? false,
      coverageType,
    });
    return shiftToApi(row);
  }

  async update(
    id: string,
    data: {
      code?: string;
      name?: string;
      startTime?: string;
      endTime?: string;
      roleType?: string;
      active?: boolean;
      displayOrder?: number;
      mandatoryCoverage?: boolean;
      requiresT8PairNd?: boolean;
      coverageType?: "REQUIRED" | "PARALLEL";
    },
  ) {
    const current = await this.repo.findById(id);
    if (!current) throw new Error("NOT_FOUND");

    const startTime = data.startTime ?? current.startTime;
    const endTime = data.endTime ?? current.endTime;
    const durationHours = computeShiftDurationHours(startTime, endTime);
    const coverageType = data.coverageType ?? current.coverageType;

    const patch: Parameters<ShiftRepository["update"]>[1] = { durationHours };
    if (data.code !== undefined) patch.code = data.code;
    if (data.name !== undefined) patch.name = data.name;
    if (data.startTime !== undefined) patch.startTime = data.startTime;
    if (data.endTime !== undefined) patch.endTime = data.endTime;
    if (data.roleType !== undefined) patch.employeeTypeAllowed = toPrismaRole(data.roleType);
    if (data.active !== undefined) patch.active = data.active;
    if (data.displayOrder !== undefined) patch.displayOrder = data.displayOrder;
    if (data.coverageType !== undefined) patch.coverageType = data.coverageType;
    if (data.mandatoryCoverage !== undefined) patch.mandatoryCoverage = data.mandatoryCoverage;
    if (data.requiresT8PairNd !== undefined) patch.requiresT8PairNd = data.requiresT8PairNd;
    if (coverageType === "PARALLEL") {
      patch.mandatoryCoverage = false;
    }

    const row = await this.repo.update(id, patch);
    return shiftToApi(row);
  }

  async remove(id: string) {
    const row = await this.repo.findById(id);
    if (!row) throw new Error("NOT_FOUND");

    const history = await this.repo.countOperationalHistory(row.code);
    if (!canPhysicallyDeleteShift(history)) {
      throw new ShiftHasOperationalHistoryError();
    }

    await this.repo.delete(id);
  }
}

export const shiftUseCase = new ShiftUseCase();
