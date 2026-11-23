import { useNavigate, useParams } from 'react-router-dom';
import { PurchaseDocDialog } from '@/components/company/purchase-view';

const LIST = { po: '/app/purchase-orders', grn: '/app/goods-receipts', payment: '/app/supplier-payments', return: '/app/purchase-returns' };

/** A saved purchase order / goods receipt / supplier payment / purchase return on its own screen. */
export default function PurchaseDocPage({ kind }) {
  const { id } = useParams();
  const navigate = useNavigate();
  return <PurchaseDocDialog kind={kind} id={id} asPage onClose={() => navigate(LIST[kind])} />;
}
