export type ShiftRole = "PAO" | "APAO" | "PAO FCF" | "BOTH";

export type ShiftCoverageType = "REQUIRED" | "PARALLEL";

export interface Shift {
  code: string;
  role: ShiftRole;
  name: string;
  startTime: string;
  endTime: string;
  minStaff: number;
  maxStaff: number;
  active?: boolean;
  noWeekends?: boolean;
  coverageType?: ShiftCoverageType;
}

export interface ShiftInfo {
  startTime: string;
  endTime: string;
  role: ShiftRole;
  noWeekends: boolean;
}

export type ShiftMap = Record<string, ShiftInfo>;
