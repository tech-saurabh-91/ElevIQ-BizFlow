'use client';

import { useEffect, useState } from 'react';
import { transactionAPI, moduleAPI, masterAPI } from '@/services/api';
import { SalesOrder, Customer, Warehouse, Item } from '@/types';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import toast from 'react-hot-toast';

export default function SalesOrdersPage() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [gstEnabled, setGstEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [showInvoice, setShowInvoice] = useState(false);

  useEffect(() => {
    Promise.all([
      transactionAPI.getSalesOrders(),
      moduleAPI.getCustomers(),
      masterAPI.getWarehouses(),
      moduleAPI.getItems(),
      masterAPI.getCompanyDetails(),
    ]).then(([o, c, w, i, comp]) => {
      setOrders(o.data.data);
      setCustomers(c.data.data);
      setWarehouses(w.data.data);
      setItems(i.data.data);
      setGstEnabled(comp.data.data?.gstEnabled || false);
    }).catch(() => toast.error('Failed to fetch')).finally(() => setIsLoading(false));
  }, []);

  const viewInvoice = (order: SalesOrder) => {
    setSelectedOrder(order);
    setShowInvoice(true);
  };

  const baseColumns = [
    { key: 'orderNumber', label: 'Order #', render: (o: SalesOrder) => <span className="font-mono text-sm">{o.orderNumber}</span> },
    { key: 'customer', label: 'Customer', render: (o: SalesOrder) => (o.customerId as any)?.customerName || 'N/A' },
    { key: 'grandTotal', label: 'Amount', render: (o: SalesOrder) => `₹${o.grandTotal.toLocaleString()}` },
  ];

  const gstColumns = [
    { key: 'totalTax', label: 'Tax', render: (o: SalesOrder) => `₹${(o as any).totalTax?.toLocaleString() || 0}` },
    { key: 'totalCgst', label: 'CGST', render: (o: SalesOrder) => `₹${(o as any).totalCgst?.toLocaleString() || 0}` },
    { key: 'totalSgst', label: 'SGST', render: (o: SalesOrder) => `₹${(o as any).totalSgst?.toLocaleString() || 0}` },
    { key: 'totalIgst', label: 'IGST', render: (o: SalesOrder) => `₹${(o as any).totalIgst?.toLocaleString() || 0}` },
  ];

  const endColumns = [
    { key: 'paymentMode', label: 'Payment', render: (o: SalesOrder) => <span className="capitalize">{o.paymentMode}</span> },
    { key: 'status', label: 'Status', render: (o: SalesOrder) => <span className={`px-2 py-1 text-xs font-semibold rounded-full ${o.status === 'approved' ? 'bg-green-100 text-green-800' : o.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>{o.status}</span> },
    { key: 'orderDate', label: 'Date', render: (o: SalesOrder) => new Date(o.orderDate).toLocaleDateString() },
    { key: 'actions', label: 'Actions', render: (o: SalesOrder) => <button onClick={() => viewInvoice(o)} className="text-blue-600 hover:text-blue-800 text-sm font-medium">View Invoice</button> },
  ];

  const columns = gstEnabled ? [...baseColumns, ...gstColumns, ...endColumns] : [...baseColumns, ...endColumns];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sales Orders</h1>
        <p className="text-sm text-gray-500">{gstEnabled ? 'GST Mode: CGST, SGST, IGST breakup shown' : 'Non-GST Mode: Simple tax amount'}</p>
      </div>
      <Table columns={columns} data={orders} isLoading={isLoading} />

      {/* Invoice Modal */}
      {showInvoice && selectedOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Invoice</h2>
                <button onClick={() => setShowInvoice(false)} className="text-gray-500 hover:text-gray-700">✕</button>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-600">Order #: <span className="font-mono font-semibold">{selectedOrder.orderNumber}</span></p>
                <p className="text-sm text-gray-600">Customer: {(selectedOrder.customerId as any)?.customerName}</p>
                <p className="text-sm text-gray-600">Date: {new Date(selectedOrder.orderDate).toLocaleDateString()}</p>
              </div>

              <table className="w-full border-collapse border mb-4">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-2 text-left text-sm">S.No.</th>
                    <th className="border p-2 text-left text-sm">Product</th>
                    <th className="border p-2 text-right text-sm">Qty</th>
                    <th className="border p-2 text-right text-sm">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedOrder.items?.map((item: any, idx: number) => (
                    <tr key={idx}>
                      <td className="border p-2 text-sm">{idx + 1}.</td>
                      <td className="border p-2 text-sm">{item.itemName}</td>
                      <td className="border p-2 text-right text-sm">{item.quantity}</td>
                      <td className="border p-2 text-right text-sm">{item.totalAmount?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="border-t pt-4 space-y-2">
                {gstEnabled ? (
                  <>
                    <div className="flex justify-between text-sm">
                      <span>Total Discount Amount:</span>
                      <span>{(selectedOrder as any).totalDiscount?.toLocaleString() || '0.00'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Total SGST Amount:</span>
                      <span>{(selectedOrder as any).totalSgst?.toLocaleString() || '0.00'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Total CGST Amount:</span>
                      <span>{(selectedOrder as any).totalCgst?.toLocaleString() || '0.00'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Total IGST Amount:</span>
                      <span>{(selectedOrder as any).totalIgst?.toLocaleString() || '0.00'}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between text-sm">
                    <span>Total TAX Amount:</span>
                    <span>{(selectedOrder as any).totalTax?.toLocaleString() || '0.00'}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span>Total Discount Amount:</span>
                  <span>{(selectedOrder as any).totalDiscount?.toLocaleString() || '0.00'}</span>
                </div>
                <div className="flex justify-between font-bold text-lg border-t pt-2">
                  <span>Net Amount:</span>
                  <span>₹{selectedOrder.grandTotal?.toLocaleString()}</span>
                </div>
              </div>

              <div className="mt-6 text-center text-sm text-gray-500">
                Thank you for Purchase.!
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
