import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, X } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/ui/misc';

/**
 * Which customers are on a route/beat. Customers are assigned here (not in
 * the customer form); adding one moves it off its previous route.
 */
export default function RouteCustomers({ route, canEdit, onClose }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(null); // [{ id, code, name, city }]
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [saving, setSaving] = useState(false);

  const current = useQuery({
    queryKey: ['company', 'routes', route?.id, 'customers'],
    queryFn: async () => (await api.get(`/v1/routes/${route.id}/customers`)).data?.data || [],
    enabled: Boolean(route),
  });
  useEffect(() => {
    if (current.data) setSelected(current.data);
  }, [current.data]);

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const results = useQuery({
    queryKey: ['company', 'customers', 'route-picker', term],
    queryFn: async () =>
      (await api.get('/v1/customers', { params: { search: term || undefined, limit: 20, isActive: true } })).data?.data || [],
    enabled: Boolean(route && canEdit),
  });

  const chosen = new Set((selected || []).map((c) => c.id));
  const add = (c) =>
    setSelected((list) => [...list, { id: c.id, code: c.code, name: c.name, city: c.address?.city || '', from: c.route?.name }]);
  const remove = (id) => setSelected((list) => list.filter((c) => c.id !== id));

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/v1/routes/${route.id}/customers`, { customerIds: selected.map((c) => c.id) });
      toast.success('Route customers updated');
      queryClient.invalidateQueries({ queryKey: ['company', 'routes'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'customers'] });
      onClose();
    } catch (err) {
      toast.error(apiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={Boolean(route)}
      onClose={onClose}
      title={route ? `Customers on ${route.name}` : ''}
      description="The outlets a salesman visits on this beat."
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {canEdit ? 'Cancel' : 'Close'}
          </Button>
          {canEdit && (
            <Button type="button" onClick={save} loading={saving} disabled={!selected}>
              Save {selected ? `(${selected.length})` : ''}
            </Button>
          )}
        </>
      }
    >
      {!selected ? (
        <LoadingState label="Loading customers…" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">On this route ({selected.length})</p>
            <div className="max-h-80 overflow-y-auto rounded-lg border">
              {selected.length ? (
                selected.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.code}
                        {c.city ? ` · ${c.city}` : ''}
                        {c.from && c.from !== route.name ? ` · moves from ${c.from}` : ''}
                      </p>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => remove(c.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent focus-ring"
                        aria-label={`Remove ${c.name}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">No customers on this route yet.</p>
              )}
            </div>
          </div>

          {canEdit && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Add customers</p>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code, phone or city" />
              <div className="max-h-72 overflow-y-auto rounded-lg border">
                {results.isLoading ? (
                  <LoadingState label="Searching…" />
                ) : (
                  (results.data || [])
                    .filter((c) => !chosen.has(c.id))
                    .map((c) => (
                      <div key={c.id} className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-0">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{c.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {c.code}
                            {c.address?.city ? ` · ${c.address.city}` : ''}
                            {c.route?.name ? ` · on ${c.route.name}` : ''}
                          </p>
                        </div>
                        <Button type="button" size="sm" variant="ghost" onClick={() => add(c)}>
                          <Plus className="h-4 w-4" /> Add
                        </Button>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
