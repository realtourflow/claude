import { useAuthStore } from '../store/authStore';
import { Permission } from './permissions';
import { GROUPS, GroupId } from './groups';

export function hasPermission(groupId: GroupId | null, permission: Permission): boolean {
  if (!groupId) return false;
  const group = GROUPS[groupId];
  if (!group) return false;
  return group.permissions.includes(permission);
}

export function usePermission() {
  const activeUser = useAuthStore((state) => state.activeUser);
  const groupId = (activeUser?.groupId ?? null) as GroupId | null;

  const can = (permission: Permission): boolean => {
    return hasPermission(groupId, permission);
  };

  const canAny = (permissions: Permission[]): boolean => {
    return permissions.some((p) => hasPermission(groupId, p));
  };

  const canAll = (permissions: Permission[]): boolean => {
    return permissions.every((p) => hasPermission(groupId, p));
  };

  return {
    can,
    canAny,
    canAll,
    currentGroup: groupId,
    hasPermission: (permission: Permission) => hasPermission(groupId, permission),
  };
}
