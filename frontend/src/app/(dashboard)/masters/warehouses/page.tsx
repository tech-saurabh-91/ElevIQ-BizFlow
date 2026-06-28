'use client';

import { useEffect, useState } from 'react';
import { masterAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import { Warehouse } from '@/types';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import LocationSelects from '@/components/common/LocationSelects';
import toast from 'react-hot-toast';

export default function WarehousesPage() {
  const perm = usePermission('/masters/warehouses');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({ warehouseName: '', address: '', city: '', state: '', country: 'India', stateCode: '', pincode: '', warehouseType: 'main' });

  useEffect(() => { fetchWarehouses(); }, []);

  const fetchWarehouses = async () => {
    try { const res = await masterAPI.getWarehouses(); setWarehouses(res.data.data); } catch { toast.error('Failed to fetch'); } finally { setIsLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsSaving(true);
    try {
      if (editing) { await masterAPI.updateWarehouse(editing._id, formData); toast.success('Updated'); }
      else { await masterAPI.createWarehouse(formData); toast.success('Created'); }
      setIsModalOpen(false); setEditing(null); resetForm(); fetchWarehouses();
    } catch (err: any) { setErrors({ submit: err.response?.data?.message || err.message || 'Failed' }); }
    finally { setIsSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete?')) return;
    try { await masterAPI.deleteWarehouse(id); toast.success('Deleted'); fetchWarehouses(); } catch { toast.error('Failed'); }
  };

  const resetForm = () => setFormData({ warehouseName: '', address: '', city: '', state: '', country: 'India', stateCode: '', pincode: '', warehouseType: 'main' });

  const columns = [
    { key: 'name', label: 'Warehouse', render: (w: Warehouse) => <div><p className="font-medium">{w.warehouseName}</p><p className="text-sm text-gray-500">{w.warehouseCode}</p></div> },
    { key: 'city', label: 'City' },
    { key: 'warehouseType', label: 'Type', render: (w: Warehouse) => <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 capitalize">{w.warehouseType}</span> },
    { key: 'actions', label: 'Actions', render: (w: Warehouse) => <div className="flex space-x-2">{perm.canEdit && <button onClick={() => { setEditing(w); setFormData({ warehouseName: w.warehouseName, address: w.address, city: w.city, state: w.state || '', country: (w as any).country || 'India', stateCode: (w as any).stateCode || '', pincode: w.pincode || '', warehouseType: w.warehouseType }); setIsModalOpen(true); }} className="text-blue-600">Edit</button>}{perm.canDelete && <button onClick={() => handleDelete(w._id)} className="text-red-600">Delete</button>}</div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Warehouses</h1>{perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Add Warehouse</Button>}</div>
      <Table columns={columns} data={warehouses} isLoading={isLoading} />
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditing(null); }} title={editing ? 'Edit' : 'Add Warehouse'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{errors.submit}</div>}
          <Input label="Warehouse Name" required value={formData.warehouseName} onChange={(e: any) => setFormData({ ...formData, warehouseName: e.target.value })} />
          <Input label="Address" required value={formData.address} onChange={(e: any) => setFormData({ ...formData, address: e.target.value })} />
          <LocationSelects
            country={formData.country}
            state={formData.state}
            city={formData.city}
            stateCode={formData.stateCode}
            onCountryChange={(val) => setFormData({ ...formData, country: val, state: '', city: '', stateCode: '' })}
            onStateChange={(val, code) => setFormData({ ...formData, state: val, stateCode: code, city: '' })}
            onCityChange={(val) => setFormData({ ...formData, city: val })}
            showCity={true}
            showStateCode={false}
          />
          <div>
            <Input label="Pincode" value={formData.pincode} onChange={(e: any) => setFormData({ ...formData, pincode: e.target.value })} />
          </div>
          <div><label className="block text-sm font-medium mb-1">Type</label><select value={formData.warehouseType} onChange={(e) => setFormData({ ...formData, warehouseType: e.target.value })} className="w-full px-3 py-2 border rounded-lg"><option value="main">Main</option><option value="sub">Sub</option><option value="van">Van</option><option value="godown">Godown</option></select></div>
          <div className="flex justify-end space-x-3 pt-4"><Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditing(null); }}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : (editing ? 'Update' : 'Create')}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
