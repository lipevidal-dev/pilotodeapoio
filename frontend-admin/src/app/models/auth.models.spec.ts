import { homeRouteForRole, isAdminRole, isEmployeeRole } from './auth.models';

describe('auth.models', () => {
  it('mapeia ADMIN para dashboard', () => {
    expect(isAdminRole('ADMIN')).toBeTrue();
    expect(homeRouteForRole('ADMIN')).toBe('/dashboard');
  });

  it('mapeia OPERATOR/PILOT para portal (EMPLOYEE na spec)', () => {
    expect(isEmployeeRole('OPERATOR')).toBeTrue();
    expect(isEmployeeRole('PILOT')).toBeTrue();
    expect(homeRouteForRole('OPERATOR')).toBe('/portal');
    expect(homeRouteForRole('PILOT')).toBe('/portal');
  });
});
