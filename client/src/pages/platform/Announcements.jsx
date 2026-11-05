import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Megaphone, Plus, Pencil, Trash2, Radio, Building2, Eye, EyeOff } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Select, Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { ErrorAlert } from '@/components/ui/alert';
import { formatDateTime } from '@/utils/format';

const TYPES = ['INFO', 'UPDATE', 'MAINTENANCE', 'PROMO', 'FEATURE'];
const TYPE_TONE = { INFO: 'info', UPDATE: 'info', MAINTENANCE: 'warning', PROMO: 'success', FEATURE: 'success' };

const schema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  body: z.string().trim().max(4000).optional().or(z.literal('')),
  type: z.enum(TYPES),
  broadcast: z.boolean(),
  active: z.boolean(),
  startsAt: z.string().optional().or(z.literal('')),
  endsAt: z.string().optional().or(z.literal('')),
  ctaLabel: z.string().trim().max(80).optional().or(z.literal('')),
  ctaLink: z.string().trim().max(400).optional().or(z.literal('')),
}).superRefine((v, ctx) => {
  if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: '"Hide after" must be later than "Visible from"' });
  }
});

/** Saved instant -> `<input type="datetime-local">` value in local time (not UTC). */
const localDateTime = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const DEFAULTS = {
  title: '',
  body: '',
  type: 'INFO',
  broadcast: true,
  active: true,
  startsAt: '',
  endsAt: '',
  ctaLabel: '',
  ctaLink: '',
};

