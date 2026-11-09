import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowDown,
  ArrowUp,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { FilterPanel, FILTER_CARD, FILTER_ROW } from '@/components/ui/filter-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { usePermissions } from '@/hooks/usePermissions';

/**
 * Generic master-data list screen.
 *
 * Handles the pieces every Phase 3 master shares: URL-backed search, filters,
 * sorting and pagination; permission-aware create/edit/delete; a modal form;
 * and cache invalidation. Each module only supplies its columns and form.
 */
export default function ResourcePage({
  title,
  description,
  breadcrumbs = [],
  queryKey,
  endpoint,
  permissionPrefix,
  columns = [],
  searchPlaceholder = 'Search…',
  filterKeys = [],
  filters,
  createLabel = 'New record',
  createIcon: CreateIcon = Plus,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  formTitle = (mode) => (mode === 'create' ? 'Create record' : 'Edit record'),
  formDescription,
  formSize = 'lg',
  renderForm,
  rowActions,
  deleteTitle = 'Delete this record?',
  deleteMessage,
  canCreate: canCreateProp,
  canEdit: canEditProp,
  canDelete: canDeleteProp,
  header,
  headerActions,
  viewable = false,
  onSaved,
}) {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { can, isAdmin } = usePermissions();

  const prefix = permissionPrefix || '';
  const canCreate = canCreateProp ?? (prefix ? can(`${prefix}.create`) : false);
  const canEdit = canEditProp ?? (prefix ? can(`${prefix}.update`) : false);
  const canDelete = canDeleteProp ?? (prefix ? can(`${prefix}.delete`) : false);
  void isAdmin;

  const searchParam = params.get('search') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);
  const sort = params.get('sort') || '';
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';

  const [searchDraft, setSearchDraft] = useState(searchParam);
  const [form, setForm] = useState(null); // { mode, initial }
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Keep the input in sync when the URL changes (clear filters, back button).
  useEffect(() => {
    setSearchDraft(searchParam);
  }, [searchParam]);

  const setParam = useCallback(
    (patch) => {
      const next = new URLSearchParams(params);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '' || v === 'ALL') next.delete(k);
        else next.set(k, String(v));
      });
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  // Debounced search keeps the list responsive without a submit button.
  useEffect(() => {
    if (searchDraft === searchParam) return undefined;
    const t = setTimeout(() => {
      setParam({ search: searchDraft.trim(), page: 1 });
    }, 400);
    return () => clearTimeout(t);
  }, [searchDraft, searchParam, setParam]);

  const filterValues = useMemo(
    () => Object.fromEntries(filterKeys.map((k) => [k, params.get(k) || ''])),
    [filterKeys.join(','), params]
  );

  const queryParams = useMemo(() => {
    const out = { page, limit };
    if (searchParam) out.search = searchParam;
    if (sort) {
      out.sort = sort;
      out.order = order;
    }
    filterKeys.forEach((key) => {
      const value = params.get(key);
      if (value) out[key] = value;
    });
    return out;
  }, [page, limit, searchParam, sort, order, filterKeys.join(','), params]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: [...queryKey, queryParams],
    queryFn: async () => {
      const res = await api.get(endpoint, { params: queryParams });
      return res.data;
    },
    keepPreviousData: true,
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ['company', 'lookups'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (row) => api.delete(`${endpoint}/${row.id}`),
    onSuccess: () => {
      toast.success('Deleted');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const handleSaved = (saved) => {
    const mode = form?.mode;
    setForm(null);
    invalidate();
    onSaved?.(saved, mode);
  };

  // `viewable` forms open read-only via a View action (mode 'view').
  const canView = Boolean(viewable && renderForm);
  const hasRowMenu = Boolean(canView || canEdit || canDelete || rowActions);
  const hasActiveFilters =
    Boolean(searchParam) || filterKeys.some((key) => Boolean(params.get(key))) || Boolean(sort);
  const activeFilterCount = filterKeys.filter((key) => Boolean(params.get(key))).length;

  const resetAll = () => {
    const next = new URLSearchParams();
    if (limit !== 20) next.set('limit', String(limit));
    setParams(next, { replace: true });
    setSearchDraft('');
  };

  const toggleSort = (key) => {
    if (sort === key) setParam({ order: order === 'asc' ? 'desc' : 'asc', page: 1 });
    else setParam({ sort: key, order: 'asc', page: 1 });
  };

  const message =
    typeof deleteMessage === 'function' ? deleteMessage(deleteTarget) : deleteMessage;

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={breadcrumbs}
        actions={
          headerActions || (canCreate && renderForm) ? (
            <div className="flex flex-wrap items-center gap-2">
              {headerActions}
              {canCreate && renderForm && (
                <Button onClick={() => setForm({ mode: 'create', initial: null })}>
                  <CreateIcon className="h-4 w-4" />
                  {createLabel}
                </Button>
              )}
            </div>
          ) : null
        }
      />

      {header}

      <Card className={FILTER_CARD}>
        <CardContent className={FILTER_ROW}>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-9 pr-9"
              aria-label={`Search ${title.toLowerCase()}`}
            />
            {searchDraft && (
              <button
                type="button"
                onClick={() => setSearchDraft('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent focus-ring"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {filters ? (
            <FilterPanel active={activeFilterCount} onReset={hasActiveFilters ? resetAll : undefined}>
              {filters({ values: filterValues, setParam, resetAll })}
            </FilterPanel>
          ) : (
            hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={resetAll}>
                Reset
              </Button>
            )
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <EmptyState
            icon="error"
            title={`Could not load ${title.toLowerCase()}`}
            description={apiError(error).message}
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={hasActiveFilters ? 'search' : 'empty'}
            title={hasActiveFilters ? 'No matches found' : emptyTitle}
            description={
              hasActiveFilters
                ? 'Try a different search term or clear the filters.'
                : emptyDescription || 'Create your first record to get started.'
            }
            action={
              hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={resetAll}>
                  Clear filters
                </Button>
              ) : canCreate && renderForm ? (
                <Button size="sm" onClick={() => setForm({ mode: 'create', initial: null })}>
                  <CreateIcon className="h-4 w-4" />
                  {createLabel}
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <Card className={isFetching ? 'opacity-80 transition-opacity' : 'transition-opacity'}>
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className={col.className}
                    sortable={col.sortable}
                    onClick={col.sortable ? () => toggleSort(col.sortable) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {col.sortable && sort === col.sortable && (
                        order === 'asc' ? (
                          <ArrowUp className="h-3 w-3" aria-label="Sorted ascending" />
                        ) : (
                          <ArrowDown className="h-3 w-3" aria-label="Sorted descending" />
                        )
                      )}
                    </span>
                  </TableHead>
                ))}
                {hasRowMenu && <TableHead className="w-12 text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      {col.render ? col.render(row) : row[col.key] ?? '—'}
                    </TableCell>
                  ))}

                  {hasRowMenu && (
                    <TableCell className="text-right">
                      <DropdownMenu
                        align="end"
                        width="w-48"
                        trigger={
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Actions for {row.name || row.id}</span>
                          </span>
                        }
                      >
                        {({ close }) => (
                          <>
                            {canView && (
                              <DropdownMenuItem
                                onClick={() => {
                                  close();
                                  setForm({ mode: 'view', initial: row });
                                }}
                              >
                                <Eye className="h-4 w-4" /> View
                              </DropdownMenuItem>
                            )}
                            {canEdit && (
                              <DropdownMenuItem
                                onClick={() => {
                                  close();
                                  setForm({ mode: 'edit', initial: row });
                                }}
                              >
                                <Pencil className="h-4 w-4" /> Edit
                              </DropdownMenuItem>
                            )}
                            {rowActions?.(row, { close, edit: () => setForm({ mode: 'edit', initial: row }) })}
                            {canDelete && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => {
                                    close();
                                    setDeleteTarget(row);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </>
                        )}
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Pagination
            meta={{ ...meta, page, limit }}
            onPageChange={(p) => setParam({ page: p })}
            onLimitChange={(l) => setParam({ limit: l, page: 1 })}
          />
        </Card>
      )}

      {renderForm && (
        <Dialog
          open={Boolean(form)}
          onClose={() => setForm(null)}
          title={form ? formTitle(form.mode) : ''}
          description={formDescription}
          size={formSize}
        >
          {form && (
            <div className="pb-1">
              {renderForm({
                mode: form.mode,
                initial: form.initial,
                onClose: () => setForm(null),
                onSaved: handleSaved,
              })}
            </div>
          )}
        </Dialog>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate(deleteTarget)}
        title={deleteTitle}
        message={
          message ||
          `“${deleteTarget?.name || deleteTarget?.code || deleteTarget?.id || 'This record'}” will be removed. This action cannot be undone.`
        }
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
