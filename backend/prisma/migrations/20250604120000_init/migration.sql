-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR', 'PILOT');

-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('PAO', 'APAO');

-- CreateEnum
CREATE TYPE "ScheduleMonthStatus" AS ENUM ('DRAFT', 'VALIDATING', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RuleSeverity" AS ENUM ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA');

-- CreateEnum
CREATE TYPE "RequestedDayOffStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('MANUAL', 'GENERATOR', 'IMPORT', 'REPAIR');

-- CreateEnum
CREATE TYPE "EmployeeTypeAllowed" AS ENUM ('PAO', 'APAO', 'BOTH');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EmployeeType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "duration_hours" DOUBLE PRECISION NOT NULL,
    "employee_type_allowed" "EmployeeTypeAllowed" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleMonth" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "ScheduleMonthStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleAssignment" (
    "id" TEXT NOT NULL,
    "schedule_month_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shift_code" TEXT NOT NULL,
    "label" TEXT,
    "source" "AssignmentSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleViolation" (
    "id" TEXT NOT NULL,
    "schedule_month_id" TEXT NOT NULL,
    "severity" "RuleSeverity" NOT NULL,
    "rule_code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "date" TEXT,
    "employee_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleViolation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreAllocation" (
    "id" TEXT NOT NULL,
    "schedule_month_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vacation" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vacation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestedDayOff" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "RequestedDayOffStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestedDayOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightAssignment" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT,
    "source" "AssignmentSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlightAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_code_key" ON "Shift"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleMonth_year_month_key" ON "ScheduleMonth"("year", "month");

-- CreateIndex
CREATE INDEX "ScheduleAssignment_schedule_month_id_date_idx" ON "ScheduleAssignment"("schedule_month_id", "date");

-- CreateIndex
CREATE INDEX "ScheduleAssignment_employee_id_idx" ON "ScheduleAssignment"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleAssignment_schedule_month_id_employee_id_date_key" ON "ScheduleAssignment"("schedule_month_id", "employee_id", "date");

-- CreateIndex
CREATE INDEX "RuleViolation_schedule_month_id_idx" ON "RuleViolation"("schedule_month_id");

-- CreateIndex
CREATE INDEX "PreAllocation_schedule_month_id_idx" ON "PreAllocation"("schedule_month_id");

-- CreateIndex
CREATE UNIQUE INDEX "PreAllocation_schedule_month_id_employee_id_date_key" ON "PreAllocation"("schedule_month_id", "employee_id", "date");

-- CreateIndex
CREATE INDEX "Vacation_employee_id_idx" ON "Vacation"("employee_id");

-- CreateIndex
CREATE INDEX "RequestedDayOff_employee_id_date_idx" ON "RequestedDayOff"("employee_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FlightAssignment_employee_id_date_key" ON "FlightAssignment"("employee_id", "date");

-- AddForeignKey
ALTER TABLE "ScheduleAssignment" ADD CONSTRAINT "ScheduleAssignment_schedule_month_id_fkey" FOREIGN KEY ("schedule_month_id") REFERENCES "ScheduleMonth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleAssignment" ADD CONSTRAINT "ScheduleAssignment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleViolation" ADD CONSTRAINT "RuleViolation_schedule_month_id_fkey" FOREIGN KEY ("schedule_month_id") REFERENCES "ScheduleMonth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleViolation" ADD CONSTRAINT "RuleViolation_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreAllocation" ADD CONSTRAINT "PreAllocation_schedule_month_id_fkey" FOREIGN KEY ("schedule_month_id") REFERENCES "ScheduleMonth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreAllocation" ADD CONSTRAINT "PreAllocation_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vacation" ADD CONSTRAINT "Vacation_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestedDayOff" ADD CONSTRAINT "RequestedDayOff_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightAssignment" ADD CONSTRAINT "FlightAssignment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
