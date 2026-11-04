import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';

/**
 * Bulk import from an Excel template (customers, products...): download the
 * template, fill it, upload it. The upload is validated first (nothing saved);
 * the Import button appears only when every row passes.
 *
 * `endpoint` is the resource root, e.g. /v1/customers (serves
 * /import/template and /import); `noun` is the plural label ("customers").
 */
export default function BulkImport({ open, onClose, endpoint, noun, invalidate = [], hint }) {
  const queryClient = useQueryClient();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const reset = () => {
    setFile(null);
    setResult(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const close = () => {
    reset();
    onClose();
  };

  const downloadTemplate = async () => {
    setBusy('template');
    try {
      const res = await api.get(`${endpoint}/import/template`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${noun.replace(/\s+/g, '-')}-import-template.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiError(err).message);
    } finally {
      setBusy('');
    }
  };

  const send = async (dryRun) => {
    if (!file) return;
    setBusy(dryRun ? 'check' : 'import');
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post(`${endpoint}/import?dryRun=${dryRun}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      const data = res.data?.data;
      setResult(data);
      if (!dryRun && data?.imported) {
        toast.success(`${data.imported} ${noun} imported`);
        [...invalidate, ['company', 'lookups']].forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
        close();
      }
    } catch (err) {
      setResult(null);
      setError(apiError(err).message);
    } finally {
      setBusy('');
    }
  };

  const clean = result && !result.errors.length;

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : close}
      dismissible={!busy}
      title={`Import ${noun}`}
      description={`Add many ${noun} at once from the Excel template.`}
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={close} disabled={Boolean(busy)}>
            Cancel
          </Button>
          {clean ? (
            <Button type="button" onClick={() => send(false)} loading={busy === 'import'}>
              <Upload className="h-4 w-4" /> Import {result.valid} {noun}
            </Button>
          ) : (
            <Button type="button" onClick={() => send(true)} disabled={!file} loading={busy === 'check'}>
              Check file
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <ol className="space-y-3">
          <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
            <span>
              <span className="font-medium">1. Download the template</span>
              <span className="block text-xs text-muted-foreground">
                Columns marked * are required. {hint}
              </span>
            </span>
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate} loading={busy === 'template'}>
              <Download className="h-4 w-4" /> Template
            </Button>
          </li>
          <li className="space-y-2 rounded-lg border p-3">
            <span className="font-medium">2. Upload the filled file</span>
            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed p-3 hover:bg-accent/40">
              <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
              <span className="flex-1 truncate">{file ? file.name : 'Choose an .xlsx file (max 1000 rows, 5 MB)'}</span>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setResult(null);
                  setError('');
                }}
              />
            </label>
          </li>
        </ol>

        {error && <ErrorAlert title="Import failed" message={error} onClose={() => setError('')} />}

        {clean && (
          <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 p-3">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span>
              All {result.valid} rows are valid. Codes are generated automatically when you import.
            </span>
          </div>
        )}

        {result && result.errors.length > 0 && (
          <div className="space-y-2">
            <p className="font-medium text-destructive">
              {result.errors.length} problem(s) in {result.total} row(s). Fix them in the file and check again; nothing was
              imported.
            </p>
            <div className="max-h-64 overflow-y-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 font-medium">Row</th>
                    <th className="px-2 py-1.5 font-medium">Column</th>
                    <th className="px-2 py-1.5 font-medium">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1.5 tabular-nums">{e.row ?? '—'}</td>
                      <td className="px-2 py-1.5">{e.column || '—'}</td>
                      <td className="px-2 py-1.5">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
