'use client';

import { useEffect, useState, useRef } from 'react';
import { moduleAPI, masterAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';

type AdjustmentItem = {
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  sfaQty: number;
  addSub: 'add' | 'subtract';
  adjustQty: number;
};

type Adjustment = {
  _id: string;
  adjustmentCode: string;
  adjustmentDate: string;
  warehouseId: { _id: string; warehouseName: string; warehouseCode: string };
  adjustmentMode: string;
  remarks: string;
  items: AdjustmentItem[];
  totalItems: number;
  createdBy: { _id: string; firstName: string; lastName: string; email: string };
};

export default function StockAdjustmentPage() {
  const perm = usePermission('/masters/stock-adjustment');
  const [list, setList] = useState<Adjustment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewing, setViewing] = useState<Adjustment | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'main' | 'items'>('main');
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [activeItems, setActiveItems] = useState<any[]>([]);
  const [stockSummaries, setStockSummaries] = useState<any[]>([]);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItemIdx, setEditingItemIdx] = useState<number | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [itemSearchResults, setItemSearchResults] = useState<any[]>([]);
  const [showItemLov, setShowItemLov] = useState(false);
  const [modalMessage, setModalMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mainForm, setMainForm] = useState({
    warehouseId: '',
    adjustmentDate: new Date().toISOString().split('T')[0],
    adjustmentMode: 'manual',
    remarks: '',
  });

  const [itemForm, setItemForm] = useState<AdjustmentItem>({
    itemId: '', itemCode: '', itemName: '', unit: '', sfaQty: 0, addSub: 'add', adjustQty: 1,
  });

  const [savedItems, setSavedItems] = useState<AdjustmentItem[]>([]);
  const [isUploaded, setIsUploaded] = useState(false);
  const [templateError, setTemplateError] = useState('');

  useEffect(() => { loadList(); loadDropdowns(); }, []);

  const loadList = async () => {
    try {
      const res = await moduleAPI.getStockAdjustments({ limit: 200 });
      setList(res.data.data || []);
    } catch { toast.error('Failed to load data'); } finally { setIsLoading(false); }
  };

  const loadDropdowns = async () => {
    try {
      const [whRes, itemRes] = await Promise.all([
        masterAPI.getWarehouses({ limit: 500 }).catch(() => ({ data: { data: [] } })),
        moduleAPI.getItems({ limit: 500 }).catch(() => ({ data: { data: [] } })),
      ]);
      setWarehouses(whRes.data.data || []);
      setItems(itemRes.data.data || []);
      setActiveItems((itemRes.data.data || []).filter((i: any) => i.isActive !== false));
    } catch {}
  };

  const loadStockSummary = async (warehouseId: string) => {
    if (!warehouseId) { setStockSummaries([]); return; }
    try {
      const res = await moduleAPI.getStockSummaries({ warehouseId, limit: 500 });
      setStockSummaries(res.data.data || []);
    } catch { setStockSummaries([]); }
  };

  const getSummaryQty = (itemId: string) => {
    const s = stockSummaries.find((ss: any) => {
      const id = typeof ss.itemId === 'object' ? ss.itemId._id : ss.itemId;
      return id === itemId;
    });
    return s ? s.balanceQty : 0;
  };

  const openCreate = () => {
    setViewing(null);
    setMainForm({ warehouseId: '', adjustmentDate: new Date().toISOString().split('T')[0], adjustmentMode: 'manual', remarks: '' });
    setSavedItems([]);
    setIsUploaded(false);
    setActiveTab('main');
    setErrors({});
    setIsModalOpen(true);
  };

  const openView = (record: Adjustment) => {
    setViewing(record);
    setIsModalOpen(true);
  };

  const openAddItem = () => {
    if (!mainForm.warehouseId) { toast.error('Please select the warehouse first'); return; }
    setEditingItemIdx(null);
    setItemForm({ itemId: '', itemCode: '', itemName: '', unit: '', sfaQty: 0, addSub: 'add', adjustQty: 1 });
    setItemSearch('');
    setItemSearchResults([]);
    setShowItemLov(true);
    setIsItemModalOpen(true);
  };

  const openEditItem = (idx: number) => {
    const item = savedItems[idx];
    setEditingItemIdx(idx);
    setItemForm({ ...item });
    setItemSearch('');
    setItemSearchResults([]);
    setShowItemLov(false);
    setIsItemModalOpen(true);
  };

  const selectItem = (item: any) => {
    const sfaQty = getSummaryQty(item._id);
    setItemForm({
      itemId: item._id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      unit: item.unit,
      sfaQty,
      addSub: 'add',
      adjustQty: 1,
    });
    setShowItemLov(false);
    setItemSearch('');
    setItemSearchResults([]);
  };

  const handleItemSearch = (val: string) => {
    setItemSearch(val);
    if (val.length < 1) { setItemSearchResults(activeItems.slice(0, 20)); return; }
    const q = val.toLowerCase();
    setItemSearchResults(activeItems.filter((i: any) => i.itemCode?.toLowerCase().includes(q) || i.itemName?.toLowerCase().includes(q)).slice(0, 20));
  };

  const openItemLov = () => {
    if (!mainForm.warehouseId) { setTemplateError('Please select the warehouse first'); return; }
    setEditingItemIdx(null);
    setItemForm({ itemId: '', itemCode: '', itemName: '', unit: '', sfaQty: 0, addSub: 'add', adjustQty: 1 });
    setItemSearch('');
    setItemSearchResults(activeItems.slice(0, 20));
    setShowItemLov(true);
    setIsItemModalOpen(true);
  };

  const saveItem = () => {
    if (!itemForm.itemId) { toast.error('Please select an item'); return; }
    if (!itemForm.adjustQty || itemForm.adjustQty < 1) { toast.error('Adjust qty must be at least 1'); return; }
    if (itemForm.addSub === 'subtract' && itemForm.adjustQty > itemForm.sfaQty) {
      toast.error(`Cannot subtract more than available stock (${itemForm.sfaQty})`);
      return;
    }
    const isDuplicate = savedItems.some((s, i) => s.itemId === itemForm.itemId && i !== editingItemIdx);
    if (isDuplicate) { toast.error('This item is already added. Please remove the existing entry first.'); return; }
    const updated = [...savedItems];
    if (editingItemIdx !== null) {
      updated[editingItemIdx] = itemForm;
    } else {
      updated.push(itemForm);
    }
    setSavedItems(updated);
    setIsItemModalOpen(false);
  };

  const removeItem = (idx: number) => {
    setSavedItems(savedItems.filter((_, i) => i !== idx));
  };

  const downloadTemplate = () => {
    if (!mainForm.warehouseId) { setTemplateError('Please select the warehouse first'); return; }
    setTemplateError('');

    const rows = activeItems.map((item: any) => ({
      'Item Code': item.itemCode,
      'Item Name': item.itemName,
      'Item Description': item.itemDescription || '',
      'Unit': item.unit,
      'Type (A/S)': '',
      'Qty': '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 20 }, { wch: 30 }, { wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stock Adjustment Template');
    XLSX.writeFile(wb, 'Stock_Adjustment_Template.xlsx');
    toast.success('Template downloaded');
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!mainForm.warehouseId) { setTemplateError('Please select the warehouse first'); e.target.value = ''; return; }
    setTemplateError('');
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<any>(ws);

        if (rows.length === 0) { setModalMessage({ type: 'error', text: 'Excel is empty' }); return; }

        const uploadedItems: AdjustmentItem[] = [];
        const missingItems: string[] = [];
        const invalidRows: number[] = [];

        rows.forEach((row, idx) => {
          const itemCode = String(row['Item Code'] || '').trim();
          const type = String(row['Type (A/S)'] || '').trim().toUpperCase();
          const qty = Number(row['Qty']);

          if (!itemCode || !type || !qty || qty < 1) {
            invalidRows.push(idx + 2);
            return;
          }

          const matchedItem = activeItems.find((i: any) => i.itemCode?.trim().toLowerCase() === itemCode.toLowerCase());
          if (!matchedItem) {
            missingItems.push(itemCode);
            return;
          }

          if (type !== 'A' && type !== 'S') {
            invalidRows.push(idx + 2);
            return;
          }

          uploadedItems.push({
            itemId: matchedItem._id,
            itemCode: matchedItem.itemCode,
            itemName: matchedItem.itemName,
            unit: matchedItem.unit,
            sfaQty: getSummaryQty(matchedItem._id),
            addSub: type === 'A' ? 'add' : 'subtract',
            adjustQty: qty,
          });
        });

        const errors: string[] = [];
        const duplicateItems: string[] = [];
        if (invalidRows.length > 0) errors.push(`Invalid data at rows: ${invalidRows.join(', ')}`);
        if (missingItems.length > 0) errors.push(`Items not found: ${missingItems.join(', ')}`);

        const existingIds = new Set(savedItems.map(s => s.itemId));
        const seenIds = new Set<string>();
        const uniqueItems: AdjustmentItem[] = [];
        for (const item of uploadedItems) {
          if (existingIds.has(item.itemId) || seenIds.has(item.itemId)) {
            duplicateItems.push(item.itemCode);
          } else {
            seenIds.add(item.itemId);
            uniqueItems.push(item);
          }
        }
        if (duplicateItems.length > 0) errors.push(`Duplicate items skipped: ${duplicateItems.join(', ')}`);

        if (errors.length > 0 && uniqueItems.length === 0) {
          setModalMessage({ type: 'error', text: errors.join('. ') });
        } else if (errors.length > 0 && uniqueItems.length > 0) {
          setModalMessage({ type: 'error', text: `${errors.join('. ')}. ${uniqueItems.length} items loaded.` });
        }

        if (uniqueItems.length > 0) {
          setSavedItems(prev => [...prev, ...uniqueItems]);
          setIsUploaded(true);
          if (errors.length === 0) {
            setModalMessage({ type: 'success', text: `${uniqueItems.length} items uploaded successfully` });
            setTimeout(() => setModalMessage(null), 3000);
          }
        }
      } catch {
        setModalMessage({ type: 'error', text: 'Failed to parse Excel file' });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleSave = async () => {
    if (!mainForm.warehouseId) { setErrors({ warehouseId: 'Please select a warehouse' }); setActiveTab('main'); return; }
    if (!mainForm.remarks?.trim()) { setErrors({ remarks: 'Remarks is required' }); setActiveTab('main'); return; }
    if (savedItems.length === 0) { setErrors({ items: 'Please add at least one item' }); setActiveTab('items'); return; }

    setIsSaving(true);
    try {
      const payload = {
        ...mainForm,
        items: savedItems.map(i => ({
          itemId: i.itemId,
          itemCode: i.itemCode,
          itemName: i.itemName,
          unit: i.unit,
          sfaQty: i.sfaQty,
          addSub: i.addSub,
          adjustQty: i.adjustQty,
        })),
      };

      await moduleAPI.createStockAdjustment(payload);
      setModalMessage({ type: 'success', text: 'Created successfully' });
      setTimeout(() => { setIsModalOpen(false); setModalMessage(null); loadList(); }, 1500);
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Operation failed';
      const serverErrors = err.response?.data?.errors;
      setModalMessage({ type: 'error', text: serverErrors ? serverErrors.join(', ') : msg });
    } finally { setIsSaving(false); }
  };

  const columns = [
    { key: 'adjustmentCode', label: 'Adjustment No.' },
    { key: 'adjustmentDate', label: 'Adjustment Date', render: (r: Adjustment) => r.adjustmentDate ? new Date(r.adjustmentDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase() : '-' },
    { key: 'warehouseId', label: 'Warehouse', render: (r: Adjustment) => r.warehouseId?.warehouseName || '-' },
    { key: 'remarks', label: 'Reason' },
    { key: 'createdBy', label: 'Created By', render: (r: Adjustment) => r.createdBy ? `${r.createdBy.firstName} ${r.createdBy.lastName}` : '-' },
    {
      key: 'actions', label: 'Actions',
      render: (r: Adjustment) => (
        <button onClick={() => openView(r)} className="text-blue-600 hover:text-blue-800 text-sm">View</button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Stock Adjustment</h1>
        <div className="flex gap-2">
          {perm.canCreate && <Button onClick={openCreate} className="flex items-center gap-1">+ Create</Button>}
          <Button onClick={() => window.history.back()} variant="secondary" className="flex items-center gap-1">Back</Button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <Table columns={columns} data={list} isLoading={isLoading} />
      </div>

      {/* Main Modal */}
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setModalMessage(null); setViewing(null); }} title={viewing ? 'Stock Adjustment Details' : 'Stock Adjustment'} size="xl">
        {viewing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Adjustment No.</label><p className="text-sm">{viewing.adjustmentCode}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Adjustment Date</label><p className="text-sm">{new Date(viewing.adjustmentDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase()}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Warehouse</label><p className="text-sm">{viewing.warehouseId?.warehouseName || '-'}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Adjustment Type</label><p className="text-sm capitalize">{viewing.adjustmentMode}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label><p className="text-sm">{viewing.remarks || '-'}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Created By</label><p className="text-sm">{viewing.createdBy ? `${viewing.createdBy.firstName} ${viewing.createdBy.lastName}` : '-'}</p></div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Items</label>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">Item Code</th>
                      <th className="px-3 py-2 text-left">Item Description</th>
                      <th className="px-3 py-2 text-left">Unit</th>
                      <th className="px-3 py-2 text-right">SFA Qty</th>
                      <th className="px-3 py-2 text-center">Add/Sub</th>
                      <th className="px-3 py-2 text-right">Adjust Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewing.items.map((item: AdjustmentItem, idx: number) => (
                      <tr key={idx} className="border-t">
                        <td className="px-3 py-2">{item.itemCode}</td>
                        <td className="px-3 py-2">{item.itemName}</td>
                        <td className="px-3 py-2">{item.unit}</td>
                        <td className="px-3 py-2 text-right">{item.sfaQty}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-0.5 text-xs rounded-full ${item.addSub === 'add' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {item.addSub === 'add' ? 'Add' : 'Subtract'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">{item.adjustQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-end mt-4 pt-4 border-t">
              <Button onClick={() => { setIsModalOpen(false); setViewing(null); }} variant="secondary">Close</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex border-b mb-4">
              <button className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'main' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500'}`} onClick={() => { setActiveTab('main'); setModalMessage(null); }}>Main Info</button>
              <button className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'items' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500'}`} onClick={() => { setActiveTab('items'); setModalMessage(null); if (mainForm.warehouseId && stockSummaries.length === 0) loadStockSummary(mainForm.warehouseId); }}>Item List</button>
            </div>

            {modalMessage && (
              <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${modalMessage.type === 'success' ? 'bg-green-50 border border-green-300 text-green-700' : 'bg-red-50 border border-red-300 text-red-700'}`}>
                {modalMessage.text}
              </div>
            )}

            {activeTab === 'main' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Adjustment No.</label>
                    <input type="text" value="Auto-generated" disabled className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Adjustment Date</label>
                    <input type="date" value={mainForm.adjustmentDate} onChange={e => setMainForm({ ...mainForm, adjustmentDate: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse <span className="text-red-500">*</span></label>
                    <select value={mainForm.warehouseId} onChange={e => { setMainForm({ ...mainForm, warehouseId: e.target.value }); loadStockSummary(e.target.value); setTemplateError(''); }} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500" required>
                      <option value="">---Select To Warehouse ---</option>
                      {warehouses.map((w: any) => <option key={w._id} value={w._id}>{w.warehouseName}</option>)}
                    </select>
                    {errors.warehouseId && <p className="text-red-500 text-xs mt-1">{errors.warehouseId}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Adjustment Type</label>
                    <div className="flex items-center gap-6 mt-2">
                      <label className="flex items-center gap-2"><input type="radio" name="adjustmentMode" value="manual" checked={mainForm.adjustmentMode === 'manual'} onChange={e => { setMainForm({ ...mainForm, adjustmentMode: e.target.value }); setTemplateError(''); }} /> Manual</label>
                      <label className="flex items-center gap-2"><input type="radio" name="adjustmentMode" value="upload" checked={mainForm.adjustmentMode === 'upload'} onChange={e => { setMainForm({ ...mainForm, adjustmentMode: e.target.value }); setTemplateError(''); }} /> Upload</label>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Remarks <span className="text-red-500">*</span></label>
                  <textarea value={mainForm.remarks} onChange={e => setMainForm({ ...mainForm, remarks: e.target.value })} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500" />
                  {errors.remarks && <p className="text-red-500 text-xs mt-1">{errors.remarks}</p>}
                </div>
              </div>
            )}

            {activeTab === 'items' && (
              <div className="space-y-4">
                {errors.items && <p className="text-red-500 text-sm">{errors.items}</p>}

                {mainForm.adjustmentMode === 'upload' && !isUploaded && (
                  <div className="space-y-2">
                    <div className="flex gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <Button onClick={downloadTemplate} variant="secondary" className="flex items-center gap-1 text-sm">Download Sample Template</Button>
                      <Button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 text-sm">Upload Excel</Button>
                      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
                    </div>
                    {templateError && <p className="text-red-500 text-sm">{templateError}</p>}
                  </div>
                )}

                {mainForm.adjustmentMode === 'upload' && isUploaded && (
                  <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <span className="text-sm text-amber-700">Template uploaded. Items loaded below.</span>
                    <Button onClick={() => { setSavedItems([]); setIsUploaded(false); }} variant="secondary" className="text-sm px-3 py-1">Clear All Items</Button>
                  </div>
                )}

                {mainForm.adjustmentMode === 'manual' && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Button onClick={openItemLov} className="flex items-center gap-1">+ Add Item</Button>
                    </div>
                    {templateError && <p className="text-red-500 text-sm">{templateError}</p>}
                  </div>
                )}

                {savedItems.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left">Item Code</th>
                          <th className="px-3 py-2 text-left">Item Description</th>
                          <th className="px-3 py-2 text-left">Unit</th>
                          <th className="px-3 py-2 text-right">SFA Qty</th>
                          <th className="px-3 py-2 text-center">Add/Sub</th>
                          <th className="px-3 py-2 text-right">Adjust Qty</th>
                          <th className="px-3 py-2 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {savedItems.map((item, idx) => (
                          <tr key={idx} className="border-t hover:bg-gray-50">
                            <td className="px-3 py-2">{item.itemCode}</td>
                            <td className="px-3 py-2">{item.itemName}</td>
                            <td className="px-3 py-2">{item.unit}</td>
                            <td className="px-3 py-2 text-right">{item.sfaQty}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`px-2 py-0.5 text-xs rounded-full ${item.addSub === 'add' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                {item.addSub === 'add' ? 'Add' : 'Subtract'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">{item.adjustQty}</td>
                            <td className="px-3 py-2 text-center">
                              <button onClick={() => openEditItem(idx)} className="text-blue-600 hover:text-blue-800 text-xs mr-2">Edit</button>
                              <button onClick={() => removeItem(idx)} className="text-red-600 hover:text-red-800 text-xs">Remove</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between mt-6 pt-4 border-t">
              <Button onClick={() => { setIsModalOpen(false); setModalMessage(null); }} variant="secondary" className="flex items-center gap-1">Cancel</Button>
              <Button onClick={handleSave} disabled={isSaving} className="flex items-center gap-1">{isSaving ? 'Saving...' : 'Save'}</Button>
            </div>
          </>
        )}
      </Modal>

      {/* Item LOV Modal */}
      <Modal isOpen={isItemModalOpen} onClose={() => setIsItemModalOpen(false)} title="Stock Adjustment Item" size="lg">
        {showItemLov ? (
          <div className="space-y-4">
            <div className="relative">
              <input
                type="text"
                value={itemSearch}
                onChange={e => handleItemSearch(e.target.value)}
                onFocus={() => { if (itemSearchResults.length === 0) setItemSearchResults(activeItems.slice(0, 20)); }}
                placeholder="Search by Item Code or Name..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                autoFocus
              />
            </div>
            <div className="border rounded-lg max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">Item Code</th>
                    <th className="px-3 py-2 text-left">Item Name</th>
                    <th className="px-3 py-2 text-left">Unit</th>
                    <th className="px-3 py-2 text-center">Select</th>
                  </tr>
                </thead>
                <tbody>
                  {itemSearchResults.map((item: any) => (
                    <tr key={item._id} className="border-t hover:bg-blue-50 cursor-pointer" onClick={() => selectItem(item)}>
                      <td className="px-3 py-2">{item.itemCode}</td>
                      <td className="px-3 py-2">{item.itemName}</td>
                      <td className="px-3 py-2">{item.unit}</td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={(e) => { e.stopPropagation(); selectItem(item); }} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Select</button>
                      </td>
                    </tr>
                  ))}
                  {itemSearchResults.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-500">No items found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="space-y-4 bg-cyan-50 p-4 rounded-lg">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Item Code <span className="text-red-500">*</span></label>
                <div className="flex items-center gap-2">
                  <input type="text" value={itemForm.itemCode} disabled className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white" />
                  <button onClick={() => { setShowItemLov(true); setItemSearch(''); setItemSearchResults(activeItems.slice(0, 20)); }} className="text-slate-600 hover:text-slate-800 text-xs border px-2 py-2 rounded-lg bg-white">Change</button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Item Description</label>
                <input type="text" value={itemForm.itemName} disabled className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <input type="text" value={itemForm.unit} disabled className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SFA Qty</label>
                <input type="number" value={itemForm.sfaQty} disabled className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Add/Sub</label>
                <div className="flex items-center gap-6 mt-2">
                  <label className="flex items-center gap-2"><input type="radio" name="addSub" value="add" checked={itemForm.addSub === 'add'} onChange={() => setItemForm({ ...itemForm, addSub: 'add' })} /> Add</label>
                  <label className="flex items-center gap-2"><input type="radio" name="addSub" value="subtract" checked={itemForm.addSub === 'subtract'} onChange={() => setItemForm({ ...itemForm, addSub: 'subtract' })} /> Subtract</label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Adjust Qty</label>
                <input type="number" min="1" value={itemForm.adjustQty} onChange={e => setItemForm({ ...itemForm, adjustQty: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500" />
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t">
              <Button onClick={() => setIsItemModalOpen(false)} variant="secondary" className="flex items-center gap-1">Cancel</Button>
              <Button onClick={saveItem} className="flex items-center gap-1">Save</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
