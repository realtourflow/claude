"use client";

import { ReactNode } from 'react';
import { Permission } from './permissions';
import { usePermission } from './usePermission';

type PermissionGateProps = {
  require: Permission | Permission[];
  requireAll?: boolean;
  fallback?: ReactNode;
  children: ReactNode;
};

export function PermissionGate({
  require,
  requireAll = false,
  fallback = null,
  children,
}: PermissionGateProps) {
  const { can, canAny, canAll } = usePermission();

  let hasAccess: boolean;

  if (Array.isArray(require)) {
    hasAccess = requireAll ? canAll(require) : canAny(require);
  } else {
    hasAccess = can(require);
  }

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
