"use client";

import { useState, useEffect } from 'react';
import { api } from "@/lib/api-client";
import { useDeals } from "@/hooks/useDeals";
import { useAgentTasks } from "@/hooks/useTasks";
import { useAllContingenciesForDeals } from "@/hooks/useContingencies";
import { Calendar, Copy, Check, ExternalLink, CalendarClock, Clock, Shield } from 'lucide-react';

type CalEntry = {
  id: string;
  date: string;
  title: string;
  sub: string;
  type: 'closing' | 'task' | 'contingency';
};

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

const TYPE_META = {
  closing:     { dot: 'bg-brand-navy',  label: 'Closing',     icon: CalendarClock },
  task:        { dot: 'bg-blue-400',    label: 'Task',        icon: Clock },
  contingency: { dot: 'bg-amber-400',   label: 'Contingency', icon: Shield },
};

// Hoisted to module scope so they're not re-created every CalendarPage
// render (react-hooks/static-components). Both are pure functions of
// their props plus the module-level TYPE_META + daysUntil helpers.
function EventRow({ entry }: { entry: CalEntry }) {
  const days = daysUntil(entry.date);
  const isPast  = days < 0;
  const isToday = days === 0;
  const meta = TYPE_META[entry.type];
  const Icon = meta.icon;

  return (
    <div className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
      isPast  ? 'bg-red-50 border border-red-100' :
      isToday ? 'bg-amber-50 border border-amber-100' :
                'bg-white border border-gray-100'
    }`}>
      <Icon size={15} className={isPast ? 'text-red-400' : isToday ? 'text-amber-500' : 'text-gray-300'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={`text-sm font-semibold truncate ${isPast ? 'text-red-800' : 'text-brand-navy'}`}>
            {entry.title}
          </p>
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase flex-shrink-0 ${meta.dot} text-white`}>
            {meta.label}
          </span>
        </div>
        {entry.sub && <p className="text-xs text-gray-400 truncate">{entry.sub}</p>}
      </div>
      <div className="text-right flex-shrink-0">
        <div className={`text-xs font-bold ${isPast ? 'text-red-600' : isToday ? 'text-amber-600' : days <= 7 ? 'text-amber-500' : 'text-gray-400'}`}>
          {isPast ? `${Math.abs(days)}d overdue` : isToday ? 'Today' : `${days}d`}
        </div>
        <div className="text-[10px] text-gray-300">{entry.date}</div>
      </div>
    </div>
  );
}

function Group({ title, items, accent }: { title: string; items: CalEntry[]; accent: string }) {
  if (items.length === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className={`text-xs font-bold uppercase tracking-wider ${accent}`}>{title}</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">{items.length}</span>
      </div>
      <div className="space-y-2">{items.map((e) => <EventRow key={e.id} entry={e} />)}</div>
    </section>
  );
}

export default function CalendarPage() {
  const { deals } = useDeals();
  const { tasks }  = useAgentTasks();
  const contingencies = useAllContingenciesForDeals(deals.map((d) => d.id));

  const [calUrl, setCalUrl] = useState<{ feed_url: string; webcal_url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get<{ feed_url: string; webcal_url: string }>('/me/calendar-url')
      .then(setCalUrl)
      .catch(() => {});
  }, []);

  const entries: CalEntry[] = [];

  deals.forEach((d) => {
    const closing = d.timeline.closingDate;
    if (closing) {
      entries.push({
        id: `close-${d.id}`,
        date: closing,
        title: `Closing — ${d.clientName}`,
        sub: `${d.property.address}${d.property.city ? `, ${d.property.city}` : ''}`,
        type: 'closing',
      });
    }
  });

  tasks.filter((t) => t.dueDate && t.status !== 'completed').forEach((t) => {
    const deal = deals.find((d) => d.id === t.dealId);
    entries.push({
      id: `task-${t.id}`,
      date: t.dueDate!,
      title: t.title,
      sub: deal?.clientName ?? '',
      type: 'task',
    });
  });

  const dealMap = Object.fromEntries(deals.map((d) => [d.id, d]));
  contingencies.filter((c) => c.status === 'active' && c.deadline).forEach((c) => {
    const deal = dealMap[c.dealId];
    entries.push({
      id: `cont-${c.id}`,
      date: c.deadline!,
      title: c.label,
      sub: deal?.clientName ?? '',
      type: 'contingency',
    });
  });

  entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const overdue  = entries.filter((e) => daysUntil(e.date) < 0);
  const today    = entries.filter((e) => daysUntil(e.date) === 0);
  const week1    = entries.filter((e) => daysUntil(e.date) > 0 && daysUntil(e.date) <= 7);
  const week2    = entries.filter((e) => daysUntil(e.date) > 7 && daysUntil(e.date) <= 14);
  const month    = entries.filter((e) => daysUntil(e.date) > 14 && daysUntil(e.date) <= 30);
  const later    = entries.filter((e) => daysUntil(e.date) > 30);

  function copyUrl() {
    if (!calUrl) return;
    navigator.clipboard.writeText(calUrl.webcal_url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }


  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">Calendar</h1>
          <p className="text-sm text-gray-400 mt-0.5">Closings, task deadlines, and contingency dates</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {calUrl && (
            <>
              <a
                href={calUrl.webcal_url}
                className="flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-xs font-semibold text-white hover:bg-brand-navy/90 transition-colors"
              >
                <Calendar size={13} /> Subscribe
              </a>
              <button
                onClick={copyUrl}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                {copied ? 'Copied!' : 'Copy URL'}
              </button>
              <a
                href={calUrl.feed_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-brand-navy transition-colors"
                title="Download .ics file"
              >
                <ExternalLink size={12} /> .ics
              </a>
            </>
          )}
        </div>
      </div>

      {calUrl && (
        <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
          <p className="text-xs font-semibold text-blue-800 mb-1">Subscribe in your calendar app</p>
          <p className="text-[11px] text-blue-600 leading-relaxed">
            Click <strong>Subscribe</strong> to open in your default calendar app, or click <strong>Copy URL</strong>
            {' '}and paste into Google Calendar → &quot;Other calendars&quot; → &quot;From URL&quot;.
            Closings, task deadlines, and contingency dates stay in sync automatically.
          </p>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-xl bg-white px-5 py-12 text-center text-gray-400 shadow-sm">
          <Calendar size={32} className="mx-auto mb-2 text-gray-200" />
          <p className="text-sm font-medium">No upcoming dates yet</p>
          <p className="text-xs mt-0.5">Closing dates and task deadlines will appear here</p>
        </div>
      ) : (
        <div className="space-y-6">
          <Group title="Overdue" items={overdue} accent="text-red-600" />
          <Group title="Today" items={today} accent="text-amber-600" />
          <Group title="This Week" items={week1} accent="text-brand-navy" />
          <Group title="Next Week" items={week2} accent="text-gray-500" />
          <Group title="This Month" items={month} accent="text-gray-400" />
          <Group title="Later" items={later} accent="text-gray-300" />
        </div>
      )}
    </div>
  );
}
