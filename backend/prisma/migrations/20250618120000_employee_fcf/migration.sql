-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "is_fcf" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Employee" ADD COLUMN "fcf_shift_id" TEXT;
ALTER TABLE "Employee" ADD COLUMN "fcf_weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_fcf_shift_id_fkey" FOREIGN KEY ("fcf_shift_id") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Employee_fcf_shift_id_idx" ON "Employee"("fcf_shift_id");
