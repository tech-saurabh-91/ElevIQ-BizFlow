import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  History,
  IndianRupee,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  PackageCheck,
  Phone,
  Receipt,
  Route,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Tags,
  Target,
  Truck,
  Undo2,
  Users,
  Wallet,
  Warehouse,
  X,
} from 'lucide-react';
import { LogoMark } from '@/components/brand/Logo';
import { cn } from '@/utils/cn';

/**
 * Public home page (/), shown to signed-out visitors. Everything on it is
 * true of the product today: the pictures are real screens of the app
 * (demo company data) and there are no invented customer numbers or quotes.
 */

const CONTACT = {
  phone: '+91 96546 63440',
  phoneHref: 'tel:+919654663440',
  whatsapp: '919654663440',
  email: 'contact@eleviqtechnologies.com',
  company: 'ElevIQ Technologies',
};

const IMG = (name) => `/landing/${name}.webp`;

const NAV = [
  { href: '#modules', label: 'Features' },
  { href: '#tour', label: 'Product tour' },
  { href: '#how', label: 'How it works' },
  { href: '#mobile', label: 'Mobile' },
  { href: '#faq', label: 'FAQ' },
];

const MODULES = [
  { icon: ShoppingCart, title: 'Order booking', text: 'Salesmen book orders at the shop with the right price list, scheme and GST filled in. Big orders go for approval.' },
  { icon: FileText, title: 'GST invoicing', text: 'Turn an order into a GST invoice in one click. Print, share or email it as a PDF with your logo.' },
  { icon: Wallet, title: 'Payments & collections', text: 'Record cash, UPI, cheque or bank receipts against invoices. See who owes what, and since when.' },
  { icon: Undo2, title: 'Credit notes & returns', text: 'Sales returns and rate differences as credit notes, with stock and customer balance updated.' },
  { icon: Warehouse, title: 'Stock & godowns', text: 'Live stock in every godown, transfers, adjustments and low-stock alerts. Batches and expiry where you need them.' },
  { icon: Truck, title: 'Van sales', text: 'Load stock on a van, sell from it on the route and settle cash at the end of the day.' },
  { icon: PackageCheck, title: 'Purchase', text: 'Purchase orders, goods receipts, supplier bills, returns and payments, all linked together.' },
  { icon: Tags, title: 'Price lists & schemes', text: 'Different rates per customer group, quantity slabs, free goods and discount limits per role.' },
  { icon: MapPin, title: 'Field force', text: 'GPS attendance, beat plans, shop visits with check-in, and expenses from the salesman’s phone.' },
  { icon: Target, title: 'Targets', text: 'Set sales and collection targets per salesman and track progress through the month.' },
  { icon: BarChart3, title: 'Reports', text: 'Sales register, GST summary, gross profit, receivable ageing, stock and field reports. Export to Excel.' },
  { icon: Users, title: 'Users & roles', text: 'Owner, manager, salesman, accountant and warehouse roles, each seeing only what they should.' },
];

const TOUR = [
  { key: 'dashboard', label: 'Dashboard', img: '01-dashboard', title: 'Your whole business on one screen', text: 'Sales, profit, collections, money owed both ways, stock value, orders waiting for approval or dispatch, and who is out in the field today.' },
  { key: 'orders', label: 'Orders', img: '05-order-new', title: 'Book an order in under a minute', text: 'Pick the customer and products; rates, schemes, discounts and GST are applied for you. The order reserves stock as soon as it is confirmed.' },
  { key: 'invoice', label: 'Invoices', img: '07-invoice-detail', title: 'GST invoices, ready to share', text: 'Create the invoice from the order, print it or send it as a PDF. Payments and credit notes stay linked to it.' },
  { key: 'stock', label: 'Stock', img: '13-stock-on-hand', title: 'Know exactly what is in each godown', text: 'Stock on hand, reserved and available, per godown and van, valued at average cost. Low-stock items stand out.' },
  { key: 'ageing', label: 'Receivables', img: '21-receivable-ageing', title: 'Know who owes you, and for how long', text: 'Outstanding by customer split into 0–30, 31–60, 61–90 and 90+ days, with a full ledger one click away.' },
  { key: 'field', label: 'Field visits', img: '29-visits', title: 'See your team’s day in the field', text: 'Check-ins at shops with location, what was ordered or collected at each visit, and attendance for the day.' },
  { key: 'gst', label: 'GST reports', img: '22-gst-summary', title: 'Month-end GST without the rush', text: 'GST summary by rate and HSN, sales and purchase registers, ready to hand to your accountant or export to Excel.' },
];

