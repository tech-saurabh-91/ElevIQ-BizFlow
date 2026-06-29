'use client';

import { useEffect, useState } from 'react';
import { masterAPI, moduleAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import toast from 'react-hot-toast';

export default function WarehousesPage() {
  const perm = usePermission('/masters/warehouses');
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [natureOptions, setNatureOptions] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    warehouseName: '',
    warehouseCode: '',
    address: '',
    natureOfWarehouse: '',
    isParentWarehouse: false,
    parentWarehouseId: '',
    isVanWarehouse: false,
    vanNumber: '',
    vanParentWarehouseId: '',
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [wareRes, paramRes] = await Promise.all([
        masterAPI.getWarehouses({ limit: 500 }).catch(() => ({ data: { data: [] } })),
        moduleAPI.getParameters({ parameterType: 'warehouse_nature', limit: 500 }).catch(() => ({ data: { data: [] } })),
      ]);
      setWarehouses(wareRes?.data?.data || []);
      setNatureOptions((paramRes?.data?.data || []).filter((p: any) => p.isActive !== false));
    } catch { toast.error('Failed to load data'); }
    finally { setIsLoading(false); }
  };

  const getWarehouseCode = (name: string) => {
    if (!name) return '';
    const initials = name.split(/\s+/).map((w: string) => w.charAt(0).toUpperCase()).join('');
    const count = warehouses.length;
    return `${initials}${String(count + 1).padStart(2, '0')}`;
  };

  useEffect(() => {
    if (!editing && formData.warehouseName) {
      setFormData(prev => ({ ...prev, warehouseCode: getWarehouseCode(prev.warehouseName) }));
    }
  }, [formData.warehouseName, editing]);

  const resetForm = () => setFormData({
    warehouseName: '', warehouseCode: '', address: '', natureOfWarehouse: '',
    isParentWarehouse: false, parentWarehouseId: '', isVanWarehouse: false, vanNumber: '', vanParentWarehouseId: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    const newErrors: Record<string, string> = {};
    if (!formData.warehouseName) newErrors.warehouseName = 'Required';
    if (!formData.address) newErrors.address = 'Required';
    if (!formData.natureOfWarehouse) newErrors.natureOfWarehouse = 'Required';

    if (!formData.isParentWarehouse && formData.isVanWarehouse) {
      if (!formData.vanNumber) newErrors.vanNumber = 'Required';
      if (!formData.vanParentWarehouseId) newErrors.vanParentWarehouseId = 'Required';
    }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    setIsSaving(true);
    try {
      const payload: any = {
        warehouseName: formData.warehouseName,
        address: formData.address,
        natureOfWarehouse: formData.natureOfWarehouse,
        isParentWarehouse: formData.isParentWarehouse,
        parentWarehouseId: formData.isParentWarehouse ? null : (formData.parentWarehouseId || null),
        isVanWarehouse: !formData.isParentWarehouse ? formData.isVanWarehouse : false,
        vanNumber: !formData.isParentWarehouse && formData.isVanWarehouse ? formData.vanNumber : '',
        vanParentWarehouseId: !formData.isParentWarehouse && formData.isVanWarehouse ? formData.vanParentWarehouseId || null : null,
      };

      if (editing) { await masterAPI.updateWarehouse(editing._id, payload); toast.success('Updated'); }
      else { await masterAPI.createWarehouse(payload); toast.success('Created'); }
      setIsModalOpen(false); setEditing(null); resetForm(); loadData();
    } catch (err: any) { setErrors({ submit: err.response?.data?.message || err.message || 'Failed' }); }
    finally { setIsSaving(false); }
  };

  const handleEdit = (w: any) => {
    setFormData({
      warehouseName: w.warehouseName,
      warehouseCode: w.warehouseCode || '',
      address: w.address || '',
      natureOfWarehouse: w.natureOfWarehouse || '',
      isParentWarehouse: w.isParentWarehouse || false,
      parentWarehouseId: w.parentWarehouseId?._id || w.parentWarehouseId || '',
      isVanWarehouse: w.isVanWarehouse || false,
      vanNumber: w.vanNumber || '',
      vanParentWarehouseId: w.vanParentWarehouseId?._id || w.vanParentWarehouseId || '',
    });
    setEditing(w);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this warehouse?')) return;
    try { await masterAPI.deleteWarehouse(id); toast.success('Deleted'); loadData(); } catch { toast.error('Failed'); }
  };

  const parentWarehouses = warehouses.filter((w: any) => w.isActive !== false && w._id !== editing?._id);

  const columns = [
    {
      key: 'name', label: 'Warehouse',
      render: (w: any) => <div><p className="font-medium">{w.warehouseName}</p><p className="text-sm text-gray-500">{w.warehouseCode}</p></div>,
    },
    { key: 'natureOfWarehouse', label: 'Nature' },
    { key: 'city', label: 'City' },
    {
      key: 'parentWarehouse', label: 'Parent',
      render: (w: any) => <span>{w.isParentWarehouse ? 'Yes' : 'No'}</span>,
    },
    {
      key: 'van', label: 'Van',
      render: (w: any) => <span>{w.isVanWarehouse ? w.vanNumber || 'Yes' : 'No'}</span>,
    },
    {
      key: 'actions', label: 'Actions',
      render: (w: any) => (
        <div className="flex space-x-2">
          {perm.canEdit && <button onClick={() => handleEdit(w)} className="text-blue-600 hover:text-blue-800">Edit</button>}
          {perm.canDelete && <button onClick={() => handleDelete(w._id)} className="text-red-600 hover:text-red-800">Delete</button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Warehouses</h1>
        {perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Add Warehouse</Button>}
      </div>
      <Table columns={columns} data={warehouses} isLoading={isLoading} />

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditing(null); resetForm(); setErrors({}); }} title={editing ? 'Edit Warehouse' : 'Add Warehouse'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm">{errors.submit}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Warehouse Code</label>
              <input type="text" value={formData.warehouseCode || 'Auto-generated'} disabled
                className="w-full px-3 py-2 border border-dashed border-gray-400 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed" />
              <p className="text-xs text-gray-400 mt-1">Auto-generated</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Warehouse Name <span className="text-red-500">*</span></label>
              <input type="text" value={formData.warehouseName}
                onChange={(e) => setFormData({ ...formData, warehouseName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Enter warehouse name" />
              {errors.warehouseName && <p className="text-red-500 text-xs mt-1">{errors.warehouseName}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Address 1 <span className="text-red-500">*</span></label>
              <input type="text" value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Enter address" />
              {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Nature of Warehouse <span className="text-red-500">*</span></label>
              <select value={formData.natureOfWarehouse}
                onChange={(e) => setFormData({ ...formData, natureOfWarehouse: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="">Select</option>
                {natureOptions.map((p: any) => (
                  <option key={p._id} value={p.parameterValue}>{p.parameterValue}</option>
                ))}
              </select>
              {errors.natureOfWarehouse && <p className="text-red-500 text-xs mt-1">{errors.natureOfWarehouse}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Parent Warehouse</label>
              <div className="flex gap-4 py-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={formData.isParentWarehouse === false}
                    onChange={() => setFormData({ ...formData, isParentWarehouse: false, isVanWarehouse: false, vanNumber: '', vanParentWarehouseId: '' })}
                    className="h-4 w-4" />
                  <span className="text-sm">No</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={formData.isParentWarehouse === true}
                    onChange={() => setFormData({ ...formData, isParentWarehouse: true, isVanWarehouse: false, vanNumber: '', vanParentWarehouseId: '' })}
                    className="h-4 w-4" />
                  <span className="text-sm">Yes</span>
                </label>
              </div>
            </div>
          </div>

          {!formData.isParentWarehouse && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Van</label>
                <div className="flex gap-4 py-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={formData.isVanWarehouse === false}
                      onChange={() => setFormData({ ...formData, isVanWarehouse: false, vanNumber: '', vanParentWarehouseId: '' })}
                      className="h-4 w-4" />
                    <span className="text-sm">No</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={formData.isVanWarehouse === true}
                      onChange={() => setFormData({ ...formData, isVanWarehouse: true })}
                      className="h-4 w-4" />
                    <span className="text-sm">Yes</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {!formData.isParentWarehouse && formData.isVanWarehouse && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Van Number <span className="text-red-500">*</span></label>
                <input type="text" value={formData.vanNumber}
                  onChange={(e) => setFormData({ ...formData, vanNumber: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Enter van number" />
                {errors.vanNumber && <p className="text-red-500 text-xs mt-1">{errors.vanNumber}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Van Parent Warehouse <span className="text-red-500">*</span></label>
                <select value={formData.vanParentWarehouseId}
                  onChange={(e) => setFormData({ ...formData, vanParentWarehouseId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  <option value="">Select</option>
                  {parentWarehouses.map((w: any) => (
                    <option key={w._id} value={w._id}>{w.warehouseName}</option>
                  ))}
                </select>
                {errors.vanParentWarehouseId && <p className="text-red-500 text-xs mt-1">{errors.vanParentWarehouseId}</p>}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditing(null); resetForm(); setErrors({}); }}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : (editing ? 'Update' : 'Create')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
