"use client";

import Image from "next/image";
import { useAuthStore } from "@/lib/store/authStore";
import { PERMISSIONS, Permission } from "@/permissions/permissions";
import { GROUPS, GroupId } from "@/permissions/groups";
import { usePermission } from "@/permissions/usePermission";

// Group permissions by domain
type DomainMap = Record<string, { key: string; permission: Permission }[]>;

function buildDomainMap(): DomainMap {
  const map: DomainMap = {};
  for (const [key, value] of Object.entries(PERMISSIONS)) {
    const domain = value.split('.')[0];
    if (!map[domain]) map[domain] = [];
    map[domain].push({ key, permission: value as Permission });
  }
  return map;
}

const DOMAIN_MAP = buildDomainMap();

const GROUP_LABEL_STYLES: Record<GroupId, string> = {
  agent: 'bg-blue-100 text-blue-700',
  buyer: 'bg-green-100 text-green-700',
  seller: 'bg-purple-100 text-purple-700',
  admin: 'bg-red-100 text-red-700',
  tc: 'bg-amber-100 text-amber-700',
};

export default function PermissionsDebug() {
  const activeUser = useAuthStore((s) => s.activeUser);
  const { can, currentGroup } = usePermission();
  const group = currentGroup ? GROUPS[currentGroup] : null;

  const totalPermissions = Object.keys(PERMISSIONS).length;
  const userPermissions = group ? group.permissions.length : 0;

  return (
    <div className="min-h-screen bg-brand-bg pb-32">
      <div className="bg-brand-navy px-6 py-4 shadow-md">
        <h1 className="text-xl font-bold text-white">Permissions Debug</h1>
        <p className="text-sm text-white/60">Switch users with the toolbar to inspect their permissions</p>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        {/* Active User Card */}
        {activeUser ? (
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-400">Active User</h2>
            <div className="flex items-center gap-4">
              <Image src={activeUser.avatar} alt={activeUser.name} width={56} height={56} unoptimized className="h-14 w-14 rounded-full ring-2 ring-brand-gold/40" />
              <div className="flex-1">
                <div className="text-lg font-bold text-brand-navy">{activeUser.name}</div>
                <div className="text-sm text-gray-500">{activeUser.email}</div>
                <div className="mt-1 flex gap-2 items-center">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${currentGroup ? GROUP_LABEL_STYLES[currentGroup] : ''}`}>
                    {activeUser.role}
                  </span>
                  <span className="text-xs text-gray-400">Group: {activeUser.groupId}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-black text-brand-navy">{userPermissions}</div>
                <div className="text-xs text-gray-400">of {totalPermissions} permissions</div>
              </div>
            </div>
            {group && (
              <div className="mt-3 rounded-lg bg-gray-50 px-4 py-2">
                <span className="text-xs text-gray-500">{group.description}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-white p-5 shadow-sm text-gray-400">No active user.</div>
        )}

        {/* Permissions Table by Domain */}
        <div className="space-y-4">
          {Object.entries(DOMAIN_MAP).map(([domain, items]) => {
            const domainHas = items.filter((i) => can(i.permission)).length;
            return (
              <div key={domain} className="rounded-xl bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b bg-gray-50 px-5 py-3">
                  <h3 className="font-semibold text-brand-navy uppercase tracking-wide text-sm">{domain}</h3>
                  <span className="text-xs text-gray-400">
                    {domainHas}/{items.length} granted
                  </span>
                </div>
                <div className="divide-y">
                  {items.map(({ key, permission }) => {
                    const granted = can(permission);
                    return (
                      <div key={key} className="flex items-center gap-3 px-5 py-2.5">
                        <span
                          className={[
                            'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold',
                            granted ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500',
                          ].join(' ')}
                        >
                          {granted ? '✓' : '✕'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span
                            className={[
                              'font-mono text-xs',
                              granted ? 'text-green-700' : 'text-red-400',
                            ].join(' ')}
                          >
                            {permission}
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-300 font-mono truncate max-w-[180px]">{key}</span>
                        <span
                          className={[
                            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                            granted ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500',
                          ].join(' ')}
                        >
                          {granted ? 'GRANTED' : 'DENIED'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* All Groups Summary */}
        <div className="rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="border-b bg-gray-50 px-5 py-3">
            <h3 className="font-semibold text-brand-navy uppercase tracking-wide text-sm">Group Comparison</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-5 py-3 text-gray-400 uppercase tracking-wider font-medium">Permission</th>
                  {(['agent', 'tc', 'buyer', 'seller', 'admin'] as GroupId[]).map((gid) => (
                    <th key={gid} className={`px-4 py-3 uppercase tracking-wider font-bold ${GROUP_LABEL_STYLES[gid]}`}>
                      {GROUPS[gid].name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {Object.values(PERMISSIONS).map((perm) => (
                  <tr key={perm} className="hover:bg-gray-50/50">
                    <td className="px-5 py-1.5 font-mono text-gray-600">{perm}</td>
                    {(['agent', 'tc', 'buyer', 'seller', 'admin'] as GroupId[]).map((gid) => {
                      const has = GROUPS[gid].permissions.includes(perm);
                      return (
                        <td key={gid} className="px-4 py-1.5 text-center">
                          <span className={has ? 'text-green-500 font-bold' : 'text-red-300'}>
                            {has ? '✓' : '–'}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-gray-50 font-semibold">
                  <td className="px-5 py-2 text-gray-500">Total</td>
                  {(['agent', 'tc', 'buyer', 'seller', 'admin'] as GroupId[]).map((gid) => (
                    <td key={gid} className="px-4 py-2 text-center text-brand-navy">
                      {GROUPS[gid].permissions.length}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

    </div>
  );
}
