'use client';

import { useEffect, useState } from 'react';
import { transactionAPI, moduleAPI } from '@/services/api';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

export default function TourVisitsPage() {
  const [visits, setVisits] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [visitPurposes, setVisitPurposes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({
    customerId: '', routeId: '', visitDate: new Date().toISOString().split('T')[0],
    visitTime: '', purpose: 'general', orderAmount: '', remarks: '', status: 'completed',
  });

  useEffect(() => {
    Promise.all([
      transactionAPI.getTourVisits(),
      moduleAPI.getCustomers(),
      moduleAPI.getRoutes(),
      moduleAPI.getParameters({ type: 'visit_purpose' }),
    ]).then(([v, c, r, p]) => { setVisits(v.data.data); setCustomers(c.data.data); setRoutes(r.data.data); setVisitPurposes(p.data.data); })
      .catch(() => toast.error('Failed to load')).finally(() => setIsLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({}); setIsSaving(true);
    try {
      const payload = { ...formData, orderAmount: Number(formData.orderAmount) || 0 };
      if (editing) { await transactionAPI.updateTourVisit(editing._id, payload); toast.success('Updated'); }
      else { await transactionAPI.createTourVisit(payload); toast.success('Created'); }
      setIsModalOpen(false); setEditing(null); resetForm();
      const res = await transactionAPI.getTourVisits(); setVisits(res.data.data);
    } catch (err: any) { toast.error(err.response?.data?.message || 'Failed'); setErrors({ submit: err.response?.data?.message || err.message || 'Failed' }); } finally { setIsSaving(false); }
  };

  const handleEdit = (v: any) => {
    setEditing(v);
    setFormData({
      customerId: v.customerId?._id || '', routeId: v.routeId?._id || '',
      visitDate: v.visitDate?.split('T')[0] || '', visitTime: v.visitTime || '',
      purpose: v.purpose || 'general', orderAmount: String(v.orderAmount || ''),
      remarks: v.remarks || '', status: v.status,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete?')) return;
    try { await transactionAPI.deleteTourVisit(id); toast.success('Deleted'); const res = await transactionAPI.getTourVisits(); setVisits(res.data.data); } catch { toast.error('Failed'); }
  };

  const resetForm = () => setFormData({
    customerId: '', routeId: '', visitDate: new Date().toISOString().split('T')[0],
    visitTime: '', purpose: 'general', orderAmount: '', remarks: '', status: 'completed',
  });

  const columns = [
    { key: 'visitDate', label: 'Date', render: (v: any) => v.visitDate ? format(new Date(v.visitDate), 'dd MMM yyyy') : '-' },
    { key: 'customer', label: 'Customer', render: (v: any) => v.customerId?.customerName || '-' },
    { key: 'route', label: 'Route', render: (v: any) => v.routeId?.routeName || '-' },
    { key: 'visitTime', label: 'Time' },
    { key: 'purpose', label: 'Purpose', render: (v: any) => <span className="capitalize">{v.purpose?.replace('_', ' ')}</span> },
    { key: 'orderAmount', label: 'Order Amt', render: (v: any) => v.orderAmount ? `₹${v.orderAmount.toLocaleString()}` : '-' },
    { key: 'status', label: 'Status', render: (v: any) => <span className={`px-2 py-1 text-xs font-medium rounded-full ${v.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{v.status}</span> },
    { key: 'actions', label: 'Actions', render: (v: any) => <div className="flex space-x-2"><button onClick={() => handleEdit(v)} className="text-blue-600">Edit</button><button onClick={() => handleDelete(v._id)} className="text-red-600">Delete</button></div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Tour Visits</h1><Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ New Visit</Button></div>
      <Table columns={columns} data={visits} isLoading={isLoading} />
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditing(null); }} title={editing ? 'Edit Visit' : 'New Tour Visit'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{errors.submit}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Customer *</label><select value={formData.customerId} onChange={(e) => setFormData({ ...formData, customerId: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required><option value="">Select Customer</option>{customers.map((c: any) => <option key={c._id} value={c._id}>{c.customerName}</option>)}</select></div>
            <div><label className="block text-sm font-medium mb-1">Route</label><select value={formData.routeId} onChange={(e) => setFormData({ ...formData, routeId: e.target.value })} className="w-full px-3 py-2 border rounded-lg"><option value="">Select Route</option>{routes.map((r: any) => <option key={r._id} value={r._id}>{r.routeName}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Visit Date" type="date" required value={formData.visitDate} onChange={(e: any) => setFormData({ ...formData, visitDate: e.target.value })} />
            <Input label="Visit Time" type="time" value={formData.visitTime} onChange={(e: any) => setFormData({ ...formData, visitTime: e.target.value })} />
            <div><label className="block text-sm font-medium mb-1">Purpose *</label>
              <select value={formData.purpose} onChange={(e) => setFormData({ ...formData, purpose: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required>
                <option value="">Select Purpose</option>
                {visitPurposes.length > 0 ? (
                  visitPurposes.map((p: any) => <option key={p._id} value={p.parameterValue}>{p.parameterValue}</option>)
                ) : (
                  <option value="general" disabled>No purposes created. Add in Parameters.</option>
                )}
              </select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Order Amount" type="number" value={formData.orderAmount} onChange={(e: any) => setFormData({ ...formData, orderAmount: e.target.value })} />
            <div><label className="block text-sm font-medium mb-1">Status</label><select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="w-full px-3 py-2 border rounded-lg"><option value="completed">Completed</option><option value="pending">Pending</option><option value="cancelled">Cancelled</option></select></div>
          </div>
          <Input label="Remarks" value={formData.remarks} onChange={(e: any) => setFormData({ ...formData, remarks: e.target.value })} />
          <div className="flex justify-end space-x-3 pt-4"><Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditing(null); }}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : (editing ? 'Update' : 'Create')}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
