import { Component, useEffect, useRef, useState } from 'react';
import {
  Store,
  ClipboardList,
  FileText,
  Warehouse,
  Truck,
  Wallet,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * Login-page story: an animated 3D miniature business (three.js, lazy-loaded).
 * Falls back to a static illustration without WebGL, and to a still frame when
 * the visitor prefers reduced motion. Purely decorative - every figure on the
 * floating cards is sample data, not the user's.
 */
const STEPS = [
  { label: 'Customer', icon: Store },
  { label: 'Order', icon: ClipboardList },
  { label: 'Invoice', icon: FileText },
  { label: 'Warehouse', icon: Warehouse },
  { label: 'Delivery', icon: Truck },
  { label: 'Payment', icon: Wallet },
];
const CAPTIONS = [
  'Customer Relationship',
  'Create and Manage Sales Orders',
  'Organized Invoicing',
  'Inventory and Stock Management',
  'Business Delivery Workflow',
  'Payment and Financial Management',
  'One platform. Connected business operations.',
];

const hasWebGL = () => {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
};

/** Floating DOM card: the scene moves the outer box, CSS animates the inner one. */
function Floating({ innerRef, children, className }) {
  return (
    <div
      ref={innerRef}
      data-show="false"
      className="group pointer-events-none absolute left-0 top-0 z-10 will-change-transform"
    >
      <div
        className={cn(
          'mb-3 origin-bottom scale-90 opacity-0 transition-all duration-500 ease-out',
          'group-data-[show=true]:scale-100 group-data-[show=true]:opacity-100',
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

const Sample = () => (
  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
    Sample
  </span>
);

const Row = ({ k, v, strong }) => (
  <div className="flex items-center justify-between gap-6 text-[11px]">
    <span className="text-slate-500">{k}</span>
    <span className={cn('text-slate-800', strong && 'text-sm font-bold text-slate-900')}>{v}</span>
  </div>
);

function StaticJourney() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        {STEPS.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2 sm:gap-3">
            <div className="flex flex-col items-center gap-2">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20 sm:h-16 sm:w-16">
                <s.icon className="h-6 w-6 text-brand-300 sm:h-7 sm:w-7" />
              </span>
              <span className="text-[11px] font-medium text-white/80">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <ArrowRight className="mb-5 h-4 w-4 text-white/40" />}
          </div>
        ))}
      </div>
    </div>
  );
}

class SceneBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <StaticJourney /> : this.props.children;
  }
}

