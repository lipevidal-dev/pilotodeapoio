-- Senioridade numérica por grupo (PAO / APAO), sequência contínua 1..N em cada grupo.

ALTER TABLE "Employee" ADD COLUMN "seniority_number" INTEGER;

WITH ranked_pao AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name ASC) AS rn
  FROM "Employee"
  WHERE type = 'PAO'
)
UPDATE "Employee" e
SET "seniority_number" = r.rn
FROM ranked_pao r
WHERE e.id = r.id;

WITH ranked_apao AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name ASC) AS rn
  FROM "Employee"
  WHERE type = 'APAO'
)
UPDATE "Employee" e
SET "seniority_number" = r.rn
FROM ranked_apao r
WHERE e.id = r.id;

UPDATE "Employee" SET "seniority_number" = 1 WHERE "seniority_number" IS NULL;

ALTER TABLE "Employee" ALTER COLUMN "seniority_number" SET NOT NULL;
ALTER TABLE "Employee" ALTER COLUMN "seniority_number" SET DEFAULT 1;

CREATE UNIQUE INDEX "Employee_type_seniority_number_key" ON "Employee"("type", "seniority_number");
