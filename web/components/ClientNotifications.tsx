"use client";

import { Bell, X } from 'lucide-react';
import { useNotifications } from "@/hooks/useNotifications";

export default function ClientNotifications() {
  const { notifications, markRead } = useNotifications();
  const unread = notifications.filter((n) => !n.read);

  if (unread.length === 0) return null;

  return (
    <div className="space-y-2">
      {unread.map((n) => (
        <div
          key={n.id}
          className="flex items-start gap-3 rounded-xl bg-brand-navy px-4 py-3.5 shadow-md"
        >
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-gold/20 mt-0.5">
            <Bell size={13} className="text-brand-gold" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white leading-snug">{n.title}</p>
            {n.body && (
              <p className="mt-0.5 text-xs text-white/60 leading-relaxed">{n.body}</p>
            )}
          </div>
          <button
            onClick={() => markRead(n.id)}
            className="flex-shrink-0 text-white/30 hover:text-white/70 transition-colors mt-0.5"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
