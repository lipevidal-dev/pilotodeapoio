-- Período habilitado pelo admin e pacote mensal das solicitações.
CREATE TABLE "flight_planning_periods" (
    "id" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_planning_periods_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "flight_planning_packages" (
    "id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_planning_packages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "flight_planning_packages_period_id_year_month_key"
    ON "flight_planning_packages"("period_id", "year", "month");

ALTER TABLE "flight_planning_packages"
    ADD CONSTRAINT "flight_planning_packages_period_id_fkey"
    FOREIGN KEY ("period_id") REFERENCES "flight_planning_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "flight_planning_requests"
    ADD COLUMN "period_id" TEXT,
    ADD COLUMN "package_id" TEXT;

CREATE INDEX "flight_planning_requests_package_id_idx"
    ON "flight_planning_requests"("package_id");

ALTER TABLE "flight_planning_requests"
    ADD CONSTRAINT "flight_planning_requests_period_id_fkey"
    FOREIGN KEY ("period_id") REFERENCES "flight_planning_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "flight_planning_requests"
    ADD CONSTRAINT "flight_planning_requests_package_id_fkey"
    FOREIGN KEY ("package_id") REFERENCES "flight_planning_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
