import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  addIsoDays,
  isLicenseDueSoon,
  LICENSE_ALERT_DAYS,
  saoPauloDateKey,
} from "../../domain/employee/license-alert.js";
import { prisma } from "../../infrastructure/database/prisma-client.js";

const licenseItemSchema = z.object({
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de vencimento."),
  description: z.string().trim().min(1, "Informe a descrição.").max(200, "A descrição deve ter no máximo 200 caracteres."),
});

export const replaceEmployeeLicensesSchema = z.object({
  items: z.array(licenseItemSchema).max(40, "São permitidas no máximo 40 licenças."),
});

export type EmployeeLicenseItem = {
  id: string;
  dueOn: string;
  description: string;
  alert: boolean;
};

export class EmployeeLicenseValidationError extends Error {
  readonly code = "LICENSE_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "EmployeeLicenseValidationError";
  }
}

type LicenseRow = { id: string; dueOn: string; description: string };

function windowFor(today = saoPauloDateKey()): { today: string; alertUntil: string } {
  return { today, alertUntil: addIsoDays(today, LICENSE_ALERT_DAYS) };
}

function withAlert(rows: LicenseRow[], today: string): EmployeeLicenseItem[] {
  return rows.map((row) => ({
    ...row,
    alert: isLicenseDueSoon(row.dueOn, today),
  }));
}

export const employeeLicensesUseCase = {
  async listAlerts(): Promise<{ alerts: Array<{ employeeId: string; name: string }> }> {
    const { alertUntil } = windowFor();
    const rows = await prisma.$queryRaw<Array<{ employeeId: string; name: string }>>`
      SELECT DISTINCT e.id AS "employeeId", e.name
      FROM employee_licenses l
      JOIN "Employee" e ON e.id = l.employee_id
      WHERE l.due_on <= ${alertUntil}::date
      ORDER BY e.name ASC
    `;
    return { alerts: rows };
  },

  async listForEmployee(employeeId: string): Promise<{
    today: string;
    alertUntil: string;
    items: EmployeeLicenseItem[];
  } | null> {
    const found = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Employee" WHERE id = ${employeeId} LIMIT 1
    `;
    if (!found[0]) return null;
    const { today, alertUntil } = windowFor();
    const rows = await prisma.$queryRaw<LicenseRow[]>`
      SELECT id, to_char(due_on, 'YYYY-MM-DD') AS "dueOn", description
      FROM employee_licenses
      WHERE employee_id = ${employeeId}
      ORDER BY due_on ASC, description ASC
    `;
    return { today, alertUntil, items: withAlert(rows, today) };
  },

  async replace(employeeId: string, body: unknown): Promise<{
    today: string;
    alertUntil: string;
    items: EmployeeLicenseItem[];
  }> {
    const parsed = replaceEmployeeLicensesSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Licenças inválidas.";
      throw new EmployeeLicenseValidationError(message);
    }
    const found = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Employee" WHERE id = ${employeeId} LIMIT 1
    `;
    if (!found[0]) throw new Error("NOT_FOUND");

    const items = parsed.data.items;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM employee_licenses WHERE employee_id = ${employeeId}`;
      for (const item of items) {
        const id = randomUUID();
        await tx.$executeRaw`
          INSERT INTO employee_licenses (id, employee_id, due_on, description)
          VALUES (${id}, ${employeeId}, ${item.dueOn}::date, ${item.description})
        `;
      }
    });

    const listed = await this.listForEmployee(employeeId);
    if (!listed) throw new Error("NOT_FOUND");
    return listed;
  },
};
