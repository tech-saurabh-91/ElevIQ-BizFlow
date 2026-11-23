import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Database, Download, ShieldAlert, Trash2, Upload } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorAlert } from '@/components/ui/alert';
import { formatDateTime, formatNumber } from '@/utils/format';

/**
 * Provider tools for one company's data (super admin only):
 *   1. download a full backup (.json.gz) - every record of the company;
 *   2. delete all its data - only after a fresh backup, once the company is
 *      suspended or cancelled, typing its code to confirm;
 *   3. restore it later from the backup file (RestoreBackupDialog).
 */

const kb = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const labelOf = (name) => name.replace(/([a-z])([A-Z])/g, '$1 $2');

const saveBlob = (data, filename) => {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/gzip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

function PurgeDialog({ company, records, onClose, onDone }) {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const purge = useMutation({
    mutationFn: async () => (await api.post(`/platform/companies/${company.id}/purge`, { confirmCode: code, reason })).data,
    onSuccess: (res) => {
      toast.success(res.message || 'Company data deleted');
      onDone();
    },
  });
  const ready = code.trim().toUpperCase() === company.code && reason.trim().length >= 10;
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!purge.isPending}
      title={`Delete all data of ${company.businessName}`}
      description="This cannot be undone. The only way back is the backup file."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={purge.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => purge.mutate()} disabled={!ready} loading={purge.isPending}>
            <Trash2 className="h-4 w-4" /> Delete {formatNumber(records)} records
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {purge.isError && <ErrorAlert title="The data was not deleted" message={apiError(purge.error).message} />}
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed">
          Every customer, product, order, invoice, payment, stock entry, user, setting and audit entry of this company is removed from the database.
          Its users can no longer sign in. The company row stays (marked as deleted) so its code is not reused and the backup can be restored under it.
        </div>
        <Field label={`Type the company code (${company.code}) to confirm`} required>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={company.code} autoComplete="off" />
        </Field>
        <Field label="Reason (kept in the platform audit trail)" required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Customer closed the account on 30 Nov; backup handed over" />
        </Field>
      </div>
    </Dialog>
  );
}

