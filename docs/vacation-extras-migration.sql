-- CreateEnum
CREATE TYPE "VacationExtraStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Vacation" ADD COLUMN IF NOT EXISTS "thirteenth_advance_requested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Vacation" ADD COLUMN IF NOT EXISTS "thirteenth_advance_status" "VacationExtraStatus";
ALTER TABLE "Vacation" ADD COLUMN IF NOT EXISTS "sell_ten_days_requested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Vacation" ADD COLUMN IF NOT EXISTS "sell_ten_days_status" "VacationExtraStatus";
