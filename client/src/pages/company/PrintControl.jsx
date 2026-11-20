import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ShieldCheck } from 'lucide-react';
import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { ErrorAlert } from '@/components/ui/alert';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatDateTime } from '@/utils/format';
import { PRINT_KINDS, PrintStatus, openDocumentPdf } from '@/components/company/print-control';

/**
 * Admin page: every print of a key document (invoice, credit note, receipt,
 * purchase order), who printed it and whether it was the original or a
 * duplicate copy. From here the admin prints the original again or allows
 * one more original for the next print.
 */
export default function PrintControl() {
  const [docType, setDocType] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState(null);

  const params = { page, limit, ...(docType ? { docType } : {}), ...(applied ? { search: applied } : {}) };
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['company', 'print-control', params],
    queryFn: async () => (await api.get('/v1/print-control', { params })).data,
    keepPreviousData: true,
  });
  const rows = data?.data || [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Print Control"
        description="Original and duplicate prints of invoices, credit notes, receipts and purchase orders. The first print is the original; later prints say DUPLICATE COPY."
      />

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Select
          value={docType}
          onChange={(e) => {
            setDocType(e.target.value);
            setPage(1);
          }}
          className="w-44"
        >
          <option value="">All documents</option>
          {Object.entries(PRINT_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(search.trim());
            setPage(1);
          }}
        >
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Document no., party or printed by" maxLength={100} />
          <Button type="submit" variant="outline">
            <Search className="h-4 w-4" /> Search
          </Button>
        </form>
      </Card>

      {selected && (
        <Card className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">
              {PRINT_KINDS[selected.docType]?.label} {selected.docNo}
            </span>
            <span className="text-muted-foreground">{selected.partyName}</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
          <PrintStatus docType={selected.docType} id={selected.docId} />
        </Card>
      )}

      {isError ? (
        <ErrorAlert title="Could not load the print history" message={apiError(error).message} />
      ) : isLoading ? (
        <TableSkeleton rows={8} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing printed yet" description="Prints of key documents appear here." />
      ) : (
        <Card>
          <Table cards className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Print</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(r.at)}</TableCell>
                  <TableCell>
                    <span className="font-medium">{r.docNo || '—'}</span>
                    <span className="block text-xs text-muted-foreground">{PRINT_KINDS[r.docType]?.label}</span>
                  </TableCell>
                  <TableCell>{r.partyName || '—'}</TableCell>
                  <TableCell>
                    {r.action === 'GRANT' ? (
                      <Badge tone="info">Original allowed{r.note ? `: ${r.note}` : ''}</Badge>
                    ) : r.copy === 'ORIGINAL' ? (
                      <Badge tone="success">{r.adminOriginal ? 'Original (admin reprint)' : 'Original'}</Badge>
                    ) : (
                      <Badge tone="warning">Duplicate copy</Badge>
                    )}
                  </TableCell>
                  <TableCell>{r.byName || '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setSelected(r)}>
                        Status
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => openDocumentPdf(`/v1/${PRINT_KINDS[r.docType].path}/${r.docId}/pdf`, { original: 1 })}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Print original
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            meta={{ ...(data?.meta || {}), page, limit }}
            onPageChange={setPage}
            onLimitChange={(l) => {
              setLimit(l);
              setPage(1);
            }}
            limits={[20, 50, 100, 200]}
          />
        </Card>
      )}
    </div>
  );
}
