-- CreateEnum
CREATE TYPE "ShiftCoverageType" AS ENUM ('REQUIRED', 'PARALLEL');

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN "coverage_type" "ShiftCoverageType" NOT NULL DEFAULT 'REQUIRED';

-- CreateTable
CREATE TABLE "employee_preferred_shifts" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_preferred_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_preferred_shifts_employee_id_idx" ON "employee_preferred_shifts"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_preferred_shifts_employee_id_shift_id_key" ON "employee_preferred_shifts"("employee_id", "shift_id");

-- AddForeignKey
ALTER TABLE "employee_preferred_shifts" ADD CONSTRAINT "employee_preferred_shifts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_preferred_shifts" ADD CONSTRAINT "employee_preferred_shifts_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
