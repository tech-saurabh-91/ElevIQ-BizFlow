import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { APP_NAME } from '@/utils/format';
import { FAQS, GUIDES, forRole } from './help-content';

/**
 * Help drawer: step-by-step guides and common questions for the user's role.
 * It only explains: nothing in here opens another screen, so whoever reads it
 * stays where they are.
 */

function GuideBody({ guide }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      <h3 className="text-base font-semibold">{guide.title}</h3>
      {guide.body.map((b, i) => {
        if (b.h) return <h4 key={i} className="pt-1 font-semibold">{b.h}</h4>;
        if (b.p) return <p key={i}>{b.p}</p>;
        if (b.steps)
          return (
            <ol key={i} className="list-decimal space-y-1.5 pl-5">
              {b.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          );
        if (b.list)
          return (
            <ul key={i} className="list-disc space-y-1.5 pl-5">
              {b.list.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          );
        return null;
      })}
    </div>
  );
}

export default function HelpPanel({ open, onClose }) {
  const { user } = useAuth();
  const role = user?.role;
  const guides = useMemo(() => forRole(GUIDES, role), [role]);
  const faqs = useMemo(() => forRole(FAQS, role), [role]);
  const [guide, setGuide] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Help">
      <button type="button" aria-label="Close help" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l bg-background shadow-xl">
        <header className="flex items-start justify-between gap-2 border-b px-4 pb-3 pt-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <BookOpen className="h-5 w-5 text-brand-600 dark:text-brand-300" /> Help
            </h2>
            <p className="text-xs text-muted-foreground">How to do anything in {APP_NAME}, in plain words.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-accent" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {guide ? (
            <div className="space-y-3">
              <button type="button" onClick={() => setGuide(null)} className="inline-flex items-center gap-1 text-sm text-brand-600 dark:text-brand-300">
                <ArrowLeft className="h-4 w-4" /> All guides
              </button>
              <GuideBody guide={guide} />
            </div>
          ) : (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Guides</h3>
              {guides.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGuide(g)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm hover:bg-accent"
                >
                  <span>{g.title}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
              <h3 className="pt-3 text-sm font-semibold">Common questions</h3>
              {faqs.map((f) => (
                <details key={f.q} className="rounded-lg border px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-medium">{f.q}</summary>
                  <p className="mt-1.5 text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
