import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, MessageCircleQuestion, Send, Sparkles, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/utils/cn';
import { APP_NAME } from '@/utils/format';
import { FAQS, GUIDES, forRole, search } from './help-content';

/**
 * Help drawer: "Ask" answers a typed question from the FAQs and guides, and
 * "Guides" reads the step-by-step guides. It only explains: nothing in here
 * opens another screen, so whoever asks stays where they are.
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

const Choice = ({ children, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm hover:bg-accent"
  >
    <span>{children}</span>
    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
  </button>
);

export default function HelpPanel({ open, onClose }) {
  const { user } = useAuth();
  const role = user?.role;
  const guides = useMemo(() => forRole(GUIDES, role), [role]);
  const faqs = useMemo(() => forRole(FAQS, role), [role]);

  const [tab, setTab] = useState('ask');
  const [guide, setGuide] = useState(null);
  const [text, setText] = useState('');
  const [chat, setChat] = useState([]); // [{ q, results }]
  const endRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chat]);

  if (!open) return null;

  const ask = (question) => {
    const q = String(question || '').trim();
    if (!q) return;
    setChat((c) => [...c, { q, results: search(q, role) }]);
    setText('');
  };
  const openGuide = (g) => {
    setTab('guides');
    setGuide(g);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Help">
      <button type="button" aria-label="Close help" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l bg-background shadow-xl">
        <header className="space-y-3 border-b px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5 text-brand-600 dark:text-brand-300" /> Help
              </h2>
              <p className="text-xs text-muted-foreground">How to do anything in {APP_NAME}, in plain words.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-accent" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex gap-2">
            {[
              ['ask', 'Ask', MessageCircleQuestion],
              ['guides', 'Guides', BookOpen],
            ].map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTab(key);
                  if (key === 'guides') setGuide(null);
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium',
                  tab === key ? 'bg-foreground text-background' : 'hover:bg-accent'
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {tab === 'guides' && guide && (
            <div className="space-y-3">
              <button type="button" onClick={() => setGuide(null)} className="inline-flex items-center gap-1 text-sm text-brand-600 dark:text-brand-300">
                <ArrowLeft className="h-4 w-4" /> All guides
              </button>
              <GuideBody guide={guide} />
            </div>
          )}
          {tab === 'guides' && !guide && (
            <div className="space-y-2">
              {guides.map((g) => (
                <Choice key={g.id} onClick={() => setGuide(g)}>
                  {g.title}
                </Choice>
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

          {tab === 'ask' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Ask how to do something, for example how to take a payment or return goods. I explain the steps; I can&apos;t change anything for you.
              </p>
              {chat.length === 0 && (
                <div className="space-y-2">
                  {faqs.slice(0, 4).map((f) => (
                    <Choice key={f.q} onClick={() => ask(f.q)}>
                      {f.q}
                    </Choice>
                  ))}
                </div>
              )}
              {chat.map((m, i) => (
                <div key={i} className="space-y-2">
                  <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-brand-600 px-3 py-2 text-sm text-white">{m.q}</p>
                  <div className="max-w-[95%] space-y-2 rounded-2xl rounded-bl-sm bg-muted px-3 py-2.5 text-sm">
                    {m.results.length === 0 ? (
                      <p>
                        I couldn&apos;t find that. Try other words (for example &quot;payment&quot;, &quot;return&quot;, &quot;stock&quot;), look through
                        Guides, or ask your manager.
                      </p>
                    ) : m.results[0].kind === 'faq' ? (
                      <>
                        <p className="font-medium">{m.results[0].item.q}</p>
                        <p>{m.results[0].item.a}</p>
                      </>
                    ) : (
                      <GuideBody guide={m.results[0].item} />
                    )}
                    {m.results.length > 1 && (
                      <div className="space-y-1 border-t pt-2">
                        <p className="text-xs text-muted-foreground">Related</p>
                        {m.results.slice(1).map((r) =>
                          r.kind === 'faq' ? (
                            <button key={r.item.q} type="button" className="block text-left text-brand-600 hover:underline dark:text-brand-300" onClick={() => ask(r.item.q)}>
                              {r.item.q}
                            </button>
                          ) : (
                            <button key={r.item.id} type="button" className="block text-left text-brand-600 hover:underline dark:text-brand-300" onClick={() => openGuide(r.item)}>
                              Guide: {r.item.title}
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {tab === 'ask' && (
          <form
            className="flex items-end gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask(text);
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  ask(text);
                }
              }}
              rows={2}
              maxLength={300}
              placeholder="e.g. How do I return damaged goods?"
              className="min-h-[44px] flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              aria-label="Ask"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-white disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        )}
      </aside>
    </div>
  );
}
