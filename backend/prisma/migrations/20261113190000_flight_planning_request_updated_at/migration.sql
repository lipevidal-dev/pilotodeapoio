ALTER TABLE "flight_planning_requests" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);
UPDATE "flight_planning_requests" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
