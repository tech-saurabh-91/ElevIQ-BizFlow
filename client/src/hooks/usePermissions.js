import { useAuthStore } from '@/store/authStore';

/**
 * Permission hooks backed by the company role matrix
 * (delivered at login/`/v1/auth/me` and editable by COMPANY_ADMIN).
 */
export const usePermissions = () => {
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);

  /** Any-of permission check: `canAny(['orders.create', 'orders.approve'])`. */
  const canAny = (list = []) => list.some((p) => can(p));
  /** All-of permission check. */
  const canAll = (list = []) => list.every((p) => can(p));

  const isRole = (...roles) => roles.includes(user?.role);
  const isAdmin = user?.role === 'COMPANY_ADMIN';

  return { can, canAny, canAll, isRole, isAdmin, role: user?.role, permissions };
};

/** Data-scope helper: which records a user may touch. */
export const useDataScope = () => {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;

  // SALESMAN: own records only. MANAGER: team. Others: whole company.
  const filter =
    role === 'SALESMAN'
      ? { owner: user?.id }
      : role === 'MANAGER'
        ? { team: user?.id }
        : {};

  return { filter, ownOnly: role === 'SALESMAN', teamOnly: role === 'MANAGER', isAll: !['SALESMAN', 'MANAGER'].includes(role) };
};

export default usePermissions;
