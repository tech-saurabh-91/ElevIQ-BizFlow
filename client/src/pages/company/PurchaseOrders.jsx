import { PageHeader } from '@/components/ui/page-header';
import { PurchaseOrdersTab } from '@/pages/company/Inventory';

/** Purchase orders to suppliers (Purchase menu). */
export default function PurchaseOrders() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Purchase Orders"
        description="What you have ordered from suppliers. Goods are booked into stock with a goods receipt."
        breadcrumbs={[{ label: 'Purchase', to: '/app/purchase-bills' }, { label: 'Purchase Orders' }]}
      />
      <PurchaseOrdersTab />
    </div>
  );
}
