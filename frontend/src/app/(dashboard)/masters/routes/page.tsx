'use client';

import { useEffect, useState } from 'react';
import { moduleAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import toast from 'react-hot-toast';

export default function RoutesPage() {
  const perm = usePermission('/masters/routes');
  const [routes, setRoutes] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    routeName: '',
    routeDate: '',
    routeDescription: '',
  });

  useEffect(() => { fetchRoutes(); fetchCustomers(); }, []);

  const fetchRoutes = async () => {
    try { const res = await moduleAPI.getRoutes(); setRoutes(res.data.data); } catch { toast.error('Failed'); } finally { setIsLoading(false); }
  };

  const fetchCustomers = async () => {
    try { const res = await moduleAPI.getCustomers(); setCustomers(res.data.data); } catch {}
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCustomerIds.length === 0) { toast.error('Please select at least one customer'); return; }
    setErrors({}); setIsSaving(true);
    try {
      const payload = { ...formData, customers: selectedCustomerIds };
      if (editing) { await moduleAPI.updateRoute(editing._id, payload); toast.success('Updated'); }
      else { await moduleAPI.createRoute(payload); toast.success('Created'); }
      setIsModalOpen(false); setEditing(null); resetForm(); fetchRoutes();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Failed'); setErrors({ submit: err.response?.data?.message || err.message || 'Failed' }); } finally { setIsSaving(false); }
  };

  const handleEdit = (r: any) => {
    setEditing(r);
    const customerIds = (r.customers || []).map((c: any) => typeof c === 'string' ? c : c._id);
    setFormData({
      routeName: r.routeName,
      routeDate: r.routeDate ? r.routeDate.split('T')[0] : '',
      routeDescription: r.routeDescription || '',
    });
    setSelectedCustomerIds(customerIds);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this route?')) return;
    try { await moduleAPI.deleteRoute(id); toast.success('Deleted'); fetchRoutes(); } catch { toast.error('Failed'); }
  };

  const resetForm = () => {
    setFormData({ routeName: '', routeDate: '', routeDescription: '' });
    setSelectedCustomerIds([]);
    setCustomerSearch('');
  };

  const toggleCustomer = (id: string) => {
    setSelectedCustomerIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleAllCustomers = () => {
    const filtered = getFilteredCustomers();
    const allSelected = filtered.every(c => selectedCustomerIds.includes(c._id));
    if (allSelected) {
      setSelectedCustomerIds(prev => prev.filter(id => !filtered.find(c => c._id === id)));
    } else {
      setSelectedCustomerIds(prev => [...new Set([...prev, ...filtered.map(c => c._id)])]);
    }
  };

  const getFilteredCustomers = () => {
    if (!customerSearch) return customers;
    const s = customerSearch.toLowerCase();
    return customers.filter(c =>
      c.customerName?.toLowerCase().includes(s) ||
      c.customerCode?.toLowerCase().includes(s) ||
      c.address?.toLowerCase().includes(s) ||
      c.city?.toLowerCase().includes(s)
    );
  };

  const filteredCustomers = getFilteredCustomers();
  const allFilteredSelected = filteredCustomers.length > 0 && filteredCustomers.every(c => selectedCustomerIds.includes(c._id));

  const columns = [
    { key: 'route', label: 'Route', render: (r: any) => <div><p className="font-medium">{r.routeName}</p><p className="text-sm text-gray-500">{r.routeNumber}</p></div> },
    { key: 'routeDate', label: 'Date', render: (r: any) => r.routeDate ? new Date(r.routeDate).toLocaleDateString() : '-' },
    { key: 'customerCount', label: 'Customers', render: (r: any) => <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">{(r.customers || []).length}</span> },
    { key: 'routeDescription', label: 'Details' },
    { key: 'actions', label: 'Actions', render: (r: any) => <div className="flex space-x-2">{perm.canEdit && <button onClick={() => handleEdit(r)} className="text-blue-600">Edit</button>}{perm.canDelete && <button onClick={() => handleDelete(r._id)} className="text-red-600">Delete</button>}</div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Routes</h1>
        {perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Add Route</Button>}
      </div>
      <Table columns={columns} data={routes} isLoading={isLoading} />
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditing(null); resetForm(); }} title={editing ? 'Edit Route' : 'Add Route'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{errors.submit}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Route Name" required value={formData.routeName} onChange={(e: any) => setFormData({ ...formData, routeName: e.target.value })} />
            <Input label="Route Date" type="date" required value={formData.routeDate} onChange={(e: any) => setFormData({ ...formData, routeDate: e.target.value })} />
          </div>
          <div>
            <Input label="Details" value={formData.routeDescription} onChange={(e: any) => setFormData({ ...formData, routeDescription: e.target.value })} placeholder="Route description or notes" />
          </div>

          {/* Customer Selection */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b flex items-center justify-between">
              <h3 className="font-medium text-sm">Select Customers for this Route</h3>
              <span className="text-xs text-gray-500">{selectedCustomerIds.length} selected</span>
            </div>
            <div className="px-4 py-2 border-b">
              <input type="text" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search by name, code, address, city..." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left">
                      <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllCustomers} className="rounded" />
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Customer Name</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Code</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Address</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">City</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredCustomers.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-400">No customers found</td></tr>
                  ) : filteredCustomers.map(c => (
                    <tr key={c._id} className={`hover:bg-blue-50 cursor-pointer ${selectedCustomerIds.includes(c._id) ? 'bg-blue-50' : ''}`}
                      onClick={() => toggleCustomer(c._id)}>
                      <td className="px-4 py-2">
                        <input type="checkbox" checked={selectedCustomerIds.includes(c._id)}
                          onChange={() => toggleCustomer(c._id)} onClick={(e) => e.stopPropagation()} className="rounded" />
                      </td>
                      <td className="px-4 py-2 font-medium">{c.customerName}</td>
                      <td className="px-4 py-2 text-gray-500">{c.customerCode}</td>
                      <td className="px-4 py-2 text-gray-500">{c.address || '-'}</td>
                      <td className="px-4 py-2 text-gray-500">{c.city || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditing(null); resetForm(); }}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : (editing ? 'Update' : 'Create')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
