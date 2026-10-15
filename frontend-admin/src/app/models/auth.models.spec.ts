import {
  homeRouteForRole,
  isAdminRole,
  isEmployeeRole,
  isEmployeesOnlyAdminLogin,
  isEmployeesOnlyAdminUser,
} from './auth.models';

describe('auth.models', () => {
  it('mapeia ADMIN para dashboard', () => {
    expect(isAdminRole('ADMIN')).toBeTrue();
    expect(homeRouteForRole('ADMIN')).toBe('/dashboard');
  });

  it('mapeia licencasadmin para funcionarios', () => {
    expect(isEmployeesOnlyAdminLogin('licençasadmin')).toBeTrue();
    expect(isEmployeesOnlyAdminLogin('licencasadmin')).toBeTrue();
    expect(isEmployeesOnlyAdminUser({ role: 'ADMIN', email: 'licencasadmin' })).toBeTrue();
    expect(homeRouteForRole('ADMIN', 'licencasadmin')).toBe('/funcionarios');
  });

  it('mapeia OPERATOR/PILOT para portal (EMPLOYEE na spec)', () => {
    expect(isEmployeeRole('OPERATOR')).toBeTrue();
    expect(isEmployeeRole('PILOT')).toBeTrue();
    expect(homeRouteForRole('OPERATOR')).toBe('/portal');
    expect(homeRouteForRole('PILOT')).toBe('/portal');
  });
});