const FLOW = [
  { icon: ShoppingCart, title: 'Order at the shop', text: 'Salesman books it on the phone' },
  { icon: ShieldCheck, title: 'Approve', text: 'Above-limit orders wait for a manager' },
  { icon: FileText, title: 'Invoice', text: 'GST invoice in one click' },
  { icon: Truck, title: 'Dispatch', text: 'Stock leaves the godown or van' },
  { icon: IndianRupee, title: 'Collect', text: 'Cash, UPI, cheque or bank' },
  { icon: BarChart3, title: 'Report', text: 'Sales, profit and GST update live' },
];

const ROLES = [
  { title: 'Owner', points: ['Live sales, profit and cash position', 'Who owes you and who you owe', 'Approve big orders and discounts'] },
  { title: 'Salesman', points: ['Today’s beat and shops to visit', 'Book orders and collect payments', 'Own targets, van stock and expenses'] },
  { title: 'Accountant', points: ['Invoices, receipts and credit notes', 'Supplier bills and payments', 'GST summary and ledgers'] },
  { title: 'Warehouse', points: ['Orders waiting for dispatch', 'Goods receipts and transfers', 'Stock checks and adjustments'] },
];

const PAINS = [
  { before: 'Orders come in on WhatsApp, calls and paper slips', after: 'Every order is booked in one place, with the right rate' },
  { before: 'Stock in the register never matches the godown', after: 'Stock moves by itself with every invoice and receipt' },
  { before: 'Udhaar is tracked in a diary', after: 'Each customer’s balance and overdue days, always current' },
  { before: 'Month-end GST takes days of sorting bills', after: 'GST summary and registers are ready any day' },
];

const STEPS = [
  { title: 'Book a demo', text: 'A 30-minute call where we show BizFlow on a business like yours.' },
  { title: 'Set up', text: 'We create your workspace and bring in customers, products and opening stock from Excel.' },
  { title: 'Train the team', text: 'Short sessions for the office, the warehouse and your salesmen on their phones.' },
  { title: 'Go live', text: 'Start booking orders and billing, with our support a call or a WhatsApp away.' },
];

const SECURITY = [
  { icon: Building2, title: 'Your data is only yours', text: 'Every company has its own separate workspace. No other business can see your data.' },
  { icon: KeyRound, title: 'Role-based access', text: 'Choose exactly what each role can see and do, down to reports and discount limits.' },
  { icon: Lock, title: 'Secure sign-in', text: 'Encrypted connections, locked-out attempts after wrong passwords, and sign-out from every device in one tap.' },
  { icon: History, title: 'Full history', text: 'Each order and invoice keeps a record of who created, changed or approved it.' },
];

const FAQS = [
  { q: 'Who is ElevIQ BizFlow for?', a: 'Distributors, wholesalers, stockists and manufacturers who sell to shops through salesmen, and want orders, billing, stock and collections in one app.' },
  { q: 'Does it work on mobile?', a: 'Yes. It runs in the browser on any phone, tablet or computer, and can be installed on Android and iPhone home screens like an app. Salesmen get a phone-friendly layout with a bottom menu.' },
  { q: 'Are invoices GST-compliant?', a: 'Invoices carry GSTIN, HSN codes and the CGST/SGST or IGST split, and the GST summary report groups your sales by rate and HSN for filing.' },
  { q: 'Can we bring in our existing data?', a: 'Yes. Customers, products and opening stock can be imported from Excel, and our team helps you with it during setup.' },
  { q: 'Can I control what each employee sees?', a: 'Yes. Permissions are set per role, so a salesman can book orders and collect payments, the warehouse handles dispatch and stock, and only the people you choose see costs, profit or reports.' },
  { q: 'Do I need to install anything on a server?', a: 'No. ElevIQ BizFlow runs in the cloud. You sign in with your company code, email or mobile number and password.' },
  { q: 'How much does it cost?', a: 'Plans depend on the modules you need and the number of users. Book a demo and we will share pricing for your business size.' },
];

