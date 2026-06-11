"use client";

import { useState } from 'react';
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/authStore";
import { MOCK_USERS } from "@/lib/data/mockUsers";
import { GroupId } from "@/permissions/groups";

const GROUP_DOT_COLORS: Record<GroupId, string> = {
  agent: 'bg-blue-400',
  buyer: 'bg-green-400',
  seller: 'bg-purple-400',
  admin: 'bg-red-400',
  tc: 'bg-amber-400',
};

function getHomeUrl(userId: string, groupId: GroupId): string {
  if (groupId === 'buyer') return `/buyer/${userId}`;
  if (groupId === 'seller') return `/seller/${userId}`;
  if (groupId === 'admin') return '/admin';
  if (groupId === 'tc') return '/tc';
  return '/agent';
}

export function RoleSwitcher() {
  // Hooks must be called unconditionally and in the same order on every
  // render (react-hooks/rules-of-hooks). The dev-only short-circuit moves
  // BELOW the hooks. Next.js inlines `process.env.NODE_ENV` at build time,
  // so the entire component body is dead-code-eliminated in production
  // bundles — no runtime cost.
  const { activeUser, setActiveUser } = useAuthStore();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  if (process.env.NODE_ENV === "production") return null;

  const dotColor = GROUP_DOT_COLORS[activeUser?.groupId as GroupId] ?? 'bg-gray-400';

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-xl bg-black/80 px-3 py-2 shadow-2xl backdrop-blur-sm hover:bg-black/90 transition-colors"
        title="Switch role"
      >
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span className="text-xs font-semibold text-white">{activeUser?.name?.split(' ')[0]}</span>
        <span className="text-[10px] text-gray-400">▲</span>
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-4 left-4 z-40 flex flex-col gap-1 rounded-xl bg-black/80 p-3 shadow-2xl backdrop-blur-sm"
      style={{ minWidth: '220px' }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          DEV: Viewing as
        </span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-gray-500 hover:text-gray-300 transition-colors text-[10px] leading-none"
          title="Collapse"
        >
          ▼
        </button>
      </div>
      <div className="mb-2 text-xs font-bold text-white">
        {activeUser?.name}{' '}
        <span className="font-normal text-gray-300">({activeUser?.role})</span>
      </div>
      <div className="flex flex-col gap-1">
        {MOCK_USERS.map((user) => {
          const isActive = user.id === activeUser?.id;
          const dotColor = GROUP_DOT_COLORS[user.groupId];
          return (
            <button
              key={user.id}
              onClick={() => {
                setActiveUser(user.id);
                router.push(getHomeUrl(user.id, user.groupId));
              }}
              className={[
                'flex items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-all',
                isActive
                  ? 'bg-brand-navy font-semibold text-white ring-1 ring-brand-gold'
                  : 'text-gray-300 hover:bg-white/10',
              ].join(' ')}
            >
              <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
              <span className="flex-1 truncate">{user.name}</span>
              <span className="text-[10px] text-gray-400">{user.role}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
