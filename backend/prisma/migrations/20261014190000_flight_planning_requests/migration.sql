-- Solicitações de Voos Planejamento enviadas pelo portal.
CREATE TABLE "flight_planning_requests" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_planning_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "flight_planning_request_lines" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "flight_planning_request_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "flight_planning_requests_employee_id_created_at_idx"
    ON "flight_planning_requests"("employee_id", "created_at");

CREATE INDEX "flight_planning_request_lines_request_id_sort_order_idx"
    ON "flight_planning_request_lines"("request_id", "sort_order");

ALTER TABLE "flight_planning_requests"
    ADD CONSTRAINT "flight_planning_requests_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "flight_planning_request_lines"
    ADD CONSTRAINT "flight_planning_request_lines_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "flight_planning_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
