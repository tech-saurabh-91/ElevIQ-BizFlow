import { PageHeader } from '@/components/ui/page-header';
import { GoodsReceiptsTab } from '@/pages/company/Inventory';

/** Goods received into stock against purchase orders (Purchase menu). */
export default function GoodsReceipts() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Goods Receipts"
        description="Goods received into a warehouse (GRN). Posting one adds the stock and sets its cost; then book the supplier's bill."
        breadcrumbs={[{ label: 'Purchase', to: '/app/purchase-bills' }, { label: 'Goods Receipts' }]}
      />
      <GoodsReceiptsTab />
    </div>
  );
}
