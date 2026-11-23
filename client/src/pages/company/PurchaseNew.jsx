import { PurchaseOrdersTab, GoodsReceiptsTab } from '@/pages/company/Inventory';

/** New purchase order on its own screen (/app/purchase-orders/new). */
export function PurchaseOrderNew() {
  return <PurchaseOrdersTab mode="create" />;
}

/** New goods receipt on its own screen (/app/goods-receipts/new). */
export function GoodsReceiptNew() {
  return <GoodsReceiptsTab mode="create" />;
}
