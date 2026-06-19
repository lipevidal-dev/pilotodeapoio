-- Migrate FCF from single shift + weekday array to per-day schedule rows.
ALTER TABLE "Employee" ADD COLUMN "fcf_schedule" JSONB NOT NULL DEFAULT '[]';

UPDATE "Employee"
SET "fcf_schedule" = (
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('shiftId', "fcf_shift_id", 'weekday', wd) ORDER BY wd),
    '[]'::jsonb
  )
  FROM unnest("fcf_weekdays") AS wd
)
WHERE "is_fcf" = true AND "fcf_shift_id" IS NOT NULL AND cardinality("fcf_weekdays") > 0;

ALTER TABLE "Employee" DROP CONSTRAINT IF EXISTS "Employee_fcf_shift_id_fkey";
DROP INDEX IF EXISTS "Employee_fcf_shift_id_idx";
ALTER TABLE "Employee" DROP COLUMN "fcf_shift_id";
ALTER TABLE "Employee" DROP COLUMN "fcf_weekdays";
