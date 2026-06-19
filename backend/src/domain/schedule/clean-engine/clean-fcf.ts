import { weekday } from "../../rules/dates.js";

import type { ValidationIssue } from "../types.js";

import { assignmentKey } from "../types.js";

import type { CleanWorkspace } from "./clean-workspace.js";



export function applyFcfRules(ws: CleanWorkspace): ValidationIssue[] {

  const warnings: ValidationIssue[] = [];

  const rules = ws.input.fcfRules ?? [];

  if (rules.length === 0) return warnings;



  const phase = "FCF";



  for (const rule of rules) {

    const emp = ws.input.employees.find((e) => e.uuid === rule.employeeUuid);

    if (!emp) continue;



    for (const date of ws.days) {

      if (weekday(date) !== rule.weekday) continue;



      const key = assignmentKey(emp.domainId, date);

      if (ws.planned.has(key)) continue;



      const result = ws.tryAssignWithReason(rule.employeeUuid, date, rule.shiftCode, phase);

      if (result.assigned) continue;



      const reason = result.reason ?? "indisponível";

      ws.audit.record("FCF_SHIFT_NOT_APPLIED", phase, reason, {

        date,

        shiftCode: rule.shiftCode.toUpperCase(),

        employeeUuid: rule.employeeUuid,

        employeeName: emp.employee.name,

      });

      warnings.push({

        severity: "MÉDIA",

        level: "WARNING",

        type: "FCF_SHIFT_NOT_APPLIED",

        date,

        employee: emp.employee.name,

        detail: `FCF ${rule.shiftCode.toUpperCase()} não aplicado em ${date}: ${reason}`,

      });

    }

  }



  return warnings;

}


