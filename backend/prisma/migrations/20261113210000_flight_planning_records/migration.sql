CREATE TABLE IF NOT EXISTS "flight_planning_records" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "package_id" TEXT,
    "email_text" TEXT NOT NULL,
    "lines_json" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "flight_planning_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "flight_planning_records_request_id_created_at_idx"
ON "flight_planning_records"("request_id", "created_at");

CREATE INDEX IF NOT EXISTS "flight_planning_records_package_id_idx"
ON "flight_planning_records"("package_id");
