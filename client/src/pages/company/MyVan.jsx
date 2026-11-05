import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Truck } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/misc';
import { ErrorAlert } from '@/components/ui/alert';
import { VanStockTable, DayCloseDialog } from '@/components/company/VanPanels';

/** The signed-in executive's van: stock on board and the day close. */
export default function MyVan() {
  const navigate = useNavigate();
  const [closing, setClosing] = useState(false);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['company', 'vans', 'mine'],
    queryFn: async () => (await api.get('/v1/vans/mine')).data?.data ?? null,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="My van"
        description="Stock on your van and your end-of-day settlement"
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'My van' }]}
        actions={
          data ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate('/app/stock-requests')}>
                <ClipboardList className="h-4 w-4" /> Request stock
              </Button>
              <Button onClick={() => setClosing(true)}>
                <Truck className="h-4 w-4" /> Day cashout
              </Button>
            </div>
          ) : null
        }
      />
      {isLoading ? (
        <LoadingState label="Loading your van…" />
      ) : isError ? (
        <ErrorAlert title="Could not load your van" message={apiError(error).message} />
      ) : !data ? (
        <Card>
          <EmptyState title="No van assigned" description="When a van is assigned to you, its stock and day close appear here." />
        </Card>
      ) : (
        <>
          {data.pendingDays.length > 0 && (
            <ErrorAlert
              title="Day cashout pending"
              message={`Submit the day cashout for ${data.pendingDays.join(', ')} - you cannot mark in or sell until it is approved.`}
            />
          )}
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {data.van.name} <Badge tone="info">{data.van.vehicleNumber || data.van.code}</Badge>
              </CardTitle>
              <CardDescription>
                Invoices you raise are taken from this van. Submit the day cashout before you mark out.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VanStockTable rows={data.stock} />
            </CardContent>
          </Card>
        </>
      )}
      {closing && data && <DayCloseDialog van={{ ...data.van }} onClose={() => setClosing(false)} />}
    </div>
  );
}
