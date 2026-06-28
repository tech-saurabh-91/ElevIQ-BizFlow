'use client';

import { useEffect, useState } from 'react';
import { moduleAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import toast from 'react-hot-toast';

const SCHEME_TYPES = [
  { value: 'free_promotional', label: 'Free Promotional' },
  { value: 'return', label: 'Return' },
];

export default function SchemesPage() {
  const perm = usePermission('/masters/schemes');
  const [schemes, setSchemes] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [selectedFreeItemIds, setSelectedFreeItemIds] = useState<string[]>([]);
  const [freeItemQtys, setFreeItemQtys] = useState<Record<string, number>>({});
  const [formData, setFormData] = useState({
    schemeName: '',
    schemeType: 'free_promotional',
    schemeQty: '1',
    effectiveStartDate: '',
    effectiveEndDate: '',
  });

  useEffect(() => { fetchSchemes(); fetchItems(); }, []);

  const fetchSchemes = async () => {
    try { const res = await moduleAPI.getSchemes(); setSchemes(res.data.data); } catch { toast.error('Failed'); } finally { setIsLoading(false); }
  };

  const fetchItems = async () => {
    try { const res = await moduleAPI.getItems(); setItems(res.data.data); } catch {}
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedItemIds.length === 0) { toast.error('Please select at least one item'); return; }
    if (formData.schemeType === 'free_promotional' && selectedFreeItemIds.length === 0) {
      toast.error('Please select at least one free item'); return;
    }
    setErrors({}); setIsSaving(true);
    const schemeItems = selectedItemIds.map(id => ({ itemId: id, isActive: true }));
    const freeItems = selectedFreeItemIds.map(id => ({
      itemId: id,
      freeQty: freeItemQtys[id] || 1,
    }));

    try {
      const payload = { ...formData, items: schemeItems, freeItems };
      if (editing) { await moduleAPI.updateScheme(editing._id, payload); toast.success('Updated'); }
      else { await moduleAPI.createScheme(payload); toast.success('Created'); }
      setIsModalOpen(false); setEditing(null); resetForm(); fetchSchemes();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Failed'); setErrors({ submit: err.response?.data?.message || err.message || 'Failed' }); } finally { setIsSaving(false); }
  };

  const handleEdit = (s: any) => {
    setEditing(s);
    setFormData({
      schemeName: s.schemeName,
      schemeType: s.schemeType || 'free_promotional',
      schemeQty: String(s.schemeQty || 1),
      effectiveStartDate: s.effectiveStartDate ? s.effectiveStartDate.split('T')[0] : '',
      effectiveEndDate: s.effectiveEndDate ? s.effectiveEndDate.split('T')[0] : '',
    });
    const itemIds = (s.items || []).map((i: any) => typeof i.itemId === 'string' ? i.itemId : i.itemId?._id || i._id);
    const freeIds = (s.freeItems || []).map((i: any) => typeof i.itemId === 'string' ? i.itemId : i.itemId?._id || i._id);
    const qtys: Record<string, number> = {};
    (s.freeItems || []).forEach((fi: any) => {
      const id = typeof fi.itemId === 'string' ? fi.itemId : fi.itemId?._id || fi._id;
      qtys[id] = fi.freeQty || 1;
    });
    setSelectedItemIds(itemIds);
    setSelectedFreeItemIds(freeIds);
    setFreeItemQtys(qtys);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this scheme?')) return;
    try { await moduleAPI.deleteScheme(id); toast.success('Deleted'); fetchSchemes(); } catch { toast.error('Failed'); }
  };

  const resetForm = () => {
    setFormData({ schemeName: '', schemeType: 'free_promotional', schemeQty: '1', effectiveStartDate: '', effectiveEndDate: '' });
    setSelectedItemIds([]);
    setSelectedFreeItemIds([]);
    setFreeItemQtys({});
  };

  const toggleItem = (id: string) => {
    setSelectedItemIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleFreeItem = (id: string) => {
    setSelectedFreeItemIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      if (!prev.includes(id)) {
        setFreeItemQtys(q => ({ ...q, [id]: q[id] || 1 }));
      }
      return next;
    });
  };

  const toggleAllItems = () => {
    const allSelected = items.every(c => selectedItemIds.includes(c._id));
    if (allSelected) setSelectedItemIds([]);
    else setSelectedItemIds(items.map(c => c._id));
  };

  const toggleAllFreeItems = () => {
    const allSelected = items.every(c => selectedFreeItemIds.includes(c._id));
    if (allSelected) { setSelectedFreeItemIds([]); setFreeItemQtys({}); }
    else {
      setSelectedFreeItemIds(items.map(c => c._id));
      const qtys: Record<string, number> = {};
      items.forEach(i => { qtys[i._id] = freeItemQtys[i._id] || 1; });
      setFreeItemQtys(qtys);
    }
  };

  const columns = [
    { key: 'scheme', label: 'Scheme', render: (s: any) => <div><p className="font-medium">{s.schemeName}</p><p className="text-sm text-gray-500">{s.schemeCode}</p></div> },
    { key: 'schemeType', label: 'Type', render: (s: any) => <span className="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-800 capitalize">{SCHEME_TYPES.find(t => t.value === s.schemeType)?.label || s.schemeType}</span> },
    { key: 'schemeQty', label: 'Qty' },
    { key: 'effectiveStartDate', label: 'Start Date', render: (s: any) => s.effectiveStartDate ? new Date(s.effectiveStartDate).toLocaleDateString() : '-' },
    { key: 'effectiveEndDate', label: 'End Date', render: (s: any) => s.effectiveEndDate ? new Date(s.effectiveEndDate).toLocaleDateString() : '-' },
    { key: 'isActive', label: 'Active', render: (s: any) => <span className={`px-2 py-1 text-xs rounded-full ${s.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{s.isActive ? 'Yes' : 'No'}</span> },
    { key: 'actions', label: 'Actions', render: (s: any) => <div className="flex space-x-2">{perm.canEdit && <button onClick={() => handleEdit(s)} className="text-blue-600">Edit</button>}{perm.canDelete && <button onClick={() => handleDelete(s._id)} className="text-red-600">Delete</button>}</div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Schemes</h1>
        {perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Add Scheme</Button>}
      </div>
      <Table columns={columns} data={schemes} isLoading={isLoading} />
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditing(null); resetForm(); }} title={editing ? 'Edit Scheme' : 'Add Scheme'} size="xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{errors.submit}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Scheme Name" required value={formData.schemeName} onChange={(e: any) => setFormData({ ...formData, schemeName: e.target.value })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Scheme Type <span className="text-red-500">*</span></label>
              <select value={formData.schemeType} onChange={(e) => setFormData({ ...formData, schemeType: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500" required>
                {SCHEME_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Scheme Qty" type="number" required min="1" value={formData.schemeQty} onChange={(e: any) => setFormData({ ...formData, schemeQty: e.target.value })} />
            <Input label="Effective Start Date" type="date" required value={formData.effectiveStartDate} onChange={(e: any) => setFormData({ ...formData, effectiveStartDate: e.target.value })} />
            <Input label="Effective End Date" type="date" required value={formData.effectiveEndDate} onChange={(e: any) => setFormData({ ...formData, effectiveEndDate: e.target.value })} />
          </div>

          {/* Two tables: Items and Free Items */}
          <div className="grid grid-cols-2 gap-4">
            {/* Left: Select Items */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 border-b flex items-center justify-between">
                <h3 className="font-medium text-sm">Items</h3>
                <span className="text-xs text-gray-500">{selectedItemIds.length} selected</span>
              </div>
              <div className="max-h-56 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left w-10">
                        <input type="checkbox" checked={items.length > 0 && items.every(c => selectedItemIds.includes(c._id))} onChange={toggleAllItems} className="rounded" />
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Item Code</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Item Name</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">No items</td></tr>
                    ) : items.map(item => (
                      <tr key={item._id} className={`hover:bg-blue-50 cursor-pointer ${selectedItemIds.includes(item._id) ? 'bg-blue-50' : ''}`}
                        onClick={() => toggleItem(item._id)}>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selectedItemIds.includes(item._id)}
                            onChange={() => toggleItem(item._id)} onClick={(e) => e.stopPropagation()} className="rounded" />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{item.itemCode}</td>
                        <td className="px-3 py-2">{item.itemName}</td>
                        <td className="px-3 py-2"><span className={`px-2 py-0.5 text-xs rounded-full ${item.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{item.isActive ? 'Yes' : 'No'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right: Select Free Items (only for free_promotional) */}
            {formData.schemeType === 'free_promotional' ? (
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 border-b flex items-center justify-between">
                  <h3 className="font-medium text-sm">Scheme Free Items</h3>
                  <span className="text-xs text-gray-500">{selectedFreeItemIds.length} selected | Total {Object.values(freeItemQtys).reduce((a, b) => a + (b || 0), 0)}</span>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left w-10">
                          <input type="checkbox" checked={items.length > 0 && items.every(c => selectedFreeItemIds.includes(c._id))} onChange={toggleAllFreeItems} className="rounded" />
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Item Code</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Scheme Free Item</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 w-20">Free Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {items.length === 0 ? (
                        <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">No items</td></tr>
                      ) : items.map(item => {
                        const isSelected = selectedFreeItemIds.includes(item._id);
                        return (
                          <tr key={item._id} className={`${isSelected ? 'bg-yellow-50' : 'hover:bg-blue-50'} cursor-pointer`}
                            onClick={() => toggleFreeItem(item._id)}>
                            <td className="px-3 py-2">
                              <input type="checkbox" checked={isSelected}
                                onChange={() => toggleFreeItem(item._id)} onClick={(e) => e.stopPropagation()} className="rounded" />
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{item.itemCode}</td>
                            <td className="px-3 py-2">{item.itemName}</td>
                            <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                              {isSelected ? (
                                <input type="number" min="1" value={freeItemQtys[item._id] || 1}
                                  onChange={(e) => setFreeItemQtys(q => ({ ...q, [item._id]: Number(e.target.value) || 1 }))}
                                  className="w-16 px-2 py-1 border border-gray-300 rounded text-sm" />
                              ) : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden flex items-center justify-center bg-gray-50">
                <p className="text-gray-400 text-sm">Return scheme - no free items needed</p>
              </div>
            )}
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
