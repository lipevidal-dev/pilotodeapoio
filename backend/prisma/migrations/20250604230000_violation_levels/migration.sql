-- Fase 5.1: RuleSeverity → CRITICAL | WARNING | INFO

CREATE TYPE "RuleSeverity_new" AS ENUM ('CRITICAL', 'WARNING', 'INFO');

ALTER TABLE "RuleViolation" ALTER COLUMN "severity" DROP DEFAULT;

ALTER TABLE "RuleViolation"
  ALTER COLUMN "severity" TYPE "RuleSeverity_new"
  USING (
    CASE "severity"::text
      WHEN 'CRITICA' THEN 'CRITICAL'::"RuleSeverity_new"
      WHEN 'ALTA' THEN 'CRITICAL'::"RuleSeverity_new"
      WHEN 'MEDIA' THEN 'WARNING'::"RuleSeverity_new"
      WHEN 'BAIXA' THEN 'INFO'::"RuleSeverity_new"
      ELSE 'WARNING'::"RuleSeverity_new"
    END
  );

DROP TYPE "RuleSeverity";

ALTER TYPE "RuleSeverity_new" RENAME TO "RuleSeverity";
