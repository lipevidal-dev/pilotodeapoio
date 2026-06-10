import type { ScheduleContext, ValidationIssue } from "../schedule/types.js";
import type { Rule } from "./base-rule.js";
import {
  MAX_PAO_REST_COUNT,
  MIN_PAO_REST_COUNT,
  MAX_REQUESTED_OFF_PER_MONTH,
  MONOFOLGA_REST_TYPES,
  PAO_REST_TYPES,
  BLOCK_TYPES,
} from "./constants.js";
import { addDays, isInMonth, iterDays } from "./dates.js";
import { buildPlannedWithHistory, consecutiveWorkCount } from "./consecutive.js";
import {
  buildRoleMap,
  buildShiftMapFromContext,
  listApaoWithoutPaoCompanion,
} from "./coverage.js";
import { countAvailableApaosOnDay, dayRequiresApaoCoverage } from "./apao-availability.js";
import { shiftStartEnd } from "./time.js";
import { validateT8Blocks } from "./t8-planner.js";
import { isEmployeePlanningActiveMonth, isEmployeeOnVacation } from "./vacation.js";

export class Rest12hRule implements Rule {
  readonly name = "Rest12hRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const shiftMap = buildShiftMapFromContext(ctx);
    const issues: ValidationIssue[] = [];
    const byEmployee = new Map<number, { name: string; rows: { day: string; code: string }[] }>();

    const allAssignments = [...(ctx.previousMonthAssignments ?? []), ...ctx.assignments];

    for (const a of allAssignments) {
      if (!byEmployee.has(a.employeeId)) {
        byEmployee.set(a.employeeId, { name: a.employeeName, rows: [] });
      }
      byEmployee.get(a.employeeId)!.rows.push({ day: a.workDate, code: a.shiftCode });
    }

    for (const { name, rows } of byEmployee.values()) {
      const intervals: { start: Date; end: Date; code: string; day: string }[] = [];
      for (const r of rows) {
        const info = shiftMap[r.code];
        if (!info) continue;
        const { start, end } = shiftStartEnd(r.day, info.startTime, info.endTime);
        intervals.push({ start, end, code: r.code, day: r.day });
      }
      intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
      for (let i = 1; i < intervals.length; i++) {
        const prev = intervals[i - 1];
        const curr = intervals[i];
        if (!isInMonth(curr.day, ctx.year, ctx.month)) continue;
        const restHours = (curr.start.getTime() - prev.end.getTime()) / 3_600_000;
        if (restHours < 12) {
          issues.push({
            severity: "ALTA",
            type: "DESCANSO MENOR QUE 12H",
            date: curr.day,
            employee: name,
            detail: `Descanso de ${restHours.toFixed(1)}h entre ${prev.code} e ${curr.code}. Mínimo: 12h.`,
          });
        }
      }
    }
    return issues;
  }
}

export class SimultaneousStationsRule implements Rule {
  readonly name = "SimultaneousStationsRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const shiftMap = buildShiftMapFromContext(ctx);
    const roleMap = buildRoleMap(ctx);
    const issues: ValidationIssue[] = [];
    const days = new Set(
      ctx.assignments.filter((a) => isInMonth(a.workDate, ctx.year, ctx.month)).map((a) => a.workDate),
    );

    for (const day of days) {
      const dayAssignments = ctx.assignments.filter((a) => a.workDate === day);
      type Ev = { time: Date; delta: number };
      const events: Ev[] = [];
      for (const a of dayAssignments) {
        const sh = a.shiftCode;
        if (sh === "T9" || sh === "T09") continue;
        if (roleMap.get(a.employeeId) === "PAO FCF") continue;
        const info = shiftMap[sh];
        if (!info) continue;
        const { start, end } = shiftStartEnd(day, info.startTime, info.endTime);
        events.push({ time: start, delta: 1 });
        events.push({ time: end, delta: -1 });
      }
      events.sort((a, b) => a.time.getTime() - b.time.getTime() || a.delta - b.delta);
      let current = 0;
      for (const e of events) {
        current += e.delta;
        if (current > 2) {
          issues.push({
            severity: "ALTA",
            type: "MAIS DE 2 SIMULTÂNEOS",
            date: day,
            employee: "-",
            detail: "Mais de 2 funcionários simultâneos. Limite físico: 2 estações.",
          });
          break;
        }
      }
    }
    return issues;
  }
}