function Scene({ compact, onPhase, phase }) {
  const stage = useRef(null);
  const refs = {
    order: useRef(null),
    invoice: useRef(null),
    pack: useRef(null),
    van: useRef(null),
    pay: useRef(null),
    hub: useRef(null),
    shop: useRef(null),
    warehouse: useRef(null),
    road: useRef(null),
  };
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    if (!hasWebGL()) {
      onPhase(6); // the static picture shows the whole journey
      setStatus('fallback');
      return undefined;
    }
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let api = null;
    let cancelled = false;
    import('./journey/createJourneyScene.js')
      .then(({ createJourneyScene }) => {
        if (cancelled || !stage.current) return;
        const o = (key, anchor, phases) => ({ el: refs[key].current, anchor, phases });
        api = createJourneyScene(stage.current, {
          compact,
          reducedMotion,
          onPhase,
          overlays: compact
            ? []
            : [
                o('order', 'rep', [1]),
                o('invoice', 'rep', [2]),
                o('pack', 'warehouse', [3]),
                o('van', 'van', [4]),
                o('pay', 'customer', [5]),
                o('hub', 'hub', [6]),
                o('shop', 'shop', [6]),
                o('warehouse', 'shelf', [6]),
                o('road', 'road', [6]),
              ],
        });
        if (reducedMotion) onPhase(6);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        onPhase(6);
        setStatus('fallback');
      });
    return () => {
      cancelled = true;
      api?.dispose();
    };
    // refs are stable; rebuild only when the layout mode changes
  }, [compact]);

  if (status === 'fallback') return <StaticJourney />;

  return (
    <div
      ref={stage}
      className="absolute inset-0"
      role="img"
      aria-label="Animated illustration of a business journey: customer visit, sales order, invoice, warehouse, delivery and payment"
    >
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <div className="h-1/2 w-2/3 max-w-xl animate-pulse rounded-[40%] bg-white/5" />
        </div>
      )}

      {!compact && (
        <div aria-hidden="true">
          <Floating
            innerRef={refs.order}
            className="w-60 rounded-2xl bg-white p-3.5 shadow-2xl shadow-black/30"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                <ClipboardList className="h-3.5 w-3.5 text-brand-600" /> Sales order
              </span>
              <Sample />
            </div>
            <div className="space-y-1">
              <Row k="Customer" v="Sharma General Store" />
              <Row k="Product" v="Butter 500g" />
              <Row k="Quantity" v="20" />
              <Row k="Price" v="₹270.00" />
              <div className="my-1.5 border-t border-dashed" />
              <Row k="Order total" v="₹5,400.00" strong />
            </div>
          </Floating>

          <Floating
            innerRef={refs.invoice}
            className="w-60 rounded-2xl bg-white p-3.5 shadow-2xl shadow-black/30"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                <FileText className="h-3.5 w-3.5 text-brand-600" /> Tax invoice
              </span>
              <Sample />
            </div>
            <p className="mb-1.5 font-mono text-[11px] font-semibold text-brand-700">INV-0001</p>
            <div className="space-y-1">
              <Row k="Butter 500g × 20" v="₹5,400.00" />
              <Row k="GST" v="₹270.00" />
              <div className="my-1.5 border-t border-dashed" />
              <Row k="Total" v="₹5,670.00" strong />
            </div>
            <p className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Invoice issued
            </p>
          </Floating>

          <Floating
            innerRef={refs.pack}
            className="rounded-xl bg-white px-3 py-2 shadow-xl shadow-black/30"
          >
            <p className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
              <Warehouse className="h-3.5 w-3.5 text-brand-600" /> Packed for dispatch
            </p>
            <p className="text-[11px] text-slate-500">20 units picked from stock</p>
          </Floating>

          <Floating
            innerRef={refs.van}
            className="rounded-full bg-white px-3 py-1.5 shadow-xl shadow-black/30"
          >
            <p className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
              <Truck className="h-3.5 w-3.5 text-brand-600" /> Out for delivery
            </p>
          </Floating>

          <Floating
            innerRef={refs.pay}
            className="w-52 rounded-2xl bg-white p-3.5 text-center shadow-2xl shadow-emerald-900/30"
          >
            <span className="mx-auto mb-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </span>
            <p className="text-sm font-bold text-slate-900">Payment Received</p>
            <p className="text-[11px] text-slate-500">₹5,670.00 recorded against INV-0001</p>
          </Floating>

          <Floating
            innerRef={refs.hub}
            className="rounded-full bg-brand-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xl shadow-brand-900/40"
          >
            ElevIQ Bizflow
          </Floating>
          {[
            ['shop', 'Customers & orders'],
            ['warehouse', 'Inventory'],
            ['road', 'Delivery & collections'],
          ].map(([k, label]) => (
            <Floating
              key={k}
              innerRef={refs[k]}
              className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-slate-800 shadow-lg"
            >
              {label}
            </Floating>
          ))}
        </div>
      )}
      <span className="sr-only">Current step: {CAPTIONS[phase]}</span>
    </div>
  );
}

export default function BusinessJourney({ compact = false }) {
  const [phase, setPhase] = useState(0);
  return (
    <>
      <SceneBoundary>
        <Scene compact={compact} phase={phase} onPhase={setPhase} />
      </SceneBoundary>

      {compact ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center"
          aria-hidden="true"
        >
          <span
            key={phase}
            className="animate-fade-in rounded-full bg-black/40 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur"
          >
            {CAPTIONS[phase]}
          </span>
        </div>
      ) : (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#070d1c] via-[#070d1c]/85 to-transparent px-10 pb-8 pt-16"
          aria-hidden="true"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-300">
            The business journey
          </p>
          <p key={phase} className="mt-1 animate-fade-in text-xl font-bold text-white xl:text-2xl">
            {CAPTIONS[phase]}
          </p>
          <ol className="mt-4 flex flex-wrap items-center gap-1.5">
            {STEPS.map((s, i) => {
              const active = phase === 6 || i === phase;
              const done = phase === 6 || i < phase;
              return (
                <li key={s.label} className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all duration-500',
                      active
                        ? 'bg-brand-500 text-white shadow-lg shadow-brand-900/40'
                        : done
                          ? 'bg-white/15 text-white'
                          : 'bg-white/5 text-white/50'
                    )}
                  >
                    <s.icon className="h-3.5 w-3.5" />
                    {s.label}
                  </span>
                  {i < STEPS.length - 1 && <ArrowRight className="h-3 w-3 text-white/30" />}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </>
  );
}