export function CompanyDataPanel({ company }) {
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState(false);
  const [purging, setPurging] = useState(false);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['platform', 'company', company.id, 'data'],
    queryFn: async () => (await api.get(`/platform/companies/${company.id}/data`)).data.data,
    retry: false,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['platform', 'company', company.id] });
    queryClient.invalidateQueries({ queryKey: ['platform', 'companies'] });
  };

  const download = async () => {
    setDownloading(true);
    try {
      const res = await api.get(`/platform/companies/${company.id}/backup`, { responseType: 'blob', timeout: 300_000 });
      const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] || '')?.[1] || `backup-${company.code}.json.gz`;
      saveBlob(res.data, name);
      toast.success('Backup downloaded. Keep the file somewhere safe.');
      refresh();
    } catch (err) {
      toast.error(apiError(err).message);
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading) return <Skeleton className="h-48 rounded-xl" />;
  if (isError) return <ErrorAlert title="Could not load the company data" message={apiError(error).message} />;

  const counts = Object.entries(data.counts || {}).sort((a, b) => b[1] - a[1]);
  const backup = data.backup?.lastAt ? data.backup : null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" /> Records held
          </CardTitle>
          <CardDescription>{data.purgedAt ? 'All data of this company was deleted.' : `${formatNumber(data.records)} records in the database.`}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.purgedAt ? (
            <p className="text-sm text-muted-foreground">
              Deleted {formatDateTime(data.purgedAt)}
              {data.purgedBy ? ` by ${data.purgedBy}` : ''}. Restore it from its backup file (Companies → Restore from backup).
            </p>
          ) : counts.length ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              {counts.map(([name, n]) => (
                <div key={name} className="flex justify-between gap-2 border-b py-1">
                  <span className="text-muted-foreground">{labelOf(name)}</span>
                  <span className="tabular-nums">{formatNumber(n)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No records.</p>
          )}
          {data.restoredAt && <p className="mt-3 text-xs text-muted-foreground">Restored from a backup on {formatDateTime(data.restoredAt)}.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> Backup &amp; delete
          </CardTitle>
          <CardDescription>For a company that has left: take the backup, then delete its data.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-medium">1. Full backup</p>
            <p className="text-xs text-muted-foreground">
              {backup
                ? `Last: ${formatDateTime(backup.lastAt)}${backup.lastBy ? ` by ${backup.lastBy}` : ''} · ${formatNumber(backup.records)} records · ${kb(backup.bytes)}`
                : 'No backup taken yet.'}
            </p>
            <Button className="mt-2 w-full" variant="outline" onClick={download} loading={downloading} disabled={Boolean(data.purgedAt)}>
              <Download className="h-4 w-4" /> Download backup (.json.gz)
            </Button>
          </div>
          <div>
            <p className="font-medium">2. Delete all data</p>
            <p className="text-xs text-muted-foreground">
              {data.purgeBlocker || `Allowed: the company is not active and a backup was taken in the last ${data.freshHours} hours.`}
            </p>
            <Button className="mt-2 w-full" variant="destructive" onClick={() => setPurging(true)} disabled={Boolean(data.purgeBlocker)}>
              <Trash2 className="h-4 w-4" /> Delete all data
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Uploaded files (logos, receipt photos) are not in the backup. Login sessions are not kept.
          </p>
        </CardContent>
      </Card>

      {purging && (
        <PurgeDialog
          company={company}
          records={data.records}
          onClose={() => setPurging(false)}
          onDone={() => {
            setPurging(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** Restore a company from its backup file: check the file first, then load it. */
export function RestoreBackupDialog({ open, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [check, setCheck] = useState(null);
  const send = useMutation({
    mutationFn: async (apply) => {
      const form = new FormData();
      form.append('file', file);
      return (await api.post(`/platform/companies/restore${apply ? '?apply=true' : ''}`, form, { timeout: 300_000 })).data;
    },
    onSuccess: (res, apply) => {
      if (apply) {
        toast.success(res.message);
        onDone?.(res.data);
        close();
      } else {
        setCheck(res.data);
      }
    },
  });
  const close = () => {
    setFile(null);
    setCheck(null);
    send.reset();
    onClose();
  };
  const counts = Object.entries(check?.counts || {}).sort((a, b) => b[1] - a[1]);
  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!send.isPending}
      title="Restore a company from its backup"
      description="Puts back every record of the company exactly as it was when the backup was taken."
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={send.isPending}>
            Cancel
          </Button>
          {check ? (
            <Button onClick={() => send.mutate(true)} disabled={check.conflicts.length > 0} loading={send.isPending}>
              <Upload className="h-4 w-4" /> Restore {check.company.name}
            </Button>
          ) : (
            <Button onClick={() => send.mutate(false)} disabled={!file} loading={send.isPending}>
              Check the file
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {send.isError && <ErrorAlert title="That did not work" message={apiError(send.error).message} />}
        <Field label="Backup file (.json.gz)" required>
          <Input
            type="file"
            accept=".gz,application/gzip"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setCheck(null);
              send.reset();
            }}
          />
        </Field>
        {check && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="font-medium">
              {check.company.name} <span className="font-mono text-xs text-muted-foreground">{check.company.code}</span>
              {check.company.exists ? <Badge tone="info" className="ml-2">Company row exists</Badge> : <Badge tone="muted" className="ml-2">New company row</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">
              Backup of {formatDateTime(check.header.createdAt)}
              {check.header.createdBy ? ` by ${check.header.createdBy}` : ''} · {formatNumber(check.header.records)} records
            </p>
            {check.conflicts.length > 0 ? (
              <ErrorAlert title="Cannot restore" message={check.conflicts.join(' ')} />
            ) : (
              <div className="grid grid-cols-2 gap-x-4 text-xs">
                {counts.slice(0, 12).map(([name, n]) => (
                  <div key={name} className="flex justify-between border-b py-0.5">
                    <span className="text-muted-foreground">{labelOf(name)}</span>
                    <span className="tabular-nums">{formatNumber(n)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">After restoring, set the company status (and subscription) so its users can sign in again.</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