/** P-002: APAO nunca sozinho — exige PAO na janela do turno. */
export class ApaoRequiresPaoRule implements Rule {
  readonly name = "ApaoRequiresPaoRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    return listApaoWithoutPaoCompanion(ctx).map((m) => ({
      severity: "ALTA" as const,
      type: "APAO SEM PAO",
      date: m.date,
      employee: m.employeeName,
      detail: `APAO no ${m.shiftCode} sem PAO cobrindo a janela horária do turno.`,
    }));
  }
}

/** Exige ≥1 APAO disponível em dias com PAO em T6 (escritório). */
export class ApaoAvailabilityRule implements Rule {
  readonly name = "ApaoAvailabilityRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const day of iterDays(ctx.year, ctx.month)) {
      if (!dayRequiresApaoCoverage(ctx, day)) continue;
      if (countAvailableApaosOnDay(ctx, day) < 1) {
        issues.push({
          severity: "ALTA",
          type: "SEM APAO DISPONÍVEL",
          date: day,
          employee: "-",
          detail:
            "Todos os APAOs estão folgando/bloqueados neste dia. Deve haver pelo menos 1 APAO disponível.",
        });
      }
    }
    return issues;
  }
}

/** Impede FA (FOLGA AGRUPADA) no mesmo dia para mais de um APAO. */
export class ApaoFolgaAgrupadaOverlapRule implements Rule {
  readonly name = "ApaoFolgaAgrupadaOverlapRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const roleMap = buildRoleMap(ctx);
    const byDate = new Map<string, string[]>();
    for (const a of ctx.allocations) {
      if (!isInMonth(a.allocDate, ctx.year, ctx.month)) continue;
      if (a.allocType.toUpperCase() !== "FOLGA AGRUPADA") continue;
      if (roleMap.get(a.employeeId) !== "APAO") continue;
      const list = byDate.get(a.allocDate) ?? [];
      list.push(a.employeeName);
      byDate.set(a.allocDate, list);
    }
    const issues: ValidationIssue[] = [];
    for (const [date, names] of byDate) {
      if (names.length <= 1) continue;
      issues.push({
        severity: "ALTA",
        type: "FA APAO DUPLICADA",
        date,
        employee: names.join(", "),
        detail: "FOLGA AGRUPADA no mesmo dia para mais de um APAO — deve haver APAO no escritório.",
      });
    }
    return issues;
  }
}

export class PaoAllowedShiftsRule implements Rule {
  readonly name = "PaoAllowedShiftsRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const a of ctx.assignments) {
      if (!isInMonth(a.workDate, ctx.year, ctx.month)) continue;
      const emp = ctx.employees.find((e) => e.id === a.employeeId);
      if (emp?.role !== "PAO") continue;
      const code = a.shiftCode.toUpperCase();
      if (["T1", "T2", "T3", "T4"].includes(code)) {
        issues.push({
          severity: "CRÍTICA",
          type: "TURNO APAO COBERTO POR PAO REGULAR",
          date: a.workDate,
          employee: a.employeeName,
          detail: `PAO em turno de APAO (${code}).`,
        });
      } else if (!["T6", "T7", "T8"].includes(code)) {
        issues.push({
          severity: "CRÍTICA",
          type: "TURNO NÃO PERMITIDO PARA PAO",
          date: a.workDate,
          employee: a.employeeName,
          detail: `PAO em turno inválido (${code}). Somente T6, T7, T8.`,
        });
      }
    }
    return issues;
  }
}

export class T8PairingRule implements Rule {
  readonly name = "T8PairingRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    return validateT8Blocks(ctx);
  }
}

