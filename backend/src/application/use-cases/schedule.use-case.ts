import type { PreAllocation } from "@prisma/client";
import { ScheduleRepository } from "../../infrastructure/repositories/schedule.repository.js";
import { logOperationalCadastroDebug } from "../services/operational-cadastro-debug.js";
import { operationalCadastroService } from "../services/operational-cadastro.service.js";
import { ScheduleNotPublishedError } from "../errors/schedule.errors.js";

export class ScheduleUseCase {
  constructor(private readonly scheduleRepo: ScheduleRepository = new ScheduleRepository()) {}

  async getPublishedMonth(year: number, month: number) {
    const record = await this.scheduleRepo.findPublishedMonth(year, month);
    if (!record) {
      throw new ScheduleNotPublishedError(year, month);
    }

    const shifts = await this.scheduleRepo.listShifts();
    const employees = await this.scheduleRepo.listActiveEmployees();

    return {
      scheduleMonth: record,
      employees,
      shifts,
      assignments: record.assignments,
      preAllocations: record.preAllocations,
    };
  }

  private async loadOperationalCadastros(
    year: number,
    month: number,
    preAllocations?: PreAllocation[],
  ) {
    const operationalCadastros = await operationalCadastroService.getOperationalCadastrosForMonth(
      year,
      month,
      undefined,
      preAllocations,
    );
    logOperationalCadastroDebug(year, month, operationalCadastros);
    return operationalCadastros;
  }

  async getOperationalCadastros(year: number, month: number, employeeId?: string) {
    return operationalCadastroService.getOperationalCadastrosForMonth(year, month, employeeId);
  }

  async getOperationalCadastrosDebug(year: number, month: number) {
    return operationalCadastroService.buildDebugReport(year, month);
  }

  async getMonth(year: number, month: number) {
    const record = await this.scheduleRepo.findMonth(year, month);
    if (!record) {
      const ensured = await this.scheduleRepo.ensureMonth(year, month);
      const fresh = await this.scheduleRepo.findMonth(year, month);
      const shifts = await this.scheduleRepo.listShifts();
      const employees = await this.scheduleRepo.listActiveEmployees();
      const operationalCadastros = await this.loadOperationalCadastros(year, month);
      return {
        scheduleMonth: ensured,
        employees,
        shifts,
        assignments: fresh?.assignments ?? [],
        preAllocations: fresh?.preAllocations ?? [],
        operationalCadastros,
        ruleViolations: [],
        validation: null,
      };
    }

    const [shifts, employees, operationalCadastros] = await Promise.all([
      this.scheduleRepo.listShifts(),
      this.scheduleRepo.listActiveEmployees(),
      this.loadOperationalCadastros(year, month, record.preAllocations),
    ]);

    // GET não revalida o motor: as violações já estão em ruleViolations.
    return {
      scheduleMonth: record,
      employees,
      shifts,
      assignments: record.assignments,
      preAllocations: record.preAllocations,
      operationalCadastros,
      ruleViolations: record.ruleViolations,
      validation: null,
    };
  }
}

export const scheduleUseCase = new ScheduleUseCase();
