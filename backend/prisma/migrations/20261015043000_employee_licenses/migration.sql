CREATE TABLE IF NOT EXISTS employee_licenses (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES "Employee"(id) ON DELETE CASCADE,
  due_on DATE NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employee_licenses_employee_id_idx ON employee_licenses (employee_id);
CREATE INDEX IF NOT EXISTS employee_licenses_due_on_idx ON employee_licenses (due_on);
