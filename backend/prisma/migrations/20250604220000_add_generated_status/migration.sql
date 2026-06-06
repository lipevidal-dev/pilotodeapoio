-- AlterEnum: adiciona GENERATED ao fluxo de publicação
ALTER TYPE "ScheduleMonthStatus" ADD VALUE IF NOT EXISTS 'GENERATED';
