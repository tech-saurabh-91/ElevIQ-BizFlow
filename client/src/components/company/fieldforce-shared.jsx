import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { apiError } from '@/api/client';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';
import { titleCase } from '@/utils/format';

/**
 * Shared Phase 7 field-force helpers: status vocabularies, action availability,
 * the GPS capture hook, progress bars and the workflow dialogs used by the
 * Visits / Attendance / Expenses / Targets screens.
 */

// ---------------------------------------------------------------------------
// Vocabularies (mirror server/src/config/constants.js)
// ---------------------------------------------------------------------------

export const VISIT_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'CANCELLED'];

export const VISIT_OUTCOMES = [
  'ORDER_TAKEN',
  'INVOICED',
  'NO_ORDER',
  'PAYMENT_COLLECTED',
  'CLOSED',
  'CUSTOMER_UNAVAILABLE',
];

/** Why a checked-in customer gave no order (asked at check-out). */
export const NO_ORDER_REASONS = [
  { value: 'STOCK_AVAILABLE', label: 'Has enough stock' },
  { value: 'SHOP_CLOSED', label: 'Shop closed' },
  { value: 'OWNER_ABSENT', label: 'Owner / buyer not available' },
  { value: 'NO_PAYMENT', label: 'Payment issue / pending dues' },
  { value: 'PRICE_ISSUE', label: 'Price or margin issue' },
  { value: 'WAITING_FOR_SCHEME', label: 'Waiting for a scheme' },
  { value: 'COMPETITOR', label: 'Buying from a competitor' },
  { value: 'OTHER', label: 'Other (write in notes)' },
];
export const noOrderReasonLabel = (v) => NO_ORDER_REASONS.find((r) => r.value === v)?.label || v;

export const VISIT_PURPOSES = [
  'ORDER',
  'COLLECTION',
  'PRESENTATION',
  'COMPLAINT',
  'RELATIONSHIP',
  'OTHER',
];

export const ATTENDANCE_STATUSES = [
  'PRESENT',
  'ABSENT',
  'HALF_DAY',
  'LEAVE',
  'HOLIDAY',
  'WEEK_OFF',
  'WORK_FROM_HOME',
];

export const EXPENSE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'];

export const EXPENSE_CATEGORIES = [
  'TRAVEL',
  'FUEL',
  'FOOD',
  'LODGING',
  'COMMUNICATION',
  'OFFICE',
  'OTHER',
];

export const TARGET_PERIODS = ['WEEK', 'MONTH', 'QUARTER', 'YEAR'];

export const TARGET_STATUSES = ['ACTIVE', 'ACHIEVED', 'MISSED', 'CLOSED'];

/** `ORDER_TAKEN` -> `Order taken` (used for chips, selects and headings). */
export const humanize = (value) => titleCase(String(value || '').replace(/_/g, ' '));

export const statusLabel = humanize;
export const categoryLabel = humanize;
export const purposeLabel = humanize;
export const outcomeLabel = humanize;

export const idOf = (value) =>
  value && typeof value === 'object' ? value.id || value._id || '' : value || '';

// ---------------------------------------------------------------------------
// GPS capture
// ---------------------------------------------------------------------------

/**
 * Capture the device position once. Resolves to `null` (rather than throwing)
 * when permission is denied or the API is unavailable, so callers can fall back
 * to submitting without coordinates.
 */
export const captureGps = () =>
  new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: Number(pos.coords.latitude),
          lng: Number(pos.coords.longitude),
          accuracy: pos.coords.accuracy == null ? null : Math.round(pos.coords.accuracy),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 }
    );
  });

/** React hook wrapper around `captureGps` with a pending flag. */
export function useGps() {
  const [busy, setBusy] = useState(false);

  const locate = useCallback(async () => {
    setBusy(true);
    try {
      return await captureGps();
    } finally {
      setBusy(false);
    }
  }, []);

  return { locate, busy };
}

// ---------------------------------------------------------------------------
// Progress bar (targets)
// ---------------------------------------------------------------------------

