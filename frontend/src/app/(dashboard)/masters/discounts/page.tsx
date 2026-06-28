'use client';

import { useEffect, useState, useRef } from 'react';
import { moduleAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import toast from 'react-hot-toast';

type DiscountItem = {
  itemId: string | { _id: string; itemCode?: string; itemName?: string; unit?: string };
  itemCode?: string;
  itemName?: string;
  unit?: string;
};

type Discount = {
  _id: string;
  discountGroup: string;
  effectiveFrom: string;
  effectiveTo: string;
  quantityFrom: number;
  discountPercent: number;
  items: DiscountItem[];
  isActive: boolean;
};

export default function DiscountsPage() {
  const perm = usePermission('/masters/discounts');
  const [list, setList] = useState<Discount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewing, setViewing] = useState<Discount | null>(null);
  const [editing, setEditing] = useState<Discount | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [allItems, setAllItems] = useState<any[]>([]);
  const [activeItems, setActiveItems] = useState<any[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [itemSearchResults, setItemSearchResults] = useState<any[]>([]);
  const [showItemLov, setShowItemLov] = useState(false);
  const loRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    discountGroup: '',
    effectiveFrom: '',
    effectiveTo: '',
    quantityFrom: 1,
    discountPercent: 0,
    isActive: true,
  });
  const [savedItems, setSavedItems] = useState<DiscountItem[]>([]);

  useEffect(() => { loadList(); loadItems(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (loRef.current && !loRef.current.contains(e.target as Node)) setShowItemLov(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadList = async () => {
    try {
      const res = await moduleAPI.getDiscounts({ limit: 200 });
      setList(res.data.data || []);
    } catch { toast.error('Failed to load data'); } finally { setIsLoading(false); }
  };

  const loadItems = async () => {
    try {
      const res = await moduleAPI.getItems({ limit: 500 });
      const data = res.data.data || [];
      setAllItems(data);
      setActiveItems(data.filter((i: any) => i.isActive !== false));
    } catch {}
  };

  const openCreate = () => {
    setEditing(null);
    setViewing(null);
    setForm({ discountGroup: '', effectiveFrom: '', effectiveTo: '', quantityFrom: 1, discountPercent: 0, isActive: true });
    setSavedItems([]);
    setErrors({});
    setIsModalOpen(true);
  };

  const openEdit = (record: Discount) => {
    setEditing(record);
    setViewing(null);
    setForm({
      discountGroup: record.discountGroup,
      effectiveFrom: record.effectiveFrom ? record.effectiveFrom.split('T')[0] : '',
      effectiveTo: record.effectiveTo ? record.effectiveTo.split('T')[0] : '',
      quantityFrom: record.quantityFrom,
      discountPercent: record.discountPercent,
      isActive: record.isActive,
    });
    setSavedItems(record.items.map(i => ({
      itemId: typeof i.itemId === 'string' ? i.itemId : i.itemId?._id,
      itemCode: typeof i.itemId === 'object' ? i.itemId?.itemCode : '',
      itemName: typeof i.itemId === 'object' ? i.itemId?.itemName : '',
      unit: typeof i.itemId === 'object' ? i.itemId?.unit : '',
    })));
    setErrors({});
    setIsModalOpen(true);
  };

  const openView = (record: Discount) => {
    setViewing(record);
    setEditing(null);
    setIsModalOpen(true);
  };

  const handleItemSearch = (val: string) => {
    setItemSearch(val);
    if (val.length < 1) { setItemSearchResults(activeItems.slice(0, 20)); return; }
    const q = val.toLowerCase();
    setItemSearchResults(
      activeItems.filter((i: any) =>
        i.itemCode?.toLowerCase().includes(q) || i.itemName?.toLowerCase().includes(q)
      ).slice(0, 20)
    );
  };

  const addItem = (item: any) => {
    if (savedItems.some(s => s.itemId === item._id)) {
      toast.error('Item already added');
      setItemSearch('');
      setItemSearchResults([]);
      setShowItemLov(false);
      return;
    }
    setSavedItems(prev => [...prev, {
      itemId: item._id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      unit: item.unit,
    }]);
    setItemSearch('');
    setItemSearchResults([]);
    setShowItemLov(false);
  };

  const removeItem = (idx: number) => {
    setSavedItems(savedItems.filter((_, i) => i !== idx));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.discountGroup.trim()) e.discountGroup = 'Group name is required';
    if (!form.effectiveFrom) e.effectiveFrom = 'Required';
    if (!form.effectiveTo) e.effectiveTo = 'Required';
    if (form.effectiveFrom && form.effectiveTo && new Date(form.effectiveFrom) > new Date(form.effectiveTo)) e.effectiveTo = 'Must be after start date';
    if (!form.quantityFrom || form.quantityFrom < 1) e.quantityFrom = 'Min 1';
    if (!form.discountPercent || form.discountPercent <= 0) e.discountPercent = 'Required';
    if (savedItems.length === 0) e.items = 'Add at least one item';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    try {
      const payload = {
        ...form,
        items: savedItems.map(s => ({ itemId: s.itemId })),
      };
      if (editing) {
        await moduleAPI.updateDiscount(editing._id, payload);
        toast.success('Updated successfully');
      } else {
        await moduleAPI.createDiscount(payload);
        toast.success('Created successfully');
      }
      setIsModalOpen(false);
      loadList();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Save failed');
    } finally { setIsSaving(false); }
  };

  const columns = [
    { key: 'discountGroup', label: 'Group Name' },
    {
      key: 'effectiveFrom', label: 'Effective from Date',
      render: (r: Discount) => r.effectiveFrom ? new Date(r.effectiveFrom).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase() : '-',
    },
    {
      key: 'effectiveTo', label: 'Effective To Date',
      render: (r: Discount) => r.effectiveTo ? new Date(r.effectiveTo).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase() : '-',
    },
    {
      key: 'isActive', label: 'Status',
      render: (r: Discount) => (
        <span className={`px-2 py-1 text-xs rounded-full ${r.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {r.isActive ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions', label: 'Actions',
      render: (r: Discount) => (
        <div className="flex gap-2">
          <button onClick={() => openView(r)} className="text-blue-600 hover:text-blue-800 text-sm">View</button>
          {perm.canEdit && <button onClick={() => openEdit(r)} className="text-green-600 hover:text-green-800 text-sm">Edit</button>}
        </div>
      ),
    },
  ];

  const isViewOnly = viewing !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Discount Master List</h1>
        <div className="flex gap-3">
          {perm.canCreate && <Button onClick={openCreate}>+ Create</Button>}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow border">
        <Table columns={columns} data={list} isLoading={isLoading} />
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isViewOnly ? 'Discount Details' : editing ? 'Edit Discount' : 'Discount Master'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Discount Group <span className="text-red-500">*</span></label>
              <input type="text" value={form.discountGroup} onChange={e => setForm({ ...form, discountGroup: e.target.value })}
                disabled={isViewOnly} className={`w-full border rounded-lg px-3 py-2 text-sm ${isViewOnly ? 'bg-gray-50' : ''} ${errors.discountGroup ? 'border-red-500' : 'border-gray-300'}`} />
              {errors.discountGroup && <p className="text-red-500 text-xs mt-1">{errors.discountGroup}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Effective From Date <span className="text-red-500">*</span></label>
              <input type="date" value={form.effectiveFrom} onChange={e => setForm({ ...form, effectiveFrom: e.target.value })}
                disabled={isViewOnly} className={`w-full border rounded-lg px-3 py-2 text-sm ${isViewOnly ? 'bg-gray-50' : ''} ${errors.effectiveFrom ? 'border-red-500' : 'border-gray-300'}`} />
              {errors.effectiveFrom && <p className="text-red-500 text-xs mt-1">{errors.effectiveFrom}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Effective To Date <span className="text-red-500">*</span></label>
              <input type="date" value={form.effectiveTo} onChange={e => setForm({ ...form, effectiveTo: e.target.value })}
                disabled={isViewOnly} className={`w-full border rounded-lg px-3 py-2 text-sm ${isViewOnly ? 'bg-gray-50' : ''} ${errors.effectiveTo ? 'border-red-500' : 'border-gray-300'}`} />
              {errors.effectiveTo && <p className="text-red-500 text-xs mt-1">{errors.effectiveTo}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={form.isActive === true} onChange={() => setForm({ ...form, isActive: true })} disabled={isViewOnly} className="h-4 w-4" />
                  <span className="text-sm">Active</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={form.isActive === false} onChange={() => setForm({ ...form, isActive: false })} disabled={isViewOnly} className="h-4 w-4" />
                  <span className="text-sm">Inactive</span>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity From <span className="text-red-500">*</span></label>
              <input type="number" min={1} value={form.quantityFrom} onChange={e => setForm({ ...form, quantityFrom: parseInt(e.target.value) || 1 })}
                disabled={isViewOnly} className={`w-full border rounded-lg px-3 py-2 text-sm ${isViewOnly ? 'bg-gray-50' : ''} ${errors.quantityFrom ? 'border-red-500' : 'border-gray-300'}`} />
              {errors.quantityFrom && <p className="text-red-500 text-xs mt-1">{errors.quantityFrom}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Discount % <span className="text-red-500">*</span></label>
              <input type="number" min={0} max={100} step={0.5} value={form.discountPercent} onChange={e => setForm({ ...form, discountPercent: parseFloat(e.target.value) || 0 })}
                disabled={isViewOnly} className={`w-full border rounded-lg px-3 py-2 text-sm ${isViewOnly ? 'bg-gray-50' : ''} ${errors.discountPercent ? 'border-red-500' : 'border-gray-300'}`} />
              {errors.discountPercent && <p className="text-red-500 text-xs mt-1">{errors.discountPercent}</p>}
            </div>
          </div>

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-700">*Discount Applicable only Item wise.</p>
          </div>

          {!isViewOnly && (
            <div className="relative" ref={loRef}>
              <label className="block text-sm font-medium text-gray-700 mb-1">Add Item</label>
              <input type="text" value={itemSearch} onChange={e => handleItemSearch(e.target.value)}
                onFocus={() => { setItemSearchResults(activeItems.slice(0, 20)); setShowItemLov(true); }}
                placeholder="Search item to add..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              {showItemLov && itemSearchResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {itemSearchResults.map((item: any) => (
                    <button key={item._id} type="button" onClick={() => addItem(item)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-0">
                      <span className="font-medium">{item.itemCode}</span>
                      <span className="ml-2 text-gray-600">{item.itemName}</span>
                    </button>
                  ))}
                </div>
              )}
              {errors.items && <p className="text-red-500 text-xs mt-1">{errors.items}</p>}
            </div>
          )}

          {savedItems.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-3 py-2 font-medium text-gray-500 w-12">Sr.</th>
                    <th className="px-3 py-2 font-medium text-gray-500">Item Code</th>
                    <th className="px-3 py-2 font-medium text-gray-500">Item Name</th>
                    <th className="px-3 py-2 font-medium text-gray-500">Unit</th>
                    {!isViewOnly && <th className="px-3 py-2 font-medium text-gray-500 w-16">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {savedItems.map((item, idx) => (
                    <tr key={idx} className="border-t hover:bg-gray-50">
                      <td className="px-3 py-2">{idx + 1}</td>
                      <td className="px-3 py-2">{item.itemCode}</td>
                      <td className="px-3 py-2">{item.itemName}</td>
                      <td className="px-3 py-2">{item.unit}</td>
                      {!isViewOnly && (
                        <td className="px-3 py-2">
                          <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 text-sm">Remove</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>{isViewOnly ? 'Close' : 'Cancel'}</Button>
            {!isViewOnly && <Button onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save'}</Button>}
          </div>
        </div>
      </Modal>
    </div>
  );
}
