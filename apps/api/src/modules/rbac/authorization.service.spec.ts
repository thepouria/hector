import { AuthorizationService } from './authorization.service';

describe('AuthorizationService', () => {
  it('checks permission subsets correctly', () => {
    const service = Object.create(AuthorizationService.prototype) as AuthorizationService;
    const actor = new Set(['member.read', 'role.read', 'company.update']);

    expect(service.isPermissionSubset(actor, new Set(['member.read', 'role.read']))).toBe(true);
    expect(service.isPermissionSubset(actor, new Set(['member.read', 'finance.read']))).toBe(
      false,
    );
    expect(service.isPermissionSubset(actor, new Set())).toBe(true);
  });
});
