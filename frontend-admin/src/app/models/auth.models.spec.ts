import {
  homeRouteForRole,
  isAdminRole,
  isEmployeeRole,
  isEmployeesOnlyAdminRole,
  isFullAdminRole,
} from './auth.models';

describe('auth.models', () => {
  it('mapeia ADMIN para dashboard', () => {
    expect(isAdminRole('ADMIN')).toBeTrue();
    expect(isFullAdminRole('ADMIN')).toBeTrue();
    expect(isEmployeesOnlyAdminRole('ADMIN')).toBeFalse();
    expect(homeRouteForRole('ADMIN')).toBe('/dashboard');
  });

  it('mapeia EMPLOYEES_ADMIN apenas para funcionarios', () => {
    expect(isAdminRole('EMPLOYEES_ADMIN')).toBeTrue();
    expect(isFullAdminRole('EMPLOYEES_ADMIN')).toBeFalse();
    expect(isEmployeesOnlyAdminRole('EMPLOYEES_ADMIN')).toBeTrue();
    expect(homeRouteForRole('EMPLOYEES_ADMIN')).toBe('/funcionarios');
  });

  it('mapeia OPERATOR/PILOT para portal (EMPLOYEE na spec)', () => {
    expect(isEmployeeRole('OPERATOR')).toBeTrue();
    expect(isEmployeeRole('PILOT')).toBeTrue();
    expect(homeRouteForRole('OPERATOR')).toBe('/portal');
    expect(homeRouteForRole('PILOT')).toBe('/portal');
  });
});
