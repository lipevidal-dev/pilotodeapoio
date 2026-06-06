export type ShiftRole = "PAO" | "APAO" | "PAO FCF" | "BOTH";

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
}

export interface ShiftInfo {
  startTime: string;
  endTime: string;
  role: ShiftRole;
  noWeekends: boolean;
}

export type ShiftMap = Record<string, ShiftInfo>;
