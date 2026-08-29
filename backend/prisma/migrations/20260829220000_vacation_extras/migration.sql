DO $$
BEGIN
  CREATE TYPE "VacationExtraStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Vacation"
  ADD COLUMN IF NOT EXISTS "thirteenth_advance_requested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "thirteenth_advance_status" "VacationExtraStatus",
  ADD COLUMN IF NOT EXISTS "sell_ten_days_requested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sell_ten_days_status" "VacationExtraStatus";
