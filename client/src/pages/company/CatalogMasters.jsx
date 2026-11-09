import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs } from '@/components/ui/tabs';
import { LoadingState } from '@/components/ui/misc';
import { usePermissions } from '@/hooks/usePermissions';
import { cn } from '@/utils/cn';

const LEVEL_LABEL = { CLASSIFICATION: 'Classification', CATEGORY: 'Category', SUBCATEGORY: 'Sub-category' };

/** Inline rename / toggle / delete for one master row. */
function Row({ node, selected, onSelect, perms, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.name);
  return (
    <div
      className={cn(
        'group flex items-center gap-2 border-b px-3 py-2 text-sm last:border-0',
        onSelect && 'cursor-pointer hover:bg-accent/50',
        selected && 'bg-accent'
      )}
      onClick={() => !editing && onSelect?.(node)}
    >
      {editing ? (
        <form
          className="flex flex-1 items-center gap-1"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onSave(node, { name })) setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" autoFocus />
          <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save name">
            <Check className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setEditing(false)}>
            <X className="h-4 w-4" />
          </Button>
        </form>
      ) : (
        <>
          <span className={cn('flex-1 truncate', !node.isActive && 'text-muted-foreground line-through')}>{node.name}</span>
          <span className="text-xs text-muted-foreground" title="Products">
            {node.productCount}
          </span>
          {perms.update && (
            <>
              <input
                type="checkbox"
                checked={node.isActive}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onSave(node, { isActive: !node.isActive })}
                title={node.isActive ? 'Active' : 'Inactive'}
                aria-label={`${node.isActive ? 'Deactivate' : 'Activate'} ${node.name}`}
                className="h-4 w-4 accent-primary"
              />
              <button
                type="button"
                className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100 focus:opacity-100 focus-ring"
                onClick={(e) => {
                  e.stopPropagation();
                  setName(node.name);
                  setEditing(true);
                }}
                aria-label={`Rename ${node.name}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {perms.delete && (
            <button
              type="button"
              className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-destructive group-hover:opacity-100 focus:opacity-100 focus-ring"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(node);
              }}
              aria-label={`Delete ${node.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Column({ title, level, nodes, parent, selected, onSelect, perms, actions, emptyText }) {
  const [name, setName] = useState('');
  const disabled = level !== 'CLASSIFICATION' && !parent;
  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await actions.create({ level, name: name.trim(), parent: parent?.id || null })) setName('');
  };
  return (
    <div className="flex min-h-0 flex-col rounded-lg border">
      <div className="border-b px-3 py-2">
        <p className="text-sm font-semibold">
          {title} <span className="font-normal text-muted-foreground">({nodes.length})</span>
        </p>
        {parent && <p className="truncate text-xs text-muted-foreground">in {parent.name}</p>}
      </div>
      <div className="max-h-96 min-h-[10rem] overflow-y-auto">
        {nodes.length ? (
          nodes.map((n) => (
            <Row
              key={n.id}
              node={n}
              selected={selected === n.id}
              onSelect={onSelect}
              perms={perms}
              onSave={actions.update}
              onDelete={actions.remove}
            />
          ))
        ) : (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">{disabled ? emptyText : `No ${title.toLowerCase()} yet.`}</p>
        )}
      </div>
      {perms.create && (
        <form onSubmit={add} className="flex gap-2 border-t p-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={disabled ? emptyText : `New ${LEVEL_LABEL[level].toLowerCase()}`}
            disabled={disabled}
            className="h-9"
          />
          <Button type="submit" size="sm" variant="outline" disabled={disabled || !name.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </form>
      )}
    </div>
  );
}

function CategoriesTab({ perms }) {
  const queryClient = useQueryClient();
  const [classId, setClassId] = useState(null);
  const [catId, setCatId] = useState(null);
  const { data = [], isLoading } = useQuery({
    queryKey: ['company', 'product-categories'],
    queryFn: async () => (await api.get('/v1/product-categories')).data?.data || [],
  });

  const byLevel = (level, parent) => data.filter((n) => n.level === level && (parent === undefined || n.parent === parent));
  const classes = byLevel('CLASSIFICATION');
  const current = classes.find((c) => c.id === classId) || null;
  const cats = current ? byLevel('CATEGORY', current.id) : [];
  const cat = cats.find((c) => c.id === catId) || null;
  const subs = cat ? byLevel('SUBCATEGORY', cat.id) : [];

  const run = async (fn, message) => {
    try {
      await fn();
      if (message) toast.success(message);
      queryClient.invalidateQueries({ queryKey: ['company', 'product-categories'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'products'] });
      return true;
    } catch (err) {
      toast.error(apiError(err).message);
      return false;
    }
  };
  const actions = {
    create: (body) => run(() => api.post('/v1/product-categories', body), `${LEVEL_LABEL[body.level]} added`),
    update: (node, body) => run(() => api.patch(`/v1/product-categories/${node.id}`, body)),
    remove: (node) =>
      window.confirm(`Delete "${node.name}"?`) && run(() => api.delete(`/v1/product-categories/${node.id}`), 'Deleted'),
  };

  if (isLoading) return <LoadingState label="Loading categories…" />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Pick a classification to see its categories, and a category to see its sub-categories. Renaming updates every
        product that uses it; anything in use can be made inactive instead of deleted.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <Column
          title="Classifications"
          level="CLASSIFICATION"
          nodes={classes}
          selected={classId}
          onSelect={(n) => {
            setClassId(n.id);
            setCatId(null);
          }}
          perms={perms}
          actions={actions}
        />
        <Column
          title="Categories"
          level="CATEGORY"
          nodes={cats}
          parent={current}
          selected={catId}
          onSelect={(n) => setCatId(n.id)}
          perms={perms}
          actions={actions}
          emptyText="Select a classification first"
        />
        <Column
          title="Sub-categories"
          level="SUBCATEGORY"
          nodes={subs}
          parent={cat}
          perms={perms}
          actions={actions}
          emptyText="Select a category first"
        />
      </div>
    </div>
  );
}

function UnitsTab({ perms }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ code: '', name: '', allowDecimals: false });
  const { data = [], isLoading } = useQuery({
    queryKey: ['company', 'units'],
    queryFn: async () => (await api.get('/v1/units')).data?.data || [],
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['company', 'units'] });
  const save = useMutation({
    mutationFn: ({ id, body }) => (id ? api.patch(`/v1/units/${id}`, body) : api.post('/v1/units', body)),
    onSuccess: (_res, vars) => {
      if (!vars.id) {
        toast.success('Unit added');
        setDraft({ code: '', name: '', allowDecimals: false });
      }
      refresh();
    },
    onError: (err) => toast.error(apiError(err).message),
  });
  const remove = useMutation({
    mutationFn: (id) => api.delete(`/v1/units/${id}`),
    onSuccess: () => {
      toast.success('Unit deleted');
      refresh();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  if (isLoading) return <LoadingState label="Loading units…" />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Products choose their base unit and pack units from this list. Units that allow decimals (KG, L) accept 1.5;
        others are counted in whole numbers.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="table-cards w-full sm:min-w-[520px] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 text-center font-medium">Decimals</th>
              <th className="px-3 py-2 text-center font-medium">Active</th>
              <th className="px-3 py-2 text-right font-medium">Products</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2 font-mono font-semibold">{u.code}</td>
                <td className="px-3 py-2">{u.name}</td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={u.allowDecimals}
                    disabled={!perms.update}
                    onChange={() => save.mutate({ id: u.id, body: { allowDecimals: !u.allowDecimals } })}
                    aria-label={`Allow decimals for ${u.code}`}
                    className="h-4 w-4 accent-primary"
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={u.isActive}
                    disabled={!perms.update}
                    onChange={() => save.mutate({ id: u.id, body: { isActive: !u.isActive } })}
                    aria-label={`${u.code} active`}
                    className="h-4 w-4 accent-primary"
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{u.productCount}</td>
                <td className="px-3 py-2 text-right">
                  {perms.delete && !u.productCount && (
                    <button
                      type="button"
                      onClick={() => window.confirm(`Delete unit ${u.code}?`) && remove.mutate(u.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive focus-ring"
                      aria-label={`Delete ${u.code}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {perms.create && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ body: draft });
          }}
        >
          <Input
            value={draft.code}
            onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
            placeholder="Code, e.g. TRAY"
            maxLength={10}
            className="h-9 w-36 font-mono"
          />
          <Input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Name, e.g. Tray"
            maxLength={40}
            className="h-9 w-48"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.allowDecimals}
              onChange={(e) => setDraft((d) => ({ ...d, allowDecimals: e.target.checked }))}
              className="h-4 w-4 accent-primary"
            />
            Allow decimals
          </label>
          <Button type="submit" size="sm" disabled={!draft.code || !draft.name} loading={save.isPending}>
            <Plus className="h-4 w-4" /> Add unit
          </Button>
        </form>
      )}
    </div>
  );
}

export default function CatalogMasters() {
  const { can } = usePermissions();
  const [tab, setTab] = useState('categories');
  const perms = useMemo(
    () => ({ create: can('products.create'), update: can('products.update'), delete: can('products.delete') }),
    [can]
  );
  return (
    <div className="space-y-5">
      <PageHeader
        title="Categories & Units"
        description="Product classifications, categories, sub-categories and units of measure"
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Categories & Units' }]}
        actions={
          <Badge tone={perms.update ? 'success' : 'muted'} dot>
            {perms.update ? 'Editable' : 'Read only'}
          </Badge>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Product masters</CardTitle>
          <CardDescription>Used by the product form, filters and reports.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            size="sm"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'categories', label: 'Categories' },
              { value: 'units', label: 'Units' },
            ]}
          />
          {tab === 'categories' ? <CategoriesTab perms={perms} /> : <UnitsTab perms={perms} />}
        </CardContent>
      </Card>
    </div>
  );
}
