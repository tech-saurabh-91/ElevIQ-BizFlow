'use client';

import { useEffect, useState } from 'react';
import { masterAPI, moduleAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import { VAN, Warehouse, Customer } from '@/types';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import toast from 'react-hot-toast';
import { COUNTRIES_DATA } from '@/utils/locationData';

export default function VansPage() {
  const perm = usePermission('/masters/vans');
  const [vans, setVans] = useState<VAN[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<VAN | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    vanName: '', warehouseId: '', customerId: '', vehicleNumber: '', driverName: '',
    driverPhone: '', driverPhoneCode: '+91', capacity: '0',
  });

  useEffect(() => {
    Promise.all([masterAPI.getVans(), masterAPI.getWarehouses(), moduleAPI.getCustomers()])
      .then(([v, w, c]) => { setVans(v.data.data); setWarehouses(w.data.data); setCustomers(c.data.data); })
      .catch(() => toast.error('Failed to fetch')).finally(() => setIsLoading(false));
  }, []);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.vanName.trim()) errs.vanName = 'VAN name is required';
    if (!formData.warehouseId) errs.warehouseId = 'Please select a warehouse';
    if (formData.driverPhone && !/^\d+$/.test(formData.driverPhone)) {
      errs.driverPhone = 'Phone must contain only numbers';
    } else if (formData.driverPhone) {
      const country = COUNTRIES_DATA.find(c => c.phoneCode === formData.driverPhoneCode);
      if (country && formData.driverPhone.length !== country.phoneLength) {
        errs.driverPhone = `${country.name} phone must be ${country.phoneLength} digits`;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      setIsSaving(true);
      const payload = {
        ...formData,
        capacity: Number(formData.capacity),
        driverPhone: formData.driverPhone ? `${formData.driverPhoneCode}${formData.driverPhone}` : '',
      };
      if (editing) { await masterAPI.updateVan(editing._id, payload); toast.success('Updated'); }
      else { await masterAPI.createVan(payload); toast.success('Created'); }
      setIsModalOpen(false); setEditing(null); resetForm();
      const res = await masterAPI.getVans(); setVans(res.data.data);
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed';
      toast.error(msg);
      setErrors({ submit: msg });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (van: VAN) => {
    setEditing(van);
    const phone = van.driverPhone || '';
    let code = '+91';
    let number = phone;
    for (const c of COUNTRIES_DATA) {
      if (phone.startsWith(c.phoneCode)) {
        code = c.phoneCode;
        number = phone.substring(c.phoneCode.length);
        break;
      }
    }
    setFormData({
      vanName: van.vanName, warehouseId: (van.warehouseId as any)?._id || '',
      customerId: (van.customerId as any)?._id || '',
      vehicleNumber: van.vehicleNumber || '', driverName: van.driverName || '',
      driverPhone: number, driverPhoneCode: code,
      capacity: String(van.capacity),
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete?')) return;
    try { await masterAPI.deleteVan(id); toast.success('Deleted'); const res = await masterAPI.getVans(); setVans(res.data.data); } catch { toast.error('Failed'); }
  };

  const resetForm = () => {
    setFormData({
      vanName: '', warehouseId: '', customerId: '', vehicleNumber: '',
      driverName: '', driverPhone: '', driverPhoneCode: '+91', capacity: '0',
    });
    setErrors({});
  };

  const phoneCountry = COUNTRIES_DATA.find(c => c.phoneCode === formData.driverPhoneCode);

  const columns = [
    { key: 'van', label: 'VAN', render: (v: VAN) => <div><p className="font-medium">{v.vanName}</p><p className="text-sm text-gray-500">{v.vanCode}</p></div> },
    { key: 'warehouse', label: 'Warehouse', render: (v: VAN) => (v.warehouseId as any)?.warehouseName || 'N/A' },
    { key: 'vehicleNumber', label: 'Vehicle No' },
    { key: 'driverName', label: 'Driver' },
    { key: 'capacity', label: 'Capacity' },
    { key: 'actions', label: 'Actions', render: (v: VAN) => <div className="flex space-x-2">{perm.canEdit && <button onClick={() => handleEdit(v)} className="text-blue-600">Edit</button>}{perm.canDelete && <button onClick={() => handleDelete(v._id)} className="text-red-600">Delete</button>}</div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">VANs</h1>{perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Add VAN</Button>}</div>
      <Table columns={columns} data={vans} isLoading={isLoading} />
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditing(null); setErrors({}); }} title={editing ? 'Edit VAN' : 'Add VAN'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && (
            <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm">{errors.submit}</div>
          )}
          <div>
            <Input label="VAN Name" required value={formData.vanName} onChange={(e: any) => setFormData({ ...formData, vanName: e.target.value })} />
            {errors.vanName && <p className="text-red-500 text-xs mt-1">{errors.vanName}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Warehouse <span className="text-red-500">*</span></label>
              <select value={formData.warehouseId} onChange={(e) => setFormData({ ...formData, warehouseId: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required>
                <option value="">Select</option>{warehouses.map(w => <option key={w._id} value={w._id}>{w.warehouseName}</option>)}
              </select>
              {errors.warehouseId && <p className="text-red-500 text-xs mt-1">{errors.warehouseId}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Customer Account</label>
              <select value={formData.customerId} onChange={(e) => setFormData({ ...formData, customerId: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
                <option value="">Select</option>{customers.map(c => <option key={c._id} value={c._id}>{c.customerName}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Vehicle Number" value={formData.vehicleNumber} onChange={(e: any) => setFormData({ ...formData, vehicleNumber: e.target.value.toUpperCase() })} placeholder="e.g. MH12AB1234" />
            <Input label="Capacity" type="number" value={formData.capacity} onChange={(e: any) => setFormData({ ...formData, capacity: e.target.value })} />
          </div>
          <Input label="Driver Name" value={formData.driverName} onChange={(e: any) => setFormData({ ...formData, driverName: e.target.value })} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Driver Phone</label>
            <div className="flex">
              <select value={formData.driverPhoneCode} onChange={(e) => setFormData({ ...formData, driverPhoneCode: e.target.value })}
                className="w-[130px] px-2 py-2 border border-r-0 border-gray-300 rounded-l-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-500">
                {COUNTRIES_DATA.map(c => (
                  <option key={c.code} value={c.phoneCode}>{c.name} ({c.phoneCode})</option>
                ))}
              </select>
              <input type="tel" value={formData.driverPhone} onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '');
                const maxLen = phoneCountry?.phoneLength || 15;
                setFormData({ ...formData, driverPhone: val.slice(0, maxLen) });
              }} placeholder={`e.g. ${phoneCountry?.phoneLength || 10} digits`}
                className="w-full px-3 py-2 border border-gray-300 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-slate-500" />
            </div>
            {errors.driverPhone && <p className="text-red-500 text-xs mt-1">{errors.driverPhone}</p>}
          </div>
          <div className="flex justify-end space-x-3 pt-4">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditing(null); setErrors({}); }}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : (editing ? 'Update' : 'Create')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