export default function Announcements() {
  const queryClient = useQueryClient();
  const [params, setParams] = useState({ page: 1, limit: 20 });
  const [editing, setEditing] = useState(null); // announcement | 'new' | null
  const [deleting, setDeleting] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['platform', 'announcements', params],
    queryFn: async () => {
      const res = await api.get('/platform/announcements', { params });
      return res.data;
    },
    keepPreviousData: true,
  });

  const toggleMutation = useMutation({
    mutationFn: (a) => api.patch(`/platform/announcements/${a.id}`, { active: !a.active }),
    onSuccess: (_r, a) => {
      toast.success(a.active ? 'Announcement retired' : 'Announcement activated');
      queryClient.invalidateQueries({ queryKey: ['platform', 'announcements'] });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (a) => api.delete(`/platform/announcements/${a.id}`),
    onSuccess: () => {
      toast.success('Announcement deleted');
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['platform', 'announcements'] });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        description="Messages shown inside company workspaces (banners and notification feeds)"
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="mr-2 h-4 w-4" />
            New announcement
          </Button>
        }
      />

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <EmptyState icon="error" title="Could not load announcements" description={apiError(error).message} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="empty"
            title="No announcements"
            description="Publish maintenance notices, feature launches or promos to every tenant."
            action={
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus className="mr-2 h-4 w-4" />
                New announcement
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex flex-col gap-3 py-4 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={TYPE_TONE[a.type] || 'info'}>{a.type}</Badge>
                    <h3 className="font-semibold">{a.title}</h3>
                    {a.isLive ? (
                      <Badge tone="success" dot>
                        LIVE
                      </Badge>
                    ) : (
                      <Badge tone="muted" dot>
                        {a.active ? 'SCHEDULED' : 'INACTIVE'}
                      </Badge>
                    )}
                  </div>
                  {a.body && <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{a.body}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      {a.broadcast ? (
                        <>
                          <Radio className="h-3.5 w-3.5" /> All companies ({meta.totalCompanies || 0})
                        </>
                      ) : (
                        <>
                          <Building2 className="h-3.5 w-3.5" /> {a.targetCount} targeted
                        </>
                      )}
                    </span>
                    <span>Published {formatDateTime(a.createdAt)}</span>
                    {a.startsAt && <span>From {formatDateTime(a.startsAt)}</span>}
                    {a.endsAt && <span>Until {formatDateTime(a.endsAt)}</span>}
                    {a.ctaLabel && (
                      <span className="truncate">
                        CTA: {a.ctaLabel} → {a.ctaLink || '—'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => toggleMutation.mutate(a)} loading={toggleMutation.isLoading && toggleMutation.variables?.id === a.id}>
                    {a.active ? (
                      <>
                        <EyeOff className="mr-1.5 h-4 w-4" /> Retire
                      </>
                    ) : (
                      <>
                        <Eye className="mr-1.5 h-4 w-4" /> Activate
                      </>
                    )}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditing(a)}>
                    <Pencil className="mr-1.5 h-4 w-4" /> Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDeleting(a)}>
                    <Trash2 className="mr-1.5 h-4 w-4 text-destructive" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Pagination
        meta={meta}
        onPageChange={(page) => setParams((p) => ({ ...p, page }))}
        onLimitChange={(limit) => setParams((p) => ({ ...p, limit, page: 1 }))}
      />

      {editing && (
        <AnnouncementDialog
          announcement={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ['platform', 'announcements'] });
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete "${deleting?.title || ''}"?`}
        message="Companies will no longer see this announcement."
        confirmLabel="Delete"
        tone="destructive"
        loading={deleteMutation.isLoading}
        onConfirm={() => deleteMutation.mutate(deleting)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit announcement dialog
// ---------------------------------------------------------------------------
function AnnouncementDialog({ announcement, onClose, onSaved }) {
  const [serverErrors, setServerErrors] = useState([]);
  const [formError, setFormError] = useState('');

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: announcement
      ? {
          title: announcement.title,
          body: announcement.body || '',
          type: announcement.type,
          broadcast: announcement.broadcast,
          active: announcement.active,
          startsAt: localDateTime(announcement.startsAt),
          endsAt: localDateTime(announcement.endsAt),
          ctaLabel: announcement.ctaLabel || '',
          ctaLink: announcement.ctaLink || '',
        }
      : DEFAULTS,
  });

  const broadcast = watch('broadcast');

  const mutation = useMutation({
    mutationFn: async (v) => {
      const payload = {
        title: v.title,
        body: v.body,
        type: v.type,
        broadcast: v.broadcast,
        active: v.active,
        startsAt: v.startsAt ? new Date(v.startsAt).toISOString() : undefined,
        endsAt: v.endsAt ? new Date(v.endsAt).toISOString() : undefined,
        ctaLabel: v.ctaLabel,
        ctaLink: v.ctaLink,
      };
      if (announcement) {
        const res = await api.patch(`/platform/announcements/${announcement.id}`, payload);
        return res.data.data;
      }
      const res = await api.post('/platform/announcements', payload);
      return res.data.data;
    },
    onSuccess: () => {
      toast.success(announcement ? 'Announcement updated' : 'Announcement published');
      onSaved();
    },
    onError: (err) => {
      const info = apiError(err);
      const fields = toFieldErrors(info.errors);
      setServerErrors(info.errors);
      setFormError(Object.keys(fields).length ? '' : info.message);
      Object.entries(fields).forEach(([f, msg]) => setError(f, { type: 'server', message: msg }));
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={announcement ? 'Edit announcement' : 'New announcement'}
      description="Broadcast reaches every active tenant; targeted messages can be added per company later via the API."
      size="lg"
      dismissible={!mutation.isLoading}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isLoading}>
            Cancel
          </Button>
          <Button loading={mutation.isLoading || isSubmitting} onClick={handleSubmit(mutation.mutate)}>
            <Megaphone className="mr-2 h-4 w-4" />
            {announcement ? 'Save changes' : 'Publish'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(mutation.mutate)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {(formError || serverErrors.length > 0) && (
          <div className="sm:col-span-2">
            <ErrorAlert
              title="The announcement could not be saved"
              message={formError}
              errors={serverErrors.filter((e) => !e.field || e.field === '_')}
              onClose={() => {
                setFormError('');
                setServerErrors([]);
              }}
            />
          </div>
        )}

        <Field label="Title" required error={errors.title?.message} className="sm:col-span-2">
          <Input {...register('title')} error={!!errors.title} placeholder="Scheduled maintenance this Sunday" />
        </Field>
        <Field label="Message" error={errors.body?.message} className="sm:col-span-2">
          <Textarea rows={4} {...register('body')} error={!!errors.body} placeholder="What should companies know?" />
        </Field>
        <Field label="Type" required error={errors.type?.message}>
          <Select {...register('type')} error={!!errors.type}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Visible from" error={errors.startsAt?.message}>
          <Input type="datetime-local" {...register('startsAt')} error={!!errors.startsAt} />
        </Field>
        <Field label="Hide after" error={errors.endsAt?.message}>
          <Input type="datetime-local" min={watch('startsAt') || undefined} {...register('endsAt')} error={!!errors.endsAt} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Button label" error={errors.ctaLabel?.message}>
            <Input {...register('ctaLabel')} error={!!errors.ctaLabel} placeholder="Status page" />
          </Field>
          <Field label="Button link" error={errors.ctaLink?.message}>
            <Input {...register('ctaLink')} error={!!errors.ctaLink} placeholder="https://…" />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-6 sm:col-span-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" {...register('broadcast')} className="h-4 w-4 rounded border-input" />
            Broadcast to all companies
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" {...register('active')} className="h-4 w-4 rounded border-input" />
            Active
          </label>
          {!broadcast && (
            <span className="text-xs text-muted-foreground">
              Targeted delivery: no companies selected yet — it will be visible to none until targets are set.
            </span>
          )}
        </div>
      </form>
    </Dialog>
  );
}
