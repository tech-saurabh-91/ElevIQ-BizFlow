import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/misc';
import { ErrorAlert } from '@/components/ui/alert';
import { useLookups } from '@/hooks/useLookups';
import { cn } from '@/utils/cn';

/**
 * Beat plan: who works which route on which day. Each route has a weekly
 * default (Routes & Beats: salesman + beat days); a cell here overrides it
 * for that one day (leave cover, extra beat). "Weekly" clears the override.
 */

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const mondayOf = (day) => {
  const d = new Date(`${day}T12:00:00`);
  return addDays(day, -((d.getDay() + 6) % 7));
};
const dayLabel = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });

export default function BeatPlan() {
  const queryClient = useQueryClient();
  const today = iso(new Date());
  const [from, setFrom] = useState(mondayOf(today));
  const to = addDays(from, 6);
  const [saving, setSaving] = useState('');
  const { lookups } = useLookups();
  const salesmen = useMemo(() => (lookups.users || []).filter((u) => ['SALESMAN', 'MANAGER'].includes(u.role)), [lookups.users]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['company', 'beat', 'grid', from],
    queryFn: async () => (await api.get('/v1/beat-plans', { params: { from, to } })).data?.data,
  });
  const cellOf = (route, day) => data?.cells.find((c) => c.route === route && c.day === day);

  const save = async (route, day, salesman) => {
    const key = `${route.id}|${day}`;
    setSaving(key);
    try {
      await api.put('/v1/beat-plans', { route: route.id, salesman: salesman || null, days: [day] });
      toast.success(salesman ? 'Beat planned' : 'Back to the weekly plan');
      queryClient.invalidateQueries({ queryKey: ['company', 'beat'] });
    } catch (err) {
      toast.error(apiError(err).message);
    } finally {
      setSaving('');
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Beat plan"
        description="Assign routes to salesmen day by day. Unchanged days follow each route's weekly plan."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Beat plan' }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setFrom(addDays(from, -7))} aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFrom(mondayOf(today))}>
              This week
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFrom(addDays(from, 7))} aria-label="Next week">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <Card>
        {isLoading ? (
          <LoadingState label="Loading the plan…" />
        ) : isError ? (
          <div className="p-4">
            <ErrorAlert title="Could not load the plan" message={apiError(error).message} />
          </div>
        ) : !data?.routes.length ? (
          <EmptyState icon="empty" title="No routes yet" description="Create routes and add customers in Routes & Beats first." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="sticky left-0 z-10 bg-muted px-3 py-2 font-medium">Route</th>
                  {data.days.map((d) => (
                    <th key={d} className={cn('px-2 py-2 font-medium', d === today && 'text-primary')}>
                      {dayLabel(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.routes.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="sticky left-0 z-10 bg-card px-3 py-2">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.customers} shops{r.assignedToName ? ` · ${r.assignedToName} (${r.beatDays.join(', ') || 'no days'})` : ''}
                      </p>
                    </td>
                    {data.days.map((d) => {
                      const cell = cellOf(r.id, d);
                      const past = d < today;
                      return (
                        <td key={d} className={cn('px-2 py-2 align-top', d === today && 'bg-primary/5')}>
                          <Select
                            value={cell?.source === 'PLAN' ? cell.salesman : ''}
                            onChange={(e) => save(r, d, e.target.value)}
                            disabled={past || saving === `${r.id}|${d}`}
                            className={cn('h-8 text-xs', cell?.source === 'PLAN' && 'border-primary font-medium')}
                            aria-label={`${r.name} on ${d}`}
                          >
                            <option value="">{cell?.source === 'WEEKLY' ? `Weekly: ${cell.salesmanName}` : 'Weekly: —'}</option>
                            {salesmen.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                          </Select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">Highlighted cells are day plans. Pick "Weekly" to remove one. Past days are locked.</p>
    </div>
  );
}