export class ConsecutiveDaysRule implements Rule {
  readonly name = "ConsecutiveDaysRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const roleMap = buildRoleMap(ctx);
    const planned = buildPlannedWithHistory(ctx);
    const issues: ValidationIssue[] = [];
    const byEmp = new Map<number, string>();

    for (const a of ctx.assignments) {
      if (!isInMonth(a.workDate, ctx.year, ctx.month)) continue;
      if (roleMap.get(a.employeeId) === "PAO FCF") continue;
      byEmp.set(a.employeeId, a.employeeName);
    }

    for (const [empId, name] of byEmp) {
      const days = [
        ...new Set(
          ctx.assignments
            .filter((a) => a.employeeId === empId && isInMonth(a.workDate, ctx.year, ctx.month))
            .map((a) => a.workDate),
        ),
      ].sort();
      for (const d of days) {
        const prev = consecutiveWorkCount(empId, d, planned);
        if (prev >= 6) {
          issues.push({
            severity: "ALTA",
            type: "MAIS DE 6 DIAS",
            date: d,
            employee: name,
            detail: `Funcionário com ${prev + 1} dias consecutivos (inclui mês anterior).`,
          });
        }
      }
    }
    return issues;
  }
}

export class Apao6x1Rule implements Rule {
  readonly name = "Apao6x1Rule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const apaoAssignments = ctx.assignments.filter(
      (a) =>
        isInMonth(a.workDate, ctx.year, ctx.month) &&
        ctx.employees.find((e) => e.id === a.employeeId)?.role === "APAO",
    );
    const byEmp = new Map<number, { name: string; days: string[] }>();
    for (const a of apaoAssignments) {
      if (!byEmp.has(a.employeeId)) {
        byEmp.set(a.employeeId, { name: a.employeeName, days: [] });
      }
      byEmp.get(a.employeeId)!.days.push(a.workDate);
    }

    for (const { name, days } of byEmp.values()) {
      const sorted = [...new Set(days)].sort();
      let streak = 1;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === addDays(sorted[i - 1], 1)) {
          streak++;
          if (streak >= 7) {
            issues.push({
              severity: "ALTA",
              type: "APAO SEM FOLGA 6x1",
              date: sorted[i],
              employee: name,
              detail: "APAO trabalhou 7 dias consecutivos. Regra: 6 trabalhados para 1 folga.",
            });
          }
        } else {
          streak = 1;
        }
      }
    }
    return issues;
  }
}

export class PaoOffLimitRule implements Rule {
  readonly name = "PaoOffLimitRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const restSet = new Set<string>(PAO_REST_TYPES);

    for (const emp of ctx.employees) {
      if (emp.role !== "PAO") continue;
      if (!isEmployeePlanningActiveMonth(ctx, emp.id)) continue;

      const folgas = ctx.allocations.filter(
        (a) =>
          a.employeeId === emp.id &&
          isInMonth(a.allocDate, ctx.year, ctx.month) &&
          restSet.has(a.allocType.toUpperCase()),
      );

      const n = folgas.length;
      if (n < MIN_PAO_REST_COUNT) {
        issues.push({
          severity: "CRÍTICA",
          level: "CRITICAL",
          type: "FOLGAS PAO",
          date: `${String(ctx.month).padStart(2, "0")}/${ctx.year}`,
          employee: emp.name,
          detail: `${n} folgas no mês. Mínimo obrigatório: ${MIN_PAO_REST_COUNT}.`,
        });
      } else if (n > MAX_PAO_REST_COUNT) {
        issues.push({
          severity: "CRÍTICA",
          level: "CRITICAL",
          type: "FOLGAS PAO",
          date: `${String(ctx.month).padStart(2, "0")}/${ctx.year}`,
          employee: emp.name,
          detail: `${n} folgas no mês. Máximo permitido: ${MAX_PAO_REST_COUNT}.`,
        });
      }
    }
    return issues;
  }
}

