type Props = { title: string; description?: string };

export default function ComingSoon({ title, description }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-navy/5">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-navy/30">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-brand-navy mb-2">{title}</h2>
      <p className="text-sm text-gray-400 max-w-xs leading-relaxed">
        {description ?? 'This section is being built for the next phase. Check back soon.'}
      </p>
      <div className="mt-6 rounded-full bg-brand-gold/20 border border-brand-gold/30 px-4 py-1.5">
        <span className="text-xs font-bold text-brand-navy/60 uppercase tracking-wider">Phase 2</span>
      </div>
    </div>
  );
}
