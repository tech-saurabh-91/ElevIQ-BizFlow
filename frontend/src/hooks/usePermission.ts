'use client';

import { useMemo } from 'react';

type MenuPermission = {
  menuPath: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export function usePermission(menuPath: string) {
  const permissions = useMemo(() => {
    try {
      const userStr = localStorage.getItem('user');
      if (!userStr) return { canView: true, canCreate: true, canEdit: true, canDelete: true };
      const user = JSON.parse(userStr);
      const menus = user?.roleId?.menus || user?.menus || [];
      if (menus.length === 0) return { canView: true, canCreate: true, canEdit: true, canDelete: true };
      const menu = menus.find((m: MenuPermission) => m.menuPath === menuPath);
      if (!menu) return { canView: false, canCreate: false, canEdit: false, canDelete: false };
      return { canView: menu.canView, canCreate: menu.canCreate, canEdit: menu.canEdit, canDelete: menu.canDelete };
    } catch {
      return { canView: true, canCreate: true, canEdit: true, canDelete: true };
    }
  }, [menuPath]);

  return permissions;
}
