import { Check, UserCircle } from '@phosphor-icons/react';
import { setMockRole, STAFF_ROLES, useStaffRole } from '../lib/session';
import { Menu } from '../motion';

/**
 * Mock sign-in: pick the staff role the API sees (PRD 4.3). Replaced by Core Engine sign-in (NFR-S1).
 * The API still checks the role on every request; this only chooses which mock token is sent.
 * Icon-only menu button so the header still fits at 1280px (MASTER §5); the name says the current role.
 */
export function RoleSwitcher() {
  const role = useStaffRole();
  const current = STAFF_ROLES.find((option) => option.value === role)?.label ?? role;
  return (
    <Menu
      label="Sign in as (mock role)"
      iconOnly
      triggerLabel={`Mock role: ${current}. Change role`}
      trigger={<UserCircle size={20} weight="bold" aria-hidden />}
      items={STAFF_ROLES.map((option) => ({
        label: option.label,
        icon:
          option.value === role ? (
            <Check size={16} weight="bold" aria-label="current role" />
          ) : (
            <span className="role-switch__spacer" aria-hidden />
          ),
        onSelect: () => setMockRole(option.value),
      }))}
    />
  );
}
