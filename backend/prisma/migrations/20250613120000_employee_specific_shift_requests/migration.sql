-- Turno em dias específicos (preferência forte por funcionário)
CREATE TABLE "employee_specific_shift_requests" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "year" INTEGER,
    "month" INTEGER,
    "day_of_month" INTEGER,
    "weekday" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_specific_shift_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employee_specific_shift_requests_employee_id_idx" ON "employee_specific_shift_requests"("employee_id");

ALTER TABLE "employee_specific_shift_requests" ADD CONSTRAINT "employee_specific_shift_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_specific_shift_requests" ADD CONSTRAINT "employee_specific_shift_requests_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