export function ProgressBar({ percent = 0, tone, className }) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const colour =
    tone ||
    (pct >= 100 ? 'bg-success' : pct >= 60 ? 'bg-brand-500' : pct >= 30 ? 'bg-warning' : 'bg-destructive');
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div
        className={cn('h-full rounded-full transition-all', colour)}
        style={{ width: `${pct}%` }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action availability
// ---------------------------------------------------------------------------

/** Visits a user may act on, given the row status and permission checks. */
export const visitActionsFor = (visit, can) => {
  if (!visit) return [];
  const status = visit.status;
  const out = [];
  const manage = can('fieldforce.visits.manage');

  if (manage && status === 'PLANNED') out.push('checkIn', 'skip', 'cancel');
  if (manage && status === 'IN_PROGRESS') out.push('checkOut', 'cancel');
  return out;
};

/** Expense workflow moves available for a claim. */
export const expenseActionsFor = (expense, can) => {
  if (!expense) return [];
  const status = expense.status;
  const out = [];
  const manage = can('fieldforce.expenses.manage');
  const approve = can('fieldforce.expenses.approve');

  if (manage && status === 'DRAFT') out.push('submit', 'edit');
  if (manage && status === 'REJECTED') out.push('submit', 'edit');
  if (approve && status === 'SUBMITTED') out.push('approve', 'reject');
  if (approve && status === 'APPROVED') out.push('pay');
  if (approve && status === 'PAID') out.push('reopen');
  return out;
};

// ---------------------------------------------------------------------------
// Generic workflow dialog
// ---------------------------------------------------------------------------

/**
 * Configurable POST dialog used by every Phase 7 workflow transition.
 *
 * `fields` describes the form controls; each entry is
 * `{ name, label, type, required, placeholder, options, hint }`. `type` is one
 * of `text | textarea | number | select`. The POST body is built from the
 * collected values (empty strings omitted).
 */
function WorkflowDialog({
  open,
  onClose,
  onDone,
  endpoint,
  title,
  description,
  subject,
  confirmLabel = 'Confirm',
  tone = 'default',
  fields = [],
  errorTitle = 'Could not update',
  invalidateKeys = [],
  prepareBody,
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({});

  const reset = () => setValues({});

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {};
      fields.forEach((f) => {
        const raw = values[f.name];
        if (raw === undefined || raw === null || raw === '') return;
        body[f.name] = f.type === 'number' ? Number(raw) : raw;
      });
      // prepareBody may be async (it reads GPS) - wait for it.
      const payload = prepareBody ? await prepareBody(body, values) : body;
      const { data } = await api.post(endpoint, payload);
      return data;
    },
    onSuccess: (payload) => {
      toast.success(payload?.message || 'Updated');
      invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      reset();
      onDone?.(payload?.data);
      onClose?.();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const err = mutation.error ? apiError(mutation.error) : null;

  const invalid = fields.some((f) => {
    if (!f.required) return false;
    const raw = values[f.name];
    if (f.type === 'number') return raw === undefined || raw === '' || Number.isNaN(Number(raw));
    return !raw || String(raw).trim().length < (f.minLength || 1);
  });

  const set = (name, v) => setValues((prev) => ({ ...prev, [name]: v }));

  const renderField = (f) => {
    const common = {
      value: values[f.name] ?? '',
      onChange: (e) => set(f.name, e.target.value),
      placeholder: f.placeholder,
      autoFocus: f.autoFocus,
    };

    if (f.type === 'textarea') return <Textarea {...common} rows={f.rows || 3} />;
    if (f.type === 'select') {
      return (
        <Select {...common}>
          {(f.options || []).map((opt) => {
            const value = typeof opt === 'string' ? opt : opt.value;
            const label = typeof opt === 'string' ? titleCase(value.replace(/_/g, ' ')) : opt.label;
            return (
              <option key={value || 'none'} value={value}>
                {label}
              </option>
            );
          })}
        </Select>
      );
    }
    if (f.type === 'number') return <Input {...common} type="number" min={f.min} step={f.step} />;
    return <Input {...common} type="text" />;
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose?.();
      }}
      title={title}
      description={subject || description}
      size="sm"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onClose?.();
            }}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            onClick={() => mutation.mutate()}
            disabled={invalid}
            loading={mutation.isPending}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {fields.map((f) => (
          <Field key={f.name} label={f.label} required={f.required} hint={f.hint}>
            {renderField(f)}
          </Field>
        ))}
        {err && <ErrorAlert title={errorTitle} message={err.message} errors={err.errors} />}
      </div>
    </Dialog>
  );
}

/**
 * Check out of a visit. The server works out the outcome from what was booked
 * since check-in (invoice / order / payment). Only when nothing was booked
 * does it answer NO_ORDER_REASON_REQUIRED - then we ask why.
 */
function CheckOutDialog({ visit, onClose, onDone }) {
  const queryClient = useQueryClient();
  const [needReason, setNeedReason] = useState(false);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {};
      if (needReason) body.noOrderReason = reason;
      if (notes.trim()) body.notes = notes.trim();
      const gps = await captureGps();
      if (gps) body.location = { lat: gps.lat, lng: gps.lng };
      return (await api.post(`/v1/field-force/visits/${visit.id}/check-out`, body)).data;
    },
    onSuccess: (payload) => {
      toast.success(payload?.message || 'Checked out');
      [['company', 'visits'], ['company', 'beat'], ['company', 'targets']].forEach((k) => queryClient.invalidateQueries({ queryKey: k }));
      onDone?.(payload?.data);
      onClose?.();
    },
    onError: (err) => {
      if (err?.response?.data?.code === 'NO_ORDER_REASON_REQUIRED') setNeedReason(true);
    },
  });

  const err = mutation.error ? apiError(mutation.error) : null;
  const showErr = err && err.code !== 'NO_ORDER_REASON_REQUIRED' && mutation.error?.response?.data?.code !== 'NO_ORDER_REASON_REQUIRED';
  const invalid = needReason && (!reason || (reason === 'OTHER' && !notes.trim()));

  return (
    <Dialog
      open
      onClose={onClose}
      title={needReason ? 'No order - why?' : 'Check out'}
      description={`${visit.visitNo || 'Visit'} · ${visit.customerName || ''}`}
      size="sm"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={invalid} loading={mutation.isPending}>
            Check out
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {needReason ? (
          <>
            <p className="rounded-lg bg-warning/15 p-3 text-sm">No order, invoice or payment was booked at this customer. Tell us why.</p>
            <Field label="Reason" required>
              <Select value={reason} onChange={(e) => setReason(e.target.value)} autoFocus aria-label="No order reason">
                <option value="">Choose a reason…</option>
                {NO_ORDER_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">The outcome is taken from the order, invoice or payment you booked here.</p>
        )}
        <Field label={reason === 'OTHER' ? 'Notes' : 'Notes (optional)'} required={reason === 'OTHER'}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {showErr && <ErrorAlert title="Could not check out" message={err.message} errors={err.errors} />}
      </div>
    </Dialog>
  );
}

export { WorkflowDialog, CheckOutDialog };
export default WorkflowDialog;
