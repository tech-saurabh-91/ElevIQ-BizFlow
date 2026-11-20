import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock, Pencil, Plus, Save, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { apiError } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { ErrorAlert } from '@/components/ui/alert';
import { Field, Input, Select } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/store/authStore';
import { ADMIN_ONLY_PERMISSIONS, groupPermissions, isSensitivePermission, moduleLabel, permissionLabel } from '@/utils/permissionLabels';
import { EffectSwitch, SCOPE_LABEL } from '@/components/company/user-access';

/**
 * Access profiles: a named set of Allow / Deny, data scope and limits given to
 * several users at once ("Senior presales"). Changing a profile changes
 * everyone on it; a user's own Allow / Deny still win.
 */

const KEY = ['company', 'access-profiles'];
const blank = { name: '', description: '', isActive: true, dataScope: '', maxDiscountPercent: '', maxApproveAmount: '', overrides: {} };
const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

function ProfileEditor({ initial, onDone }) {
  const queryClient = useQueryClient();
  const keys = Object.keys(useAuthStore((st) => st.permissions) || {}).filter((k) => k !== 'reports.hub.view');
  const [form, setForm] = useState(() =>
    initial
      ? {
          name: initial.name,
          description: initial.description,
          isActive: initial.isActive,
          dataScope: initial.dataScope,
          maxDiscountPercent: initial.limits.maxDiscountPercent ?? '',
          maxApproveAmount: initial.limits.maxApproveAmount ?? '',
          overrides: Object.fromEntries(initial.overrides.map((o) => [o.permission, o.effect])),
        }
      : blank
  );
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setEffect = (k, v) =>
    setForm((f) => {
      const overrides = { ...f.overrides };
      if (v) overrides[k] = v;
      else delete overrides[k];
      return { ...f, overrides };
    });

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groupPermissions(keys.filter((k) => !q || `${moduleLabel(k.split('.')[0])} ${permissionLabel(k)} ${k}`.toLowerCase().includes(q)));
    // keys is derived from the store on every render; the list only changes with the search.
    // eslint-disable-next-line
  }, [search, keys.length]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        description: form.description.trim(),
        isActive: form.isActive,
        dataScope: form.dataScope,
        limits: { maxDiscountPercent: numOrNull(form.maxDiscountPercent), maxApproveAmount: numOrNull(form.maxApproveAmount) },
        overrides: Object.entries(form.overrides).map(([permission, effect]) => ({ permission, effect })),
      };
      return (initial ? await api.patch(`/v1/access-profiles/${initial.id}`, body) : await api.post('/v1/access-profiles', body)).data;
    },
    onSuccess: (res) => {
      toast.success(res?.message || 'Saved');
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: ['company', 'users'] });
      onDone();
    },
    onError: (err) => {
      setConfirm(null);
      const e = apiError(err);
      setError([e.message, ...(e.errors || []).map((x) => x.message)].filter(Boolean).join(' · '));
    },
  });

  const trySave = () => {
    setError('');
    if (form.name.trim().length < 2) return setError('Give the profile a name');
    const sensitive = Object.entries(form.overrides)
      .filter(([k, v]) => v === 'ALLOW' && isSensitivePermission(k) && initial?.overrides.find((o) => o.permission === k)?.effect !== 'ALLOW')
      .map(([k]) => `${moduleLabel(k.split('.')[0])} · ${permissionLabel(k)}`);
    if (form.dataScope === 'ALL' && initial?.dataScope !== 'ALL') sensitive.push('see the whole company’s records');
    if (sensitive.length || (initial && initial.userCount > 0)) return setConfirm(sensitive);
    return save.mutate();
  };

  const count = Object.keys(form.overrides).length;

  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={onDone}>
        <ArrowLeft className="h-4 w-4" /> All profiles
      </Button>
      {error && <ErrorAlert title="Could not save the profile" message={error} onClose={() => setError('')} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={60} placeholder="Senior presales" />
        </Field>
        <Field label="Description">
          <Input value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={200} placeholder="What it is for" />
        </Field>
        <Field label="Whose records they see">
          <Select value={form.dataScope} onChange={(e) => set('dataScope', e.target.value)}>
            <option value="">Leave as each user / role</option>
            <option value="OWN">{SCOPE_LABEL.OWN}</option>
            <option value="TEAM">{SCOPE_LABEL.TEAM}</option>
            <option value="ALL">{SCOPE_LABEL.ALL}</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max discount by hand (%)">
            <Input type="number" min="0" max="100" step="0.5" value={form.maxDiscountPercent} onChange={(e) => set('maxDiscountPercent', e.target.value)} placeholder="No limit" />
          </Field>
          <Field label="Approve up to">
            <Input type="number" min="0" value={form.maxApproveAmount} onChange={(e) => set('maxApproveAmount', e.target.value)} placeholder="No limit" />
          </Field>
        </div>
      </div>
      <Checkbox checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} label="Profile is on (switched off, it counts for nobody)" />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a permission…" className="h-9 pl-8" aria-label="Search a permission" />
        </div>
        <span className="text-xs text-muted-foreground">
          {count} Allow / Deny · the rest follows each user&apos;s role
        </span>
      </div>
      <div className="max-h-[45vh] overflow-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {Object.entries(groups).flatMap(([module, list]) => [
              <tr key={`g-${module}`} className="border-b bg-muted/40">
                <td colSpan={2} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide">
                  {moduleLabel(module)}
                </td>
              </tr>,
              ...list.map((k) => {
                const adminOnly = ADMIN_ONLY_PERMISSIONS.includes(k);
                return (
                  <tr key={k} className="border-b last:border-0">
                    <td className="px-3 py-1.5" title={k}>
                      {permissionLabel(k)}
                      {isSensitivePermission(k) && (
                        <Badge tone="warning" className="ml-1.5 px-1.5 py-0 text-[10px]">
                          Sensitive
                        </Badge>
                      )}
                      {adminOnly && (
                        <Badge tone="muted" className="ml-1.5 px-1.5 py-0 text-[10px]">
                          <Lock className="mr-0.5 inline h-3 w-3" />
                          Admins only
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <EffectSwitch
                        value={form.overrides[k] || ''}
                        onChange={(v) => setEffect(k, v)}
                        allowDisabled={adminOnly}
                        label={`${moduleLabel(module)}: ${permissionLabel(k)}`}
                        neutralLabel="—"
                      />
                    </td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <Button onClick={trySave} loading={save.isPending}>
          <Save className="h-4 w-4" /> {initial ? 'Save profile' : 'Create profile'}
        </Button>
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => save.mutate()}
        title="Save this profile?"
        message={[
          initial?.userCount ? `It applies at once to the ${initial.userCount} user${initial.userCount === 1 ? '' : 's'} on it.` : '',
          confirm?.length ? `It gives: ${confirm.join(', ')}.` : '',
          'It is recorded in the audit trail.',
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel="Yes, save"
        tone={confirm?.length ? 'destructive' : 'default'}
        loading={save.isPending}
      />
    </div>
  );
}

export function AccessProfilesDialog({ open, onClose }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null); // null = list, 'new', or a profile
  const [removing, setRemoving] = useState(null);
  const { data: profiles = [], isLoading } = useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get('/v1/access-profiles')).data?.data || [],
    enabled: open,
  });
  const remove = useMutation({
    mutationFn: async (p) => (await api.delete(`/v1/access-profiles/${p.id}`)).data,
    onSuccess: () => {
      toast.success('Profile deleted');
      setRemoving(null);
      queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (err) => {
      setRemoving(null);
      toast.error(apiError(err).message);
    },
  });

  const close = () => {
    setEditing(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="xl"
      title={editing === 'new' ? 'New access profile' : editing ? `Access profile · ${editing.name}` : 'Access profiles'}
      description="A shared set of access for several users. Give it to a user under Access; change it here and it changes for all of them."
    >
      {editing ? (
        <ProfileEditor initial={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      ) : isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> New profile
            </Button>
          </div>
          {profiles.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No profiles yet. Example: “Senior presales” with Customers · Create allowed and a 5% discount limit.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {profiles.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {p.name}
                      {!p.isActive && (
                        <Badge tone="muted" className="ml-1.5">
                          Off
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        p.description,
                        `${p.overrides.length} Allow / Deny`,
                        p.dataScope ? SCOPE_LABEL[p.dataScope] : '',
                        p.limits.maxDiscountPercent !== null ? `discount ≤ ${p.limits.maxDiscountPercent}%` : '',
                        p.limits.maxApproveAmount !== null ? `approve ≤ ${p.limits.maxApproveAmount}` : '',
                        `${p.userCount} user${p.userCount === 1 ? '' : 's'}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                      <Pencil className="h-4 w-4" /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(p)} aria-label={`Delete ${p.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => remove.mutate(removing)}
        title="Delete this profile?"
        message={removing?.userCount ? `${removing.userCount} user(s) are on it: move them to another profile first.` : `“${removing?.name}” will be deleted.`}
        confirmLabel="Delete"
        tone="destructive"
        loading={remove.isPending}
      />
    </Dialog>
  );
}

export default AccessProfilesDialog;