export class RequestedOffLimitRule implements Rule {
  readonly name = "RequestedOffLimitRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const emp of ctx.employees) {
      if (emp.role === "PAO FCF") continue;
      if (emp.role === "APAO") continue;
      const fromRegistry = ctx.requestedOffByEmployeeId?.[emp.id];
      const fpCount =
        fromRegistry != null
          ? fromRegistry.length
          : new Set(
              ctx.allocations
                .filter(
                  (a) =>
                    a.employeeId === emp.id &&
                    isInMonth(a.allocDate, ctx.year, ctx.month) &&
                    ["FOLGA PEDIDA", "FOLGA ESCOLHIDA"].includes(a.allocType.toUpperCase()),
                )
                .map((a) => a.allocDate),
            ).size;
      if (fpCount > MAX_REQUESTED_OFF_PER_MONTH) {
        issues.push({
          severity: "MÉDIA",
          type: "FOLGAS PEDIDAS",
          date: `${String(ctx.month).padStart(2, "0")}/${ctx.year}`,
          employee: emp.name,
          detail: `${fpCount} folgas pedidas. Máximo: ${MAX_REQUESTED_OFF_PER_MONTH}.`,
        });
      }
    }
    return issues;
  }
}

export class MonofolgaRule implements Rule {
  readonly name = "MonofolgaRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const emp of ctx.employees) {
      if (emp.role === "PAO FCF") continue;
      if (emp.role === "APAO") continue;
      if (!isEmployeePlanningActiveMonth(ctx, emp.id)) continue;

      const folgas = ctx.allocations
        .filter(
          (a) =>
            a.employeeId === emp.id &&
            isInMonth(a.allocDate, ctx.year, ctx.month) &&
            MONOFOLGA_REST_TYPES.has(a.allocType.toUpperCase()),
        )
        .map((a) => a.allocDate);

      const restSet = new Set(folgas);
      for (const rd of restSet) {
        if (!restSet.has(addDays(rd, -1)) && !restSet.has(addDays(rd, 1))) {
          issues.push({
            severity: "MÉDIA",
            type: "MONOFOLGA",
            date: rd,
            employee: emp.name,
            detail: "Folga isolada de 1 dia. Preferir folga agrupada/consecutiva.",
          });
        }
      }
    }
    return issues;
  }
}

export class BlockedDayWorkRule implements Rule {
  readonly name = "BlockedDayWorkRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const al of ctx.allocations) {
      if (!isInMonth(al.allocDate, ctx.year, ctx.month)) continue;
      if (!BLOCK_TYPES.has(al.allocType.toUpperCase())) continue;
      const emp = ctx.employees.find((e) => e.id === al.employeeId);
      if (emp?.role === "PAO FCF" && ["SIMULADOR", "CURSO ONLINE", "VOO"].includes(al.allocType.toUpperCase())) {
        continue;
      }
      const conflict = ctx.assignments.find(
        (a) => a.employeeId === al.employeeId && a.workDate === al.allocDate,
      );
      if (conflict) {
        issues.push({
          severity: "ALTA",
          type: "TRABALHO EM DIA BLOQUEADO",
          date: al.allocDate,
          employee: al.employeeName,
          detail: `Alocação '${al.allocType}' e turno ${conflict.shiftCode} no mesmo dia.`,
        });
      }
    }
    return issues;
  }
}

export class PaoCoveragePerDayRule implements Rule {
  readonly name = "PaoCoveragePerDayRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const roleMap = buildRoleMap(ctx);
    const issues: ValidationIssue[] = [];
    for (const day of iterDays(ctx.year, ctx.month)) {
      for (const code of ["T6", "T7", "T8"] as const) {
        const has = ctx.assignments.some(
          (a) => a.workDate === day && a.shiftCode === code && roleMap.get(a.employeeId) === "PAO",
        );
        if (!has) {
          const ruleType =
            code === "T6"
              ? "COVERAGE_MISSING_T6"
              : code === "T7"
                ? "COVERAGE_MISSING_T7"
                : "COVERAGE_MISSING_T8";
          issues.push({
            severity: "CRÍTICA",
            level: "CRITICAL",
            type: ruleType,
            date: day,
            employee: "-",
            detail: `Sem PAO em ${code} no dia.`,
          });
        }
      }
    }
    return issues;
  }
}

