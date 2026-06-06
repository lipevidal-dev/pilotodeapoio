-- Fase 6.3 — restrições individuais de voo e turno por funcionário

CREATE TABLE "employee_flight_restrictions" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_flight_restrictions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_shift_restrictions" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_shift_restrictions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_flight_restrictions_employee_id_date_key"
    ON "employee_flight_restrictions"("employee_id", "date");

CREATE INDEX "employee_flight_restrictions_employee_id_idx"
    ON "employee_flight_restrictions"("employee_id");

CREATE INDEX "employee_flight_restrictions_date_idx"
    ON "employee_flight_restrictions"("date");

CREATE UNIQUE INDEX "employee_shift_restrictions_employee_id_shift_id_key"
    ON "employee_shift_restrictions"("employee_id", "shift_id");

CREATE INDEX "employee_shift_restrictions_employee_id_idx"
    ON "employee_shift_restrictions"("employee_id");

ALTER TABLE "employee_flight_restrictions"
    ADD CONSTRAINT "employee_flight_restrictions_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_shift_restrictions"
    ADD CONSTRAINT "employee_shift_restrictions_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_shift_restrictions"
    ADD CONSTRAINT "employee_shift_restrictions_shift_id_fkey"
    FOREIGN KEY ("shift_id") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
