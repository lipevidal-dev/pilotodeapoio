-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "role_id" TEXT;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed default motor roles
INSERT INTO "Role" ("id", "name", "code", "description", "active", "display_order", "created_at", "updated_at")
VALUES
  ('00000000-0000-4000-8000-000000000001', 'Piloto de Apoio Operacional', 'PAO', 'Cobertura operacional PAO (T6/T7/T8)', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000002', 'Auxiliar de Piloto de Apoio Operacional', 'APAO', 'Apoio APAO (T1–T4) com PAO na janela', true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Backfill employee role_id from type
UPDATE "Employee" e
SET "role_id" = r."id"
FROM "Role" r
WHERE e."role_id" IS NULL AND r."code" = e."type"::text;
