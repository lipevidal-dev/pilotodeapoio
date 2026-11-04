import { prisma } from "../../infrastructure/database/prisma-client.js";

const OBSERVATION_MAX = 500;

function normalizeObservation(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, OBSERVATION_MAX);
}

export async function registerEmployeeObservationRoutes(app) {
  if (app.__employeeObservationRoutes) return;
  app.__employeeObservationRoutes = true;

  app.get("/employees/observations", async (_req, reply) => {
    const rows = await prisma.$queryRaw`
      SELECT id AS "employeeId", name, observation
      FROM "Employee"
      WHERE observation IS NOT NULL AND btrim(observation) <> ''
    `;
    return reply.send({ items: rows });
  });

  app.put("/employees/:id/observation", async (req, reply) => {
    const id = req.params.id;
    const observation = normalizeObservation(req.body && req.body.observation);
    const found = await prisma.$queryRaw`
      SELECT id FROM "Employee" WHERE id = ${id} LIMIT 1
    `;
    if (!found[0]) {
      return reply.status(404).send({ error: "Funcionário não encontrado" });
    }
    await prisma.$executeRaw`
      UPDATE "Employee" SET observation = ${observation}, updated_at = NOW() WHERE id = ${id}
    `;
    return reply.send({ observation });
  });
}
