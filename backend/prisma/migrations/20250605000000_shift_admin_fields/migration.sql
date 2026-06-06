-- AlterTable
ALTER TABLE "Shift" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Shift" ADD COLUMN "display_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Shift" ADD COLUMN "mandatory_coverage" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shift" ADD COLUMN "requires_t8_pair_nd" BOOLEAN NOT NULL DEFAULT false;

-- Defaults for standard PAO/APAO shifts
UPDATE "Shift" SET "display_order" = 1, "mandatory_coverage" = true WHERE "code" = 'T6';
UPDATE "Shift" SET "display_order" = 2, "mandatory_coverage" = true WHERE "code" = 'T7';
UPDATE "Shift" SET "display_order" = 3, "mandatory_coverage" = true, "requires_t8_pair_nd" = true WHERE "code" = 'T8';
UPDATE "Shift" SET "display_order" = 4 WHERE "code" = 'T1';
UPDATE "Shift" SET "display_order" = 5 WHERE "code" = 'T2';
UPDATE "Shift" SET "display_order" = 6 WHERE "code" = 'T3';
UPDATE "Shift" SET "display_order" = 7 WHERE "code" = 'T4';
