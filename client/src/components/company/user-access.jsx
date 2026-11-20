import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Lock, RotateCcw, Save, Search, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { apiError } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { ErrorAlert } from '@/components/ui/alert';
import { Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/utils/format';
import { cn } from '@/utils/cn';
import { groupPermissions, moduleLabel, permissionLabel } from '@/utils/permissionLabels';
import { salesTypeAllows, salesTypeLabel } from '@/utils/salesType';

/**
 * A user's own access over their role (company admin only):
 * - Role: what the role gives (Company settings -> Permissions).
 * - Allow: this user may, even if the role may not.
 * - Deny: this user may not, even if the role may.
 * Allow / Deny can end on a date (cover for leave, a short project).
 */

const ROLE_LABEL = { COMPANY_ADMIN: 'Company admin', MANAGER: 'Manager', SALESMAN: 'Salesman', ACCOUNTANT: 'Accountant', WAREHOUSE: 'Warehouse' };
const SOURCE_LABEL = {
  ADMIN: 'Company admin',
  ROLE: 'From role',
  USER_ALLOW: 'Allowed for this user',
  USER_DENY: 'Denied for this user',
  PROFILE_ALLOW: 'Allowed by profile',
  PROFILE_DENY: 'Denied by profile',
  SALES_TYPE: 'Blocked by sales type',
  UNKNOWN: 'Unknown',
};
export const SCOPE_LABEL = { OWN: 'Own records', TEAM: 'Own + team', ALL: 'Whole company' };
const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const extrasFrom = (view) => ({
  profileId: view?.profile?.id || '',
  dataScope: view?.dataScope?.own || '',
  maxDiscountPercent: view?.limits?.own?.maxDiscountPercent ?? '',
  maxApproveAmount: view?.limits?.own?.maxApproveAmount ?? '',
});
const today = () => new Date().toISOString().slice(0, 10);
const dayInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
/** End of the chosen day, local time. */
const endOfDay = (s) => (s ? new Date(`${s}T23:59:59`).toISOString() : null);

/** { key: { effect, until: 'YYYY-MM-DD' | '', note } } from the server's view (lapsed ones dropped). */
const editableFrom = (view) =>
  Object.fromEntries(
    (view?.permissions || [])
      .filter((p) => p.override && !p.override.lapsed)
      .map((p) => [p.key, { effect: p.override.effect, until: dayInput(p.override.until), note: p.override.note || '' }])
  );

export function EffectSwitch({ value, onChange, allowDisabled, label, neutralLabel = 'Role' }) {
  const options = [
    ['', neutralLabel],
    ['ALLOW', 'Allow'],
    ['DENY', 'Deny'],
  ];
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border bg-muted/40 p-0.5 text-xs">
      {options.map(([v, text]) => {
        const disabled = v === 'ALLOW' && allowDisabled;
        const active = value === v;
        return (
          <button
            key={text}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={disabled ? 'Stays with company admins' : undefined}
            onClick={() => onChange(v)}
            className={cn(
              'rounded px-2.5 py-1 font-medium transition-colors focus-ring disabled:cursor-not-allowed disabled:opacity-40',
              active && v === '' && 'bg-card text-foreground shadow-sm',
              active && v === 'ALLOW' && 'bg-success text-white shadow-sm',
              active && v === 'DENY' && 'bg-destructive text-white shadow-sm',
              !active && 'text-muted-foreground hover:text-foreground'
            )}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

export function UserAccessDialog({ target, onClose }) {
  const queryClient = useQueryClient();
  const key = ['company', 'users', 'access', target?.id];
  const { data: view, isLoading, error: loadError } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get(`/v1/users/${target.id}/access`)).data?.data,
    enabled: Boolean(target?.id),
  });
  const [edits, setEdits] = useState({});
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState('all');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [copyFrom, setCopyFrom] = useState('');
  const [discard, setDiscard] = useState(false);
  const [extras, setExtras] = useState(extrasFrom(null));
  const setExtra = (k, v) => {
    setExtras((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  };
  // Closing with changes not saved asks first.
  const requestClose = () => (dirty ? setDiscard(true) : onClose());

  useEffect(() => {
    if (view) {
      setEdits(editableFrom(view));
      setExtras(extrasFrom(view));
      setDirty(false);
    }
  }, [view]);

  const { data: others = [] } = useQuery({
    queryKey: ['company', 'users', 'copy-sources'],
    queryFn: async () => (await api.get('/v1/users', { params: { limit: 200, isActive: true, sort: 'name' } })).data?.data || [],
    enabled: Boolean(target?.id),
  });
  const sources = others.filter((u) => u.id !== target?.id && u.role !== 'COMPANY_ADMIN');
  const { data: profiles = [] } = useQuery({
    queryKey: ['company', 'access-profiles'],
    queryFn: async () => (await api.get('/v1/access-profiles')).data?.data || [],
    enabled: Boolean(target?.id),
  });
  const profile = profiles.find((p) => p.id === extras.profileId) || null;
  const profileEffectOf = (key) => (profile && profile.isActive ? profile.overrides.find((o) => o.permission === key)?.effect || null : null);

  const byKey = useMemo(() => Object.fromEntries((view?.permissions || []).map((p) => [p.key, p])), [view]);
  const user = view?.user;

  /** What this user ends up with for a permission, given the current edits. */
  const resultOf = (p) => {
    const e = edits[p.key];
    if (user?.role === 'SALESMAN' && p.channel && !salesTypeAllows(user.salesType, p.channel)) return { allowed: false, source: 'SALES_TYPE' };
    if (e?.effect === 'ALLOW') return { allowed: true, source: 'USER_ALLOW' };
    if (e?.effect === 'DENY') return { allowed: false, source: 'USER_DENY' };
    const pe = profileEffectOf(p.key);
    if (pe) return { allowed: pe === 'ALLOW', source: pe === 'ALLOW' ? 'PROFILE_ALLOW' : 'PROFILE_DENY' };
    return { allowed: p.roleAllowed, source: 'ROLE' };
  };

  const setEffect = (permission, effect) => {
    setEdits((prev) => {
      const next = { ...prev };
      if (!effect) delete next[permission];
      else next[permission] = { until: '', note: '', ...prev[permission], effect };
      return next;
    });
    setDirty(true);
  };
  const setUntil = (permission, until) => {
    setEdits((prev) => ({ ...prev, [permission]: { ...prev[permission], until } }));
    setDirty(true);
  };

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const keys = (view?.permissions || [])
      .filter((p) => {
        if (q && !`${moduleLabel(p.key.split('.')[0])} ${permissionLabel(p.key)} ${p.key}`.toLowerCase().includes(q)) return false;
        if (show === 'custom') return Boolean(edits[p.key]) || Boolean(profileEffectOf(p.key));
        if (show === 'allowed') return resultOf(p).allowed;
        if (show === 'blocked') return !resultOf(p).allowed;
        return true;
      })
      .map((p) => p.key);
    return groupPermissions(keys);
  }, [view, search, show, edits, profile]);

  const copyAccess = async (fromId) => {
    setCopyFrom(fromId);
    if (!fromId) return;
    try {
      const source = (await api.get(`/v1/users/${fromId}/access`)).data?.data;
      const next = {};
      source.permissions.forEach((sp) => {
        const mine = byKey[sp.key];
        if (!mine) return;
        if (sp.allowed === mine.roleAllowed) return;
        if (sp.allowed && mine.adminOnly) return;
        next[sp.key] = { effect: sp.allowed ? 'ALLOW' : 'DENY', until: '', note: `Same as ${source.user.name}` };
      });
      setEdits(next);
      setDirty(true);
      toast.success(`Access copied from ${source.user.name}. Check it and save.`);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  const overridesPayload = () =>
    Object.entries(edits).map(([permission, e]) => ({ permission, effect: e.effect, until: endOfDay(e.until), note: e.note || undefined }));

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.put(`/v1/users/${target.id}/access`, {
          overrides: overridesPayload(),
          profileId: extras.profileId || null,
          dataScope: extras.dataScope,
          limits: { maxDiscountPercent: numOrNull(extras.maxDiscountPercent), maxApproveAmount: numOrNull(extras.maxApproveAmount) },
        })
      ).data,
    onSuccess: (res) => {
      toast.success(res?.message || 'Access saved');
      queryClient.setQueryData(key, res?.data);
      queryClient.invalidateQueries({ queryKey: ['company', 'users'] });
      setDirty(false);
      setConfirm(null);
    },
    onError: (err) => {
      setConfirm(null);
      const e = apiError(err);
      setError([e.message, ...(e.errors || []).map((x) => x.message)].filter(Boolean).join(' · '));
    },
  });

  const trySave = () => {
    setError('');
    const newlySensitive = Object.entries(edits)
      .filter(([k, e]) => e.effect === 'ALLOW' && byKey[k]?.sensitive && !byKey[k]?.roleAllowed)
      .filter(([k, e]) => !(byKey[k]?.override?.effect === 'ALLOW' && dayInput(byKey[k]?.override?.until) === e.until));
    const lines = newlySensitive.map(([k]) => `${moduleLabel(k.split('.')[0])} · ${permissionLabel(k)}`);
    // Seeing the whole company's records is a big step for a salesman or manager.
    if (extras.dataScope === 'ALL' && view?.dataScope?.own !== 'ALL' && view?.dataScope?.roleDefault !== 'ALL') lines.push('see the whole company’s records');
    if (lines.length) setConfirm(lines);
    else save.mutate();
  };

  const customCount = Object.keys(edits).length;
  const lapsed = (view?.permissions || []).filter((p) => p.override?.lapsed);

  return (
    <Dialog
      open={Boolean(target)}
      onClose={requestClose}
      size="xl"
      title={`Access · ${target?.name || ''}`}
      description="By default a user can do what their role can. Allow gives this user more; Deny takes something away from this user only."
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => {
              setEdits({});
              setExtras({ profileId: '', dataScope: '', maxDiscountPercent: '', maxApproveAmount: '' });
              setDirty(true);
              setCopyFrom('');
            }}
            disabled={(!customCount && !extras.profileId && !extras.dataScope && extras.maxDiscountPercent === '' && extras.maxApproveAmount === '') || save.isPending}
          >
            <RotateCcw className="h-4 w-4" /> Reset to role
          </Button>
          <Button onClick={trySave} disabled={!dirty} loading={save.isPending}>
            <Save className="h-4 w-4" /> Save access
          </Button>
        </>
      }
    >
      {isLoading || !view ? (
        loadError ? <ErrorAlert title="Could not load access" message={apiError(loadError).message} /> : <Skeleton className="h-64 w-full" />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="info">{ROLE_LABEL[user.role] || user.role}</Badge>
            {user.role === 'SALESMAN' && <Badge tone="muted">{salesTypeLabel(user.salesType)}</Badge>}
            <span className="text-muted-foreground">
              {customCount ? `${customCount} own setting${customCount === 1 ? '' : 's'}` : 'No own settings'}
              {profile ? ` · profile “${profile.name}”${profile.isActive ? '' : ' (switched off)'}` : ''}
            </span>
            {dirty && <span className="text-xs font-medium text-warning">Not saved yet</span>}
          </div>

          {error && <ErrorAlert title="Could not save access" message={error} onClose={() => setError('')} />}
          {lapsed.length > 0 && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Ended:{' '}
              {lapsed.map((p) => `${permissionLabel(p.key)} (${moduleLabel(p.key.split('.')[0])}) on ${formatDate(p.override.until)}`).join('; ')}. These
              now follow the role.
            </p>
          )}

          <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-foreground">Access profile</span>
              <Select aria-label="Access profile" className="h-9" value={extras.profileId} onChange={(e) => setExtra('profileId', e.target.value)}>
                <option value="">No profile</option>
                {profiles
                  .filter((p) => p.isActive || p.id === extras.profileId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isActive ? '' : ' (off)'}
                    </option>
                  ))}
              </Select>
              <span className="block text-muted-foreground">A shared set of access. This user&apos;s own Allow / Deny still win.</span>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-foreground">Whose records they see</span>
              <Select aria-label="Whose records they see" className="h-9" value={extras.dataScope} onChange={(e) => setExtra('dataScope', e.target.value)}>
                <option value="">
                  {profile?.isActive && profile.dataScope ? `From profile (${SCOPE_LABEL[profile.dataScope]})` : `By role (${SCOPE_LABEL[view.dataScope.roleDefault]})`}
                </option>
                <option value="OWN">Own records only</option>
                <option value="TEAM">Own + their team</option>
                <option value="ALL">Whole company</option>
              </Select>
              <span className="block text-muted-foreground">
                {(extras.dataScope || (profile?.isActive && profile.dataScope) || view.dataScope.roleDefault) === 'TEAM' && !view.hasTeam
                  ? 'Nobody reports to this user yet: set "Reports to" on their team members.'
                  : 'Orders, invoices, receipts, customers, visits, expenses and reports.'}
              </span>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-foreground">Max discount by hand (%)</span>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.5"
                className="h-9"
                value={extras.maxDiscountPercent}
                onChange={(e) => setExtra('maxDiscountPercent', e.target.value)}
                placeholder={profile?.isActive && profile.limits.maxDiscountPercent !== null ? `Profile: ${profile.limits.maxDiscountPercent}%` : 'No limit'}
                aria-label="Max discount by hand (%)"
              />
              <span className="block text-muted-foreground">Typed discount or price cut below the price list, per line.</span>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-foreground">Approve up to (amount)</span>
              <Input
                type="number"
                min="0"
                step="1"
                className="h-9"
                value={extras.maxApproveAmount}
                onChange={(e) => setExtra('maxApproveAmount', e.target.value)}
                placeholder={profile?.isActive && profile.limits.maxApproveAmount !== null ? `Profile: ${profile.limits.maxApproveAmount}` : 'No limit'}
                aria-label="Approve up to (amount)"
              />
              <span className="block text-muted-foreground">Largest order or expense they may approve.</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a permission…" className="h-9 pl-8" aria-label="Search a permission" />
            </div>
            <Select aria-label="Show" className="h-9 w-auto" value={show} onChange={(e) => setShow(e.target.value)}>
              <option value="all">All permissions</option>
              <option value="custom">Different from role</option>
              <option value="allowed">Can do</option>
              <option value="blocked">Cannot do</option>
            </Select>
            <Select aria-label="Copy access from" className="h-9 w-auto max-w-[14rem]" value={copyFrom} onChange={(e) => copyAccess(e.target.value)}>
              <option value="">Copy access from…</option>
              {sources.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({ROLE_LABEL[u.role] || u.role})
                </option>
              ))}
            </Select>
          </div>

          <div className="max-h-[55vh] overflow-auto rounded-lg border">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Permission</th>
                  <th className="px-2 py-2 text-center font-semibold">Role</th>
                  <th className="px-2 py-2 text-center font-semibold">Profile</th>
                  <th className="px-2 py-2 font-semibold">This user</th>
                  <th className="px-2 py-2 font-semibold">Until</th>
                  <th className="px-3 py-2 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(groups).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      Nothing matches.
                    </td>
                  </tr>
                )}
                {Object.entries(groups).flatMap(([module, keys]) => [
                  <tr key={`g-${module}`} className="border-b bg-muted/40">
                    <td colSpan={6} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide">
                      {moduleLabel(module)}
                    </td>
                  </tr>,
                  ...keys.map((k) => {
                    const p = byKey[k];
                    const e = edits[k];
                    const r = resultOf(p);
                    return (
                      <tr key={k} className={cn('border-b last:border-0', e && 'bg-brand-500/5')}>
                        <td className="px-3 py-1.5" title={k}>
                          <span>{permissionLabel(k)}</span>
                          {p.sensitive && (
                            <Badge tone="warning" className="ml-1.5 px-1.5 py-0 text-[10px]">
                              Sensitive
                            </Badge>
                          )}
                          {p.adminOnly && (
                            <Badge tone="muted" className="ml-1.5 px-1.5 py-0 text-[10px]">
                              <Lock className="mr-0.5 inline h-3 w-3" />
                              Admins only
                            </Badge>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-center text-xs">
                          {p.roleAllowed ? <span className="text-success">Yes</span> : <span className="text-muted-foreground">No</span>}
                        </td>
                        <td className="px-2 py-1.5 text-center text-xs">
                          {profileEffectOf(k) === 'ALLOW' ? (
                            <span className="text-success">Allow</span>
                          ) : profileEffectOf(k) === 'DENY' ? (
                            <span className="text-destructive">Deny</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <EffectSwitch
                            value={e?.effect || ''}
                            onChange={(v) => setEffect(k, v)}
                            allowDisabled={p.adminOnly}
                            label={`${moduleLabel(module)}: ${permissionLabel(k)}`}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          {e ? (
                            <Input
                              type="date"
                              className="h-8 w-[9.5rem] text-xs"
                              min={today()}
                              value={e.until || ''}
                              onChange={(ev) => setUntil(k, ev.target.value)}
                              aria-label={`End date for ${permissionLabel(k)}`}
                              title="Leave empty to keep it until you change it"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-xs">
                          <span className={cn('font-medium', r.allowed ? 'text-success' : 'text-muted-foreground')}>{r.allowed ? 'Can' : 'Cannot'}</span>
                          <span className="ml-1 text-muted-foreground">· {SOURCE_LABEL[r.source]}</span>
                        </td>
                      </tr>
                    );
                  }),
                ])}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            A Presale / Van sale salesman stays limited by their sales type: change it in the user&apos;s details. Changes apply at once; the user sees
            them the next time their screen refreshes.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => save.mutate()}
        title="Give sensitive access?"
        message={
          confirm
            ? `${target?.name} will be able to: ${confirm.join(', ')}. Their role does not have this. It is recorded in the audit trail.`
            : ''
        }
        confirmLabel="Yes, save"
        tone="destructive"
        loading={save.isPending}
      />
      <ConfirmDialog
        open={discard}
        onClose={() => setDiscard(false)}
        onConfirm={() => {
          setDiscard(false);
          onClose();
        }}
        title="Close without saving?"
        message="Your changes to this user's access are not saved yet. They will be lost."
        confirmLabel="Close without saving"
        tone="destructive"
      />
    </Dialog>
  );
}

/** Pick a permission and see every active user who can do it, and why. */
export function WhoCanDialog({ open, onClose, catalog }) {
  const [permission, setPermission] = useState('invoices.print');
  const { data, isLoading } = useQuery({
    queryKey: ['company', 'users', 'who-can', permission],
    queryFn: async () => (await api.get('/v1/users/access/who', { params: { permission } })).data?.data,
    enabled: open && Boolean(permission),
  });
  const groups = useMemo(() => groupPermissions(catalog || []), [catalog]);
  const users = data?.users || [];
  const can = users.filter((u) => u.allowed);
  const cannot = users.filter((u) => !u.allowed);

  const row = (u) => (
    <li key={u.id} className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-0">
      <div className="min-w-0">
        <p className="truncate font-medium">{u.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {ROLE_LABEL[u.role] || u.role}
          {u.role === 'SALESMAN' ? ` · ${salesTypeLabel(u.salesType)}` : ''}
          {u.profile ? ` · ${u.profile}` : ''}
        </p>
      </div>
      <span className="shrink-0 text-right text-xs text-muted-foreground">
        {SOURCE_LABEL[u.source]}
        {u.until ? ` · until ${formatDate(u.until)}` : ''}
      </span>
    </li>
  );

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Who can do what" description="Every active user who can, or cannot, do one thing, and why.">
      <div className="space-y-3">
        <Select aria-label="Permission" value={permission} onChange={(e) => setPermission(e.target.value)}>
          {Object.entries(groups).map(([module, keys]) => (
            <optgroup key={module} label={moduleLabel(module)}>
              {keys.map((k) => (
                <option key={k} value={k}>
                  {moduleLabel(module)} · {permissionLabel(k)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {data?.sensitive && (
          <p className="flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> Sensitive permission
          </p>
        )}
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border">
              <p className="flex items-center gap-1.5 border-b bg-success/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-success">
                <ShieldCheck className="h-3.5 w-3.5" /> Can ({can.length})
              </p>
              <ul className="max-h-[45vh] overflow-auto text-sm">{can.length ? can.map(row) : <li className="px-3 py-3 text-muted-foreground">Nobody</li>}</ul>
            </div>
            <div className="rounded-lg border">
              <p className="border-b bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cannot ({cannot.length})</p>
              <ul className="max-h-[45vh] overflow-auto text-sm">{cannot.length ? cannot.map(row) : <li className="px-3 py-3 text-muted-foreground">Nobody</li>}</ul>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