/** ND só é válido como terceiro dia após par T8/T8. */
export class NdOnlyAfterT8BlockRule implements Rule {
  readonly name = "NdOnlyAfterT8BlockRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const al of ctx.allocations) {
      if (!isInMonth(al.allocDate, ctx.year, ctx.month)) continue;
      if (al.allocType.toUpperCase() !== "ND") continue;

      const d1 = addDays(al.allocDate, -2);
      const d2 = addDays(al.allocDate, -1);
      const t8a = ctx.assignments.some(
        (a) =>
          a.employeeId === al.employeeId &&
          a.workDate === d1 &&
          a.shiftCode === "T8",
      );
      const t8b = ctx.assignments.some(
        (a) =>
          a.employeeId === al.employeeId &&
          a.workDate === d2 &&
          a.shiftCode === "T8",
      );
      if (!t8a || !t8b) {
        issues.push({
          severity: "ALTA",
          level: "CRITICAL",
          type: "ND FORA DE T8/T8",
          date: al.allocDate,
          employee: al.employeeName,
          detail: "ND só pode existir após bloco válido T8/T8/ND.",
        });
      }

      const conflict = ctx.assignments.find(
        (a) => a.employeeId === al.employeeId && a.workDate === al.allocDate,
      );
      if (conflict) {
        issues.push({
          severity: "ALTA",
          level: "CRITICAL",
          type: "TURNO EM DIA ND",
          date: al.allocDate,
          employee: al.employeeName,
          detail: `ND e turno ${conflict.shiftCode} no mesmo dia.`,
        });
      }
    }
    return issues;
  }
}

/** Dia livre para voo — disponibilidade operacional (não bloqueia publicação). */
export class EmptyDayRule implements Rule {
  readonly name = "EmptyDayRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const days = iterDays(ctx.year, ctx.month);

    for (const emp of ctx.employees) {
      if (emp.role !== "PAO") continue;
      if (!isEmployeePlanningActiveMonth(ctx, emp.id)) continue;

      for (const day of days) {
        const hasAssignment = ctx.assignments.some(
          (a) => a.employeeId === emp.id && a.workDate === day,
        );
        const hasAllocation = ctx.allocations.some(
          (a) => a.employeeId === emp.id && a.allocDate === day,
        );
        if (!hasAssignment && !hasAllocation) {
          issues.push({
            severity: "BAIXA",
            level: "INFO",
            type: "DISPONÍVEL PARA VOO",
            date: day,
            employee: emp.name,
            detail: "Dia disponível para alocação de voo ou aproveitamento operacional.",
          });
        }
      }
    }
    return issues;
  }
}

export class SocialOffRule implements Rule {
  readonly name = "SocialOffRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const emp of ctx.employees) {
      if (emp.role !== "PAO") continue;
      if (!isEmployeePlanningActiveMonth(ctx, emp.id)) continue;
      const social = ctx.allocations.filter(
        (a) =>
          a.employeeId === emp.id &&
          isInMonth(a.allocDate, ctx.year, ctx.month) &&
          a.allocType === "FOLGA SOCIAL",
      );
      if (social.length === 0) {
        issues.push({
          severity: "BAIXA",
          type: "SEM FOLGA SOCIAL",
          date: `${String(ctx.month).padStart(2, "0")}/${ctx.year}`,
          employee: emp.name,
          detail: "PAO sem folga social no mês (esperado: 1 par sáb+dom promovido).",
        });
      }
    }
    return issues;
  }
}

export class VacationBlocksWorkRule implements Rule {
  readonly name = "VacationBlocksWorkRule";
  validate(ctx: ScheduleContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const a of ctx.assignments) {
      if (!isInMonth(a.workDate, ctx.year, ctx.month)) continue;
      if (isEmployeeOnVacation(ctx, a.employeeId, a.workDate)) {
        issues.push({
          severity: "ALTA",
          type: "TRABALHO EM FÉRIAS",
          date: a.workDate,
          employee: a.employeeName,
          detail: "Funcionário escalado em dia de férias.",
        });
      }
    }
    return issues;
  }
}
