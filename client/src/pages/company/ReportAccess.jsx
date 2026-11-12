import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Lock, RotateCcw, Save, Undo2 } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorAlert } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/ui/dialog';
import { cn } from '@/utils/cn';

/**
 * Report-wise access (admin): tick which role may open each report. A report
 * with no ticks of its own follows the role's report-group permission. A box
 * is locked when the role lacks the data the report shows (e.g. costs).
 */

const ROLE_LABEL = { MANAGER: 'Manager', ACCOUNTANT: 'Accountant', WAREHOUSE: 'Warehouse', SALESMAN: 'Salesman' };
const PERM_LABEL = (p) =>
  ({
    'products.cost.view': 'Cost & margin view',
    'bills.view': 'Supplier bills view',
    'supplierpayments.view': 'Supplier payments view',
    'purchasereturns.view': 'Purchase returns view',
    'grn.view': 'Goods receipts view',
    'inventory.view': 'Inventory view',
    'invoices.view': 'Invoices view',
    'creditnotes.view': 'Credit notes view',
    'payments.view': 'Payments view',
    'orders.view': 'Orders view',
    'customers.view': 'Customers view',
    'products.view': 'Products view',
    'fieldforce.targets.view': 'Targets view',
  })[p] || p;
const GROUP_HEAD = {
  REGISTER: 'from-sky-600 to-blue-500',
  MIS: 'from-cyan-600 to-teal-500',
  LISTING: 'from-teal-600 to-emerald-500',
};

export default function ReportAccess() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({}); // code -> { ROLE: bool }
  const [error, setError] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['company', 'reports-hub', 'access'],
    queryFn: async () => (await api.get('/v1/reports/hub/access')).data?.data,
  });
  useEffect(() => setDraft({}), [data]);

  const roles = data?.roles || [];
  const ticked = (r, role) => (draft[r.code]?.[role] !== undefined ? draft[r.code][role] : r.roles[role].allowed);
  const changed = useMemo(
    () => (data?.reports || []).filter((r) => roles.some((role) => draft[r.code]?.[role] !== undefined && draft[r.code][role] !== r.roles[role].allowed)),
    [data, draft, roles]
  );

  const done = (res, msg) => {
    toast.success(msg);
    queryClient.setQueryData(['company', 'reports-hub', 'access'], res.data?.data);
    queryClient.invalidateQueries({ queryKey: ['company', 'reports-hub', 'catalog'] });
  };
  const save = useMutation({
    mutationFn: (access) => api.put('/v1/reports/hub/access', { access }),
    onSuccess: (res) => done(res, 'Report access saved'),
    onError: (err) => setError(apiError(err)),
  });
  const reset = useMutation({
    mutationFn: () => api.post('/v1/reports/hub/access/reset'),
    onSuccess: (res) => {
      setConfirmReset(false);
      done(res, 'Back to role permissions');
    },
    onError: (err) => setError(apiError(err)),
  });

  const saveAll = () =>
    save.mutate(Object.fromEntries(changed.map((r) => [r.code, roles.filter((role) => ticked(r, role) && !r.roles[role].missing.length)])));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Report Access"
        description="Choose which role can open each report. Admins always see every report."
        breadcrumbs={[{ label: 'Reports', to: '/app/reports' }, { label: 'Access' }]}
        actions={
          <>
            <Button variant="outline" onClick={() => setConfirmReset(true)}>
              <RotateCcw className="h-4 w-4" /> Reset all
            </Button>
            <Button onClick={saveAll} disabled={!changed.length} loading={save.isPending}>
              <Save className="h-4 w-4" /> Save{changed.length ? ` ${changed.length}` : ''}
            </Button>
          </>
        }
      />

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        A locked box means the role cannot see that report&apos;s data (for example costs or supplier bills) - give it that
        permission in Settings → Permissions first. Reports marked “Custom” use your ticks; the rest follow the role&apos;s report
        group permission.
      </p>

      {error && <ErrorAlert title="Could not save" message={error.message} onClose={() => setError(null)} />}

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        (data?.groups || []).map((g) => {
          const rows = (data.reports || []).filter((r) => r.group === g.key);
          if (!rows.length) return null;
          return (
            <section key={g.key} className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <h2 className={cn('bg-gradient-to-r px-4 py-2.5 font-semibold text-white', GROUP_HEAD[g.key])}>{g.label}</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 text-left font-medium">Report</th>
                      {roles.map((role) => (
                        <th key={role} className="w-28 px-2 py-2 text-center font-medium">
                          {ROLE_LABEL[role] || role}
                        </th>
                      ))}
                      <th className="w-20" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r) => {
                      const dirty = changed.includes(r);
                      return (
                        <tr key={r.code} className={cn(dirty && 'bg-primary/[0.04]')}>
                          <td className="px-4 py-2.5">
                            <p className="font-medium">
                              {r.title}
                              {r.custom && <span className="ml-2 rounded-full bg-violet-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400">Custom</span>}
                            </p>
                            <p className="line-clamp-1 text-xs text-muted-foreground">{r.description}</p>
                          </td>
                          {roles.map((role) => {
                            const missing = r.roles[role].missing;
                            const locked = missing.length > 0;
                            return (
                              <td key={role} className="px-2 py-2.5 text-center">
                                {locked ? (
                                  <span title={`Needs: ${missing.map(PERM_LABEL).join(', ')}`} className="inline-flex text-muted-foreground/60">
                                    <Lock className="h-4 w-4" />
                                    <span className="sr-only">
                                      {ROLE_LABEL[role]} cannot see this data: needs {missing.map(PERM_LABEL).join(', ')}
                                    </span>
                                  </span>
                                ) : (
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 cursor-pointer accent-primary"
                                    checked={ticked(r, role)}
                                    onChange={(e) => setDraft((d) => ({ ...d, [r.code]: { ...d[r.code], [role]: e.target.checked } }))}
                                    aria-label={`${ROLE_LABEL[role]} can open ${r.title}`}
                                  />
                                )}
                              </td>
                            );
                          })}
                          <td className="px-2 text-right">
                            {r.custom && !dirty && (
                              <button
                                type="button"
                                onClick={() => save.mutate({ [r.code]: null })}
                                className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-ring"
                                title="Back to the role's report group permission"
                              >
                                <Undo2 className="h-3.5 w-3.5" /> Default
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => reset.mutate()}
        loading={reset.isPending}
        title="Reset all report access?"
        message="Every report goes back to the role's report group permission (Settings → Permissions)."
        confirmLabel="Reset"
      />
    </div>
  );
}
