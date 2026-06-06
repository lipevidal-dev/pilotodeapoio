export type EmployeeRole = "PAO" | "APAO" | "PAO FCF";

export interface Employee {
  id: number;
  name: string;
  role: EmployeeRole;
  seniority: number;
  /** yyyy-mm-dd — usado pelo motor para FANI */
  birthDate?: string | null;
  fixedShiftCode?: string | null;
  isFixedShift?: boolean;
  active?: boolean;
  noFlight?: boolean;
  noFlightStart?: string | null;
  noFlightEnd?: string | null;
  noFlightIndefinite?: boolean;
  notes?: string;
}
