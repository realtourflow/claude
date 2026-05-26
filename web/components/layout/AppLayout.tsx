"use client";

import { ReactNode, useState, useRef, useEffect } from 'react';
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from '../../store/authStore';
import { useAgentSetupStore } from '../../store/agentSetupStore';
import { GroupId } from '../../permissions/groups';
import {
  LayoutDashboard,
  GitBranch,
  FolderOpen,
  Calendar,
  MessageSquare,
  FileText,
  Settings,
  AlertCircle,
  CheckSquare,
  DollarSign,
  Shield,
  Zap,
  Activity,
  Tag,
  Sliders,
  ClipboardList,
  UserPlus,
  Users,
  LogOut,
  Bell,
  X,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';
import InviteModal from '../InviteModal';
import { useNotifications } from '../../hooks/useNotifications';

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { notifications, markRead, markAllRead } = useNotifications();
  const ref = useRef<HTMLDivElement>(null);

  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white leading-none">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-2xl bg-white shadow-xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-bold text-brand-navy">Notifications</span>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs font-medium text-gray-400 hover:text-brand-navy transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {notifications.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">All caught up!</p>
            ) : (
              notifications.map((n) => (
                <Link
                  key={n.id}
                  href={n.href ?? '#'}
                  onClick={() => { markRead(n.id); setOpen(false); }}
                  className={`block px-4 py-3 hover:bg-brand-bg transition-colors ${n.read ? '' : 'bg-blue-50/60'}`}
                >
                  <div className="flex items-start gap-2.5">
                    {!n.read && (
                      <span className="mt-1.5 flex-shrink-0 h-2 w-2 rounded-full bg-blue-500" />
                    )}
                    <div className={n.read ? 'ml-4' : ''}>
                      <p className={`text-xs font-semibold ${n.read ? 'text-gray-600' : 'text-brand-navy'}`}>{n.title}</p>
                      {n.body && <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{n.body}</p>}
                      <p className="text-[10px] text-gray-300 mt-1">{n.createdAt}</p>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Agent Sidebar Nav ────────────────────────────────────────────────────────

const AGENT_NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/agent' },
  { label: 'Pipeline', icon: GitBranch, href: '/agent/pipeline' },
  { label: 'Deals', icon: FolderOpen, href: '/agent/deals' },
  { label: 'Calendar', icon: Calendar, href: '/agent/calendar' },
  { label: 'Messages', icon: MessageSquare, href: '/agent/messages' },
  { label: 'Documents', icon: FileText, href: '/agent/documents' },
  { label: 'Settings', icon: Settings, href: '/agent/settings' },
];

const ADMIN_NAV = [
  { label: 'Pipeline Overview', icon: GitBranch, href: '/admin' },
  { label: 'All Deals', icon: FolderOpen, href: '/admin/deals' },
  { label: 'Pending Disclosures', icon: AlertCircle, href: '/admin/disclosures' },
  { label: 'Pre-Approval Queue', icon: CheckSquare, href: '/admin/preapproval' },
  { label: 'Stuck Deals', icon: AlertCircle, href: '/admin/stuck' },
  { label: 'Fees Collected', icon: DollarSign, href: '/admin/fees' },
  { label: 'Outstanding', icon: ClipboardList, href: '/admin/outstanding' },
  { label: 'Active Fast Pass', icon: Zap, href: '/admin/fastpass' },
  { label: 'Smooth Exit', icon: LogOut, href: '/admin/smoothexit' },
  { label: 'ARIVE Status', icon: Activity, href: '/admin/arive' },
  { label: 'User Management', icon: Users, href: '/admin/users' },
  { label: 'Promotions', icon: Tag, href: '/admin/promotions' },
  { label: 'System Config', icon: Sliders, href: '/admin/config' },
  { label: 'Audit Log', icon: ScrollText, href: '/admin/audit' },
  { label: 'Settings', icon: Settings, href: '/admin/settings' },
];

const TC_NAV = [
  { label: 'Overview',         icon: FolderOpen,    href: '/tc'              },
  { label: 'Documents',        icon: FileText,      href: '/tc/documents'    },
  { label: 'Loan Milestones',  icon: ClipboardList, href: '/tc/disclosures'  },
  { label: 'Checklists',       icon: CheckSquare,   href: '/tc/checklists'   },
  { label: 'Calendar',         icon: Calendar,      href: '/tc/calendar'     },
  { label: 'Contacts',         icon: MessageSquare, href: '/tc/messages'     },
  { label: 'Settings',         icon: Settings,      href: '/tc/settings'     },
];

// ─── Sub-layouts ──────────────────────────────────────────────────────────────

type SidebarNavItem = { label: string; icon: LucideIcon; href: string };

function Sidebar({ items, title, labelColor }: { items: SidebarNavItem[]; title: string; labelColor: string }) {
  const location = usePathname();

  return (
    <aside className="flex h-full w-56 flex-shrink-0 flex-col bg-brand-navy text-white">
      {/* Brand Header */}
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/10">
        <span className="text-lg font-bold tracking-tight">RealTour Flow</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${labelColor}`}>
          {title}
        </span>
      </div>
      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === '/agent' || item.href === '/admin'
                ? location === item.href
                : location.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={[
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-brand-gold text-brand-navy font-semibold'
                      : 'text-white/70 hover:bg-white/10 hover:text-white',
                  ].join(' ')}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

function TopHeader({
  roleLabel,
  roleBgClass,
}: {
  roleLabel: string;
  roleBgClass: string;
}) {
  const activeUser = useAuthStore((s) => s.activeUser);

  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between bg-brand-navy px-6 shadow-md">
      <div className="flex items-center gap-2">
        <span className="text-base font-bold text-white tracking-tight">RealTour Flow</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${roleBgClass}`}>
          {roleLabel}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {activeUser && (
          <>
            <span className="text-sm text-white/70">{activeUser.name}</span>
            <img
              src={activeUser.avatar}
              alt={activeUser.name}
              className="h-8 w-8 rounded-full ring-2 ring-brand-gold/50"
            />
          </>
        )}
      </div>
    </header>
  );
}

// Agent Layout

function SetupBanner() {
  const { bannerDismissed, dismissBanner } = useAgentSetupStore();
  const onboardingComplete = useAuthStore((s) => s.activeUser?.onboardingComplete);
  if (onboardingComplete || bannerDismissed) return null;
  return (
    <div className="flex items-center justify-between gap-3 bg-amber-50 border-b border-amber-200 px-5 py-2.5">
      <div className="flex items-center gap-2 text-sm text-amber-800">
        <span className="font-semibold">Your account setup isn't complete yet.</span>
        <span className="text-amber-600 hidden sm:inline">Finish in about 3 minutes to unlock your full workspace.</span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <Link
          href="/onboard/agent"
          className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-bold text-white hover:bg-amber-600 transition-colors"
        >
          Complete setup →
        </Link>
        <button onClick={dismissBanner} className="text-amber-400 hover:text-amber-600 transition-colors">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

function AgentLayout({ children }: { children: ReactNode }) {
  const activeUser = useAuthStore((s) => s.activeUser);
  const [showInvite, setShowInvite] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-brand-bg">
      <Sidebar items={AGENT_NAV} title="Agent" labelColor="bg-blue-500/30 text-blue-300" />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Agent top bar */}
        <div className="flex h-12 flex-shrink-0 items-center justify-end gap-3 bg-white border-b border-gray-100 px-5 shadow-sm">
          <NotificationBell />
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 rounded-lg bg-brand-gold px-3.5 py-1.5 text-sm font-semibold text-brand-navy hover:bg-brand-gold-dark transition-colors shadow-sm"
          >
            <UserPlus size={15} />
            Invite Client
          </button>
        </div>
        {/* Setup banner — only shows if setup incomplete */}
        <SetupBanner />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>

      {showInvite && activeUser && (
        <InviteModal agentId={activeUser.id} onClose={() => setShowInvite(false)} />
      )}
    </div>
  );
}

// Admin Layout

function AdminLayout({ children }: { children: ReactNode }) {
  const activeUser = useAuthStore((s) => s.activeUser);
  return (
    <div className="flex h-screen overflow-hidden bg-brand-bg">
      <Sidebar items={ADMIN_NAV} title="Admin" labelColor="bg-red-500/30 text-red-300" />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-12 flex-shrink-0 items-center justify-between bg-white border-b border-gray-100 px-5 shadow-sm">
          <span className="text-xs font-semibold text-gray-400">Admin Console</span>
          <div className="flex items-center gap-3">
            <NotificationBell />
            {activeUser && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 hidden sm:block">{activeUser.name}</span>
                <img src={activeUser.avatar} alt={activeUser.name} className="h-7 w-7 rounded-full ring-2 ring-red-200" />
              </div>
            )}
          </div>
        </div>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

// TC Layout

function TCLayout({ children }: { children: ReactNode }) {
  const activeUser = useAuthStore((s) => s.activeUser);
  return (
    <div className="flex h-screen overflow-hidden bg-brand-bg">
      <Sidebar items={TC_NAV} title="TC" labelColor="bg-amber-500/30 text-amber-300" />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-12 flex-shrink-0 items-center justify-between bg-white border-b border-gray-100 px-5 shadow-sm">
          <span className="text-xs font-semibold text-gray-400">Transaction Coordinator</span>
          <div className="flex items-center gap-3">
            <NotificationBell />
            {activeUser && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 hidden sm:block">{activeUser.name}</span>
                <img src={activeUser.avatar} alt={activeUser.name} className="h-7 w-7 rounded-full ring-2 ring-amber-200" />
              </div>
            )}
          </div>
        </div>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

// Client Layout (buyer/seller — mobile-first, no sidebar)

function ClientLayout({ children, roleLabel }: { children: ReactNode; roleLabel: string }) {
  return (
    <div className="flex min-h-screen flex-col bg-brand-bg">
      <TopHeader roleLabel={roleLabel} roleBgClass="bg-brand-gold/20 text-brand-gold" />
      <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

// ─── Smart AppLayout ───────────────────────────────────────────────────────────

type AppLayoutProps = {
  children: ReactNode;
};

export function AppLayout({ children }: AppLayoutProps) {
  const activeUser = useAuthStore((s) => s.activeUser);
  const isLoaded = useAuthStore((s) => s.isLoaded);
  const groupId = activeUser?.groupId as GroupId | undefined;

  // Hold rendering of protected pages until /users/sync completes so child
  // components don't fire API calls before the auth token is wired up.
  if (!isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-brand-bg">
        <div className="text-sm text-gray-400">Loading…</div>
      </div>
    );
  }

  if (groupId === 'agent') {
    return <AgentLayout>{children}</AgentLayout>;
  }

  if (groupId === 'admin') {
    return <AdminLayout>{children}</AdminLayout>;
  }

  if (groupId === 'buyer') {
    return <ClientLayout roleLabel="Buyer">{children}</ClientLayout>;
  }

  if (groupId === 'seller') {
    return <ClientLayout roleLabel="Seller">{children}</ClientLayout>;
  }

  if (groupId === 'tc') {
    return <TCLayout>{children}</TCLayout>;
  }

  // Fallback
  return <AgentLayout>{children}</AgentLayout>;
}