// ---------------------------------------------------------------------------

/** Fades a block in when it scrolls into view (skipped for reduced motion). */
function Reveal({ as = 'div', className, delay = 0, children, ...rest }) {
  const Tag = as;
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      setShown(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        'transition-all duration-700 ease-out',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

function SectionHeading({ eyebrow, title, text, className }) {
  return (
    <Reveal className={cn('mx-auto max-w-2xl text-center', className)}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      {text && <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">{text}</p>}
    </Reveal>
  );
}

/** A screenshot inside a simple browser window frame. */
function BrowserFrame({ src, alt, className, eager = false }) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-brand-900/10', className)}>
      <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="ml-3 hidden h-5 flex-1 rounded-md bg-white px-2 text-[10px] leading-5 text-slate-400 ring-1 ring-slate-200 sm:block">
          ElevIQ BizFlow
        </span>
      </div>
      <img
        src={src}
        alt={alt}
        width={1600}
        height={900}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        className="block h-auto w-full"
      />
    </div>
  );
}

function PhoneFrame({ src, alt, className }) {
  return (
    <div className={cn('rounded-[2rem] border-[6px] border-slate-900 bg-slate-900 shadow-2xl shadow-brand-900/25', className)}>
      <img
        src={src}
        alt={alt}
        width={520}
        height={1125}
        loading="lazy"
        decoding="async"
        className="block h-auto w-full rounded-[1.6rem]"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-colors',
        scrolled || open ? 'border-b border-slate-200/80 bg-white/90 backdrop-blur-md' : 'bg-transparent'
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2.5" aria-label="ElevIQ BizFlow home">
          <LogoMark size={34} />
          <span className="whitespace-nowrap leading-tight">
            <span className="block text-base font-bold tracking-tight text-slate-900">
              ElevIQ <span className="text-brand-600">BizFlow</span>
            </span>
            <span className="hidden text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500 min-[400px]:block">
              by {CONTACT.company}
            </span>
          </span>
        </a>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900">
              {n.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            to="/login"
            className="hidden items-center gap-1.5 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 sm:inline-flex"
          >
            <LogIn className="h-4 w-4" /> Sign in
          </Link>
          <a
            href="#demo"
            className="inline-flex items-center whitespace-nowrap rounded-full bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-600/30 hover:bg-brand-700 sm:px-4"
          >
            Book demo
          </a>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-slate-200 bg-white px-4 pb-4 pt-2 lg:hidden" aria-label="Mobile">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {n.label}
            </a>
          ))}
          <Link to="/login" className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50">
            <LogIn className="h-4 w-4" /> Sign in to your workspace
          </Link>
        </nav>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden pb-16 pt-10 sm:pb-24 sm:pt-16">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            'radial-gradient(800px 420px at 85% 10%, rgba(50,135,252,.16), transparent 70%), radial-gradient(600px 380px at 0% 30%, rgba(124,58,237,.10), transparent 70%)',
        }}
        aria-hidden="true"
      />
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              <Sparkles className="h-3.5 w-3.5" /> Made for Indian distributors & wholesalers
            </span>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl xl:text-6xl">
              Run your distribution business.{' '}
              <span className="bg-gradient-to-r from-brand-600 to-violet-600 bg-clip-text text-transparent">Not your paperwork.</span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
              ElevIQ BizFlow puts orders, GST billing, stock, collections, purchase and your field team in one app, on the
              phone in your salesman’s hand and the laptop on your desk.
            </p>
          </Reveal>
          <Reveal delay={240} className="mt-8 flex flex-wrap gap-3">
            <a
              href="#demo"
              className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700"
            >
              Book a free demo <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#tour"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              See the product
            </a>
          </Reveal>
          <Reveal delay={320} as="ul" className="mt-8 grid max-w-lg grid-cols-2 gap-x-6 gap-y-2.5 text-sm text-slate-700">
            {['GST-ready invoices', 'Works on any phone', 'Your data kept separate', 'Excel import & export'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> {t}
              </li>
            ))}
          </Reveal>
        </div>

        <Reveal delay={200} className="relative">
          <BrowserFrame src={IMG('01-dashboard')} alt="ElevIQ BizFlow dashboard with sales, profit, collections and stock" eager />
          <PhoneFrame
            src={IMG('41-phone-orders')}
            alt="Orders list on a phone"
            className="absolute -bottom-10 -left-4 hidden w-[24%] sm:block lg:-left-10"
          />
          <div className="absolute -right-2 -top-5 hidden items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xl sm:flex lg:-right-6">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
              <Bell className="h-4 w-4" />
            </span>
            <span className="text-xs leading-tight">
              <span className="block font-semibold text-slate-900">Order approved</span>
              <span className="text-slate-500">Ready to invoice</span>
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Pains() {
  return (
    <section className="border-y border-slate-200 bg-slate-50 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Sound familiar?"
          title="From diaries and WhatsApp to one clear system"
          text="The day-to-day problems every growing distributor runs into, and what changes with BizFlow."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {PAINS.map((p, i) => (
            <Reveal key={p.before} delay={i * 80} className="grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr] sm:gap-3">
              <div className="rounded-2xl border border-red-100 bg-white p-4 text-sm text-slate-600">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-red-500">Today</span>
                {p.before}
              </div>
              <span className="flex items-center justify-center text-slate-300">
                <ArrowRight className="h-5 w-5 rotate-90 sm:rotate-0" />
              </span>
              <div className="rounded-2xl border border-emerald-100 bg-white p-4 text-sm font-medium text-slate-800">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-emerald-600">With BizFlow</span>
                {p.after}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Modules() {
  return (
    <section id="modules" className="scroll-mt-20 py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Everything in one app"
          title="Every part of your sales and supply, connected"
          text="Each module works on the same data, so an order becomes an invoice, moves stock, and shows up in the customer’s balance and your reports without typing anything twice."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {MODULES.map((m, i) => (
            <Reveal
              key={m.title}
              delay={(i % 4) * 70}
              className="group rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-lg hover:shadow-brand-900/5"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-white">
                <m.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold text-slate-900">{m.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{m.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Tour() {
  const [active, setActive] = useState(TOUR[0].key);
  const item = TOUR.find((t) => t.key === active) || TOUR[0];
  return (
    <section id="tour" className="scroll-mt-20 bg-[#070d1c] py-16 text-white sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">Product tour</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">See the real app, not a mock-up</h2>
          <p className="mt-4 text-base text-slate-300 sm:text-lg">These are actual BizFlow screens, shown with a demo company’s data.</p>
        </Reveal>

        <div className="mt-10 flex gap-2 overflow-x-auto pb-2 sm:justify-center" role="tablist" aria-label="Product screens">
          {TOUR.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.key === active}
              onClick={() => setActive(t.key)}
              className={cn(
                'shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                t.key === active ? 'bg-white text-slate-900' : 'bg-white/5 text-slate-300 hover:bg-white/10'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-8 grid items-center gap-8 lg:grid-cols-[1fr_2.2fr]" role="tabpanel">
          <div>
            <h3 className="text-2xl font-bold tracking-tight">{item.title}</h3>
            <p className="mt-3 leading-relaxed text-slate-300">{item.text}</p>
            <a href="#demo" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-300 hover:text-brand-200">
              See it with your own products <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <BrowserFrame key={item.key} src={IMG(item.img)} alt={item.title} className="shadow-black/40" />
        </div>
        {/* Preload the other screens once the tour is reached. */}
        <div className="hidden" aria-hidden="true">
          {TOUR.filter((t) => t.key !== active).map((t) => (
            <img key={t.key} src={IMG(t.img)} alt="" loading="lazy" />
          ))}
        </div>
      </div>
    </section>
  );
}

function Flow() {
  return (
    <section id="how" className="scroll-mt-20 py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="How it flows"
          title="From the shop counter to your reports, in one chain"
          text="Each step picks up where the last one left off. Nothing is re-entered, and stock and balances stay right at every step."
        />
        <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {FLOW.map((s, i) => (
            <Reveal as="li" key={s.title} delay={i * 80} className="relative rounded-2xl border border-slate-200 bg-white p-5 text-center">
              <span className="absolute left-4 top-4 text-xs font-bold text-slate-300">{String(i + 1).padStart(2, '0')}</span>
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-md shadow-brand-600/30">
                <s.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-sm font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{s.text}</p>
              {i < FLOW.length - 1 && (
                <ArrowRight className="absolute -right-3.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-white text-brand-400 lg:block" />
              )}
            </Reveal>
          ))}
        </ol>

        <div className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((r, i) => (
            <Reveal key={r.title} delay={i * 80} className="rounded-2xl bg-slate-50 p-6 ring-1 ring-slate-200">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">For the</p>
              <h3 className="text-xl font-bold text-slate-900">{r.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {r.points.map((p) => (
                  <li key={p} className="flex gap-2 text-sm text-slate-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {p}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Mobile() {
  return (
    <section id="mobile" className="scroll-mt-20 overflow-hidden bg-gradient-to-br from-brand-50 via-white to-violet-50 py-16 sm:py-24">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">On the move</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Built for the salesman’s phone</h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Your team works from the road, not a desk. BizFlow gives them a phone layout with big buttons and a bottom menu, and
              can be added to the home screen on Android and iPhone like any other app.
            </p>
          </Reveal>
          <ul className="mt-8 space-y-4">
            {[
              { icon: MapPin, t: 'Mark attendance and check in at shops with location' },
              { icon: ClipboardList, t: 'Follow the day’s beat plan, shop by shop' },
              { icon: ShoppingCart, t: 'Book orders and see stock before promising delivery' },
              { icon: Receipt, t: 'Collect payments and record expenses on the spot' },
              { icon: Route, t: 'Run van sales and settle cash at day end' },
            ].map((f, i) => (
              <Reveal as="li" key={f.t} delay={i * 70} className="flex items-center gap-3 text-slate-800">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 shadow-sm ring-1 ring-slate-200">
                  <f.icon className="h-4 w-4" />
                </span>
                {f.t}
              </Reveal>
            ))}
          </ul>
        </div>
        <Reveal delay={150} className="relative mx-auto flex w-full max-w-md justify-center gap-4">
          <PhoneFrame src={IMG('40-phone-dashboard')} alt="Dashboard on a phone" className="w-1/2 translate-y-6" />
          <PhoneFrame src={IMG('42-phone-reports')} alt="Reports on a phone" className="w-1/2 -translate-y-6" />
        </Reveal>
      </div>
    </section>
  );
}

function Security() {
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading eyebrow="Safe by design" title="Your business data stays private" />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SECURITY.map((s, i) => (
            <Reveal key={s.title} delay={i * 80} className="rounded-2xl border border-slate-200 p-6">
              <s.icon className="h-6 w-6 text-brand-600" />
              <h3 className="mt-4 font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.text}</p>
            </Reveal>
          ))}
        </div>

        <div className="mt-20">
          <SectionHeading eyebrow="Getting started" title="Up and running in days" text="We do the setup with you, so your team starts on real work from day one." />
          <ol className="mt-12 grid gap-4 md:grid-cols-4">
            {STEPS.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 90} className="relative rounded-2xl bg-white p-6 ring-1 ring-slate-200">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                <h3 className="mt-4 font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.text}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 border-t border-slate-200 bg-slate-50 py-16 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeading eyebrow="FAQ" title="Questions, answered" />
        <div className="mt-10 space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="group rounded-2xl border border-slate-200 bg-white px-5 open:shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
              </summary>
              <p className="pb-5 text-sm leading-relaxed text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

const BUSINESS_TYPES = ['Distributor', 'Wholesaler', 'Stockist / C&F', 'Manufacturer', 'Other'];
const TEAM_SIZES = ['No salesmen yet', '1–5 salesmen', '6–20 salesmen', '20+ salesmen'];

function DemoForm() {
  const [form, setForm] = useState({ name: '', business: '', mobile: '', city: '', type: '', team: '' });
  const [errors, setErrors] = useState({});
  const [sent, setSent] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    const next = {};
    if (!form.name.trim()) next.name = 'Please enter your name';
    if (!form.business.trim()) next.business = 'Please enter your business name';
    if (!/^[6-9]\d{9}$/.test(form.mobile.replace(/\D/g, '').slice(-10))) next.mobile = 'Enter a 10-digit mobile number';
    if (!form.city.trim()) next.city = 'Please enter your city';
    setErrors(next);
    if (Object.keys(next).length) return;

    const lines = [
      'Hello ElevIQ team, I would like a demo of ElevIQ BizFlow.',
      `Name: ${form.name.trim()}`,
      `Business: ${form.business.trim()}`,
      `Mobile: ${form.mobile.trim()}`,
      `City: ${form.city.trim()}`,
      form.type && `Business type: ${form.type}`,
      form.team && `Team: ${form.team}`,
    ].filter(Boolean);
    window.open(`https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
    setSent(true);
  };

  const field = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15';
  const label = 'text-sm font-medium text-slate-700';
  const err = (k) => errors[k] && <span className="mt-1 block text-xs text-red-600">{errors[k]}</span>;

  return (
    <section id="demo" className="scroll-mt-20 bg-[#070d1c] py-16 text-white sm:py-24">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">Free, no-obligation demo</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">See BizFlow working for a business like yours</h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-300">
            Tell us a little about your business. We will set up a 30-minute walkthrough and share pricing for your size.
          </p>
          <ul className="mt-8 space-y-3 text-slate-200">
            {['Live walkthrough with your kind of products and customers', 'Setup, Excel import and team training included', 'Pricing based on the modules and users you need'].map((t) => (
              <li key={t} className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" /> {t}
              </li>
            ))}
          </ul>
          <div className="mt-10 space-y-3 text-sm">
            <a href={CONTACT.phoneHref} className="flex items-center gap-3 text-slate-200 hover:text-white">
              <Phone className="h-4 w-4 text-brand-300" /> {CONTACT.phone}
            </a>
            <a href={`mailto:${CONTACT.email}`} className="flex items-center gap-3 text-slate-200 hover:text-white">
              <Mail className="h-4 w-4 text-brand-300" /> {CONTACT.email}
            </a>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <form onSubmit={submit} noValidate className="rounded-3xl bg-white p-6 text-slate-900 shadow-2xl sm:p-8">
            {sent ? (
              <div className="py-10 text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
                <h3 className="mt-4 text-xl font-bold">Almost done</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600">
                  We opened WhatsApp with your details. Press send there and we will get back to you within one working day.
                </p>
                <button type="button" onClick={() => setSent(false)} className="mt-6 text-sm font-semibold text-brand-600 hover:text-brand-700">
                  Edit details
                </button>
              </div>
            ) : (
              <>
                <h3 className="text-xl font-bold">Request a demo</h3>
                <p className="mt-1 text-sm text-slate-500">Takes less than a minute.</p>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className={label}>Your name *</span>
                    <input className={field} value={form.name} onChange={set('name')} autoComplete="name" />
                    {err('name')}
                  </label>
                  <label className="block">
                    <span className={label}>Business name *</span>
                    <input className={field} value={form.business} onChange={set('business')} autoComplete="organization" />
                    {err('business')}
                  </label>
                  <label className="block">
                    <span className={label}>Mobile number *</span>
                    <input className={field} value={form.mobile} onChange={set('mobile')} inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" />
                    {err('mobile')}
                  </label>
                  <label className="block">
                    <span className={label}>City *</span>
                    <input className={field} value={form.city} onChange={set('city')} autoComplete="address-level2" />
                    {err('city')}
                  </label>
                  <label className="block">
                    <span className={label}>Type of business</span>
                    <select className={field} value={form.type} onChange={set('type')}>
                      <option value="">Select</option>
                      {BUSINESS_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={label}>Sales team</span>
                    <select className={field} value={form.team} onChange={set('team')}>
                      <option value="">Select</option>
                      {TEAM_SIZES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  type="submit"
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700"
                >
                  <MessageCircle className="h-4 w-4" /> Send on WhatsApp
                </button>
                <p className="mt-3 text-center text-xs text-slate-500">
                  Opens WhatsApp with your details filled in. Prefer email?{' '}
                  <a href={`mailto:${CONTACT.email}?subject=${encodeURIComponent('ElevIQ BizFlow demo request')}`} className="font-medium text-brand-600 hover:underline">
                    Write to us
                  </a>
                  .
                </p>
              </>
            )}
          </form>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#050a16] py-12 text-sm text-slate-400">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <LogoMark size={32} />
            <span className="text-base font-bold text-white">
              ElevIQ <span className="text-brand-400">BizFlow</span>
            </span>
          </div>
          <p className="mt-4 max-w-sm leading-relaxed">
            Orders, GST billing, stock, collections and field sales in one app for distributors and wholesalers.
          </p>
        </div>
        <div>
          <p className="font-semibold text-white">Product</p>
          <ul className="mt-3 space-y-2">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} className="hover:text-white">
                  {n.label}
                </a>
              </li>
            ))}
            <li>
              <Link to="/login" className="hover:text-white">
                Sign in
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-white">Contact</p>
          <ul className="mt-3 space-y-2">
            <li>
              <a href={CONTACT.phoneHref} className="flex items-center gap-2 hover:text-white">
                <Phone className="h-4 w-4" /> {CONTACT.phone}
              </a>
            </li>
            <li>
              <a href={`mailto:${CONTACT.email}`} className="flex items-center gap-2 break-all hover:text-white">
                <Mail className="h-4 w-4 shrink-0" /> {CONTACT.email}
              </a>
            </li>
            <li>
              <a href="#demo" className="flex items-center gap-2 hover:text-white">
                <Smartphone className="h-4 w-4" /> Book a demo
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="mx-auto mt-10 flex max-w-7xl flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 pt-6 text-xs sm:px-6">
        <span>
          © {new Date().getFullYear()} {CONTACT.company}. All rights reserved.
        </span>
        <span className="flex items-center gap-1.5">
          <FileSpreadsheet className="h-3.5 w-3.5" /> App screens show a demo company’s data.
        </span>
      </div>
    </footer>
  );
}

export default function Landing() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'ElevIQ BizFlow · Orders, GST billing, stock & field sales app for distributors';
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    // The marketing page has its own light design, whatever the app theme is.
    root.classList.remove('dark');
    root.style.scrollBehavior = 'smooth';
    return () => {
      document.title = prevTitle;
      root.style.scrollBehavior = '';
      if (hadDark) root.classList.add('dark');
    };
  }, []);

  return (
    <div id="top" className="min-h-screen bg-white font-sans text-slate-900 antialiased">
      <a href="#modules" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Header />
      <main>
        <Hero />
        <Pains />
        <Modules />
        <Tour />
        <Flow />
        <Mobile />
        <Security />
        <Faq />
        <DemoForm />
      </main>
      <Footer />
    </div>
  );
}
