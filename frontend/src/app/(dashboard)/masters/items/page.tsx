'use client';

import { useEffect, useState, useRef } from 'react';
import { moduleAPI, masterAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import { Item, TaxMaster, HsnMaster } from '@/types';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import toast from 'react-hot-toast';

export default function ItemsPage() {
  const perm = usePermission('/masters/items');
  const [items, setItems] = useState<Item[]>([]);
  const [taxes, setTaxes] = useState<TaxMaster[]>([]);
  const [hsns, setHsns] = useState<HsnMaster[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [subGroups, setSubGroups] = useState<any[]>([]);
  const [filteredSubGroups, setFilteredSubGroups] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [gstEnabled, setGstEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({
    itemName: '', itemDescription: '', category: '', brand: '', unit: 'pcs',
    unitPrice: '', costPrice: '', sellingPrice: '', taxRate: '', taxId: '', hsnId: '',
    hsnCode: '', minStock: '0', maxStock: '0', reorderLevel: '0', groupId: '', subGroupId: '',
    customerItemCode: '',
  });

  useEffect(() => {
    Promise.all([
      moduleAPI.getItems(),
      moduleAPI.getTaxes(),
      moduleAPI.getHsns(),
      moduleAPI.getItemGroups(),
      moduleAPI.getItemSubGroups(),
      moduleAPI.getParameters({ type: 'brand' }),
      moduleAPI.getParameters({ type: 'item_classification' }),
      moduleAPI.getParameters({ type: 'unit' }),
      masterAPI.getCompanyDetails(),
    ])
      .then(([i, t, h, g, sg, b, cat, u, c]) => {
        setItems(i.data.data);
        setTaxes(t.data.data);
        setHsns(h.data.data);
        setGroups(g.data.data);
        setSubGroups(sg.data.data);
        setBrands(b.data.data);
        setCategories(cat.data.data);
        setUnits(u.data.data);
        setGstEnabled(c.data.data?.gstEnabled || false);
      })
      .catch(() => toast.error('Failed'))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (formData.groupId) {
      setFilteredSubGroups(subGroups.filter(sg => (sg.groupId?._id || sg.groupId) === formData.groupId));
    } else {
      setFilteredSubGroups(subGroups);
    }
  }, [formData.groupId, subGroups]);

  const handleTaxSelect = (taxId: string) => {
    const tax = taxes.find(t => t._id === taxId);
    if (tax) setFormData({ ...formData, taxId, taxRate: String(tax.totalTaxPercent) });
    else setFormData({ ...formData, taxId: '', taxRate: '' });
  };

  const handleHsnSelect = (hsnId: string) => {
    const hsn = hsns.find(h => h._id === hsnId);
    if (hsn) {
      setFormData({ ...formData, hsnId, hsnCode: hsn.hsnCode, taxRate: String(hsn.totalTaxPercent) });
      if (hsn.cgstTaxId) setFormData(prev => ({ ...prev, hsnId, hsnCode: hsn.hsnCode, taxRate: String(hsn.totalTaxPercent), taxId: (hsn.cgstTaxId as any)?._id || '' }));
    } else setFormData({ ...formData, hsnId: '', hsnCode: '' });
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setImageFile(file); setImagePreview(URL.createObjectURL(file)); }
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.itemName.trim()) errs.itemName = 'Item name is required';
    if (!formData.unit) errs.unit = 'Unit is required';
    if (!formData.costPrice || Number(formData.costPrice) <= 0) errs.costPrice = 'Cost price must be greater than 0';
    if (!formData.sellingPrice || Number(formData.sellingPrice) <= 0) errs.sellingPrice = 'Selling price must be greater than 0';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      const payload = new FormData();
      payload.append('itemName', formData.itemName);
      payload.append('itemDescription', formData.itemDescription);
      payload.append('category', formData.category);
      payload.append('brand', formData.brand);
      payload.append('unit', formData.unit);
      payload.append('unitPrice', String(Number(formData.unitPrice)));
      payload.append('costPrice', String(Number(formData.costPrice)));
      payload.append('sellingPrice', String(Number(formData.sellingPrice)));
      payload.append('taxRate', String(Number(formData.taxRate)));
      if (formData.taxId) payload.append('taxId', formData.taxId);
      if (formData.hsnId) payload.append('hsnId', formData.hsnId);
      payload.append('hsnCode', formData.hsnCode);
      payload.append('minStock', String(Number(formData.minStock)));
      payload.append('maxStock', String(Number(formData.maxStock)));
      payload.append('reorderLevel', String(Number(formData.reorderLevel)));
      if (formData.groupId) payload.append('groupId', formData.groupId);
      if (formData.subGroupId) payload.append('subGroupId', formData.subGroupId);
      if (formData.customerItemCode) payload.append('customerItemCode', formData.customerItemCode);
      if (imageFile) payload.append('image', imageFile);

      if (editingItem) { await moduleAPI.updateItem(editingItem._id, payload); toast.success('Updated'); }
      else { await moduleAPI.createItem(payload); toast.success('Created'); }
      setIsModalOpen(false); setEditingItem(null); resetForm();
      const res = await moduleAPI.getItems(); setItems(res.data.data);
    } catch (err: any) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  const handleEdit = (item: Item) => {
    setEditingItem(item);
    setFormData({
      itemName: item.itemName, itemDescription: item.description || (item as any).itemDescription || '',
      category: item.category || '', brand: item.brand || '', unit: item.unit,
      unitPrice: String(item.unitPrice), costPrice: String(item.costPrice), sellingPrice: String(item.sellingPrice),
      taxRate: String(item.taxRate), taxId: (item as any).taxId?._id || (item as any).taxId || '',
      hsnId: (item as any).hsnId?._id || (item as any).hsnId || '', hsnCode: item.hsnCode || '',
      minStock: String(item.minStock), maxStock: String(item.maxStock), reorderLevel: String(item.reorderLevel),
      groupId: (item as any).groupId?._id || (item as any).groupId || '',
      subGroupId: (item as any).subGroupId?._id || (item as any).subGroupId || '',
      customerItemCode: (item as any).customerItemCode || '',
    });
    setImagePreview((item as any).image || '');
    setErrors({});
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete?')) return;
    try { await moduleAPI.deleteItem(id); toast.success('Deleted'); const res = await moduleAPI.getItems(); setItems(res.data.data); } catch { toast.error('Failed'); }
  };

  const resetForm = () => {
    setFormData({
      itemName: '', itemDescription: '', category: '', brand: '', unit: 'pcs',
      unitPrice: '', costPrice: '', sellingPrice: '', taxRate: '', taxId: '', hsnId: '',
      hsnCode: '', minStock: '0', maxStock: '0', reorderLevel: '0', groupId: '', subGroupId: '',
      customerItemCode: '',
    });
    setImageFile(null); setImagePreview(''); setErrors({});
  };

  const selectClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white';

  const columns = [
    { key: 'item', label: 'Item', render: (i: Item) => <div><p className="font-medium">{i.itemName}</p><p className="text-sm text-gray-500">{i.itemCode}</p></div> },
    { key: 'customerItemCode', label: 'Customer Code', render: (i: any) => i.customerItemCode || '-' },
    { key: 'group', label: 'Group', render: (i: any) => i.groupId?.groupName || '-' },
    { key: 'subGroup', label: 'Sub-Group', render: (i: any) => i.subGroupId?.subGroupName || '-' },
    { key: 'brand', label: 'Brand' },
    { key: 'unit', label: 'Unit' },
    { key: 'sellingPrice', label: 'Price', render: (i: Item) => `₹${i.sellingPrice.toLocaleString()}` },
    { key: 'taxRate', label: 'Tax', render: (i: Item) => `${i.taxRate}%` },
    { key: 'hsnCode', label: 'HSN' },
    { key: 'actions', label: 'Actions', render: (i: Item) => <div className="flex space-x-2">{perm.canEdit && <button onClick={() => handleEdit(i)} className="text-blue-600">Edit</button>}{perm.canDelete && <button onClick={() => handleDelete(i._id)} className="text-red-600">Delete</button>}</div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Items</h1>{perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Add Item</Button>}</div>
      <Table columns={columns} data={items} isLoading={isLoading} />
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingItem(null); setErrors({}); }} title={editingItem ? 'Edit Item' : 'Add Item'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm">{errors.submit}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Input label="Item Name" required value={formData.itemName} onChange={(e: any) => setFormData({ ...formData, itemName: e.target.value })} />
              {errors.itemName && <p className="text-red-500 text-xs mt-1">{errors.itemName}</p>}
            </div>
            <Input label="Customer Item Code" value={formData.customerItemCode} onChange={(e: any) => setFormData({ ...formData, customerItemCode: e.target.value })} placeholder="Customer's item code" />
          </div>

          <Input label="Description" value={formData.itemDescription} onChange={(e: any) => setFormData({ ...formData, itemDescription: e.target.value })} />

          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Group</label>
              <select value={formData.groupId} onChange={(e) => setFormData({ ...formData, groupId: e.target.value, subGroupId: '' })} className={selectClass}>
                <option value="">Select Group</option>{groups.map((g: any) => <option key={g._id} value={g._id}>{g.groupName}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Sub-Group</label>
              <select value={formData.subGroupId} onChange={(e) => setFormData({ ...formData, subGroupId: e.target.value })} className={selectClass}>
                <option value="">Select Sub-Group</option>{filteredSubGroups.map((sg: any) => <option key={sg._id} value={sg._id}>{sg.subGroupName}</option>)}
              </select></div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Brand</label>
              <select value={formData.brand} onChange={(e) => setFormData({ ...formData, brand: e.target.value })} className={selectClass}>
                <option value="">Select Brand</option>{brands.map((b: any) => <option key={b._id} value={b.parameterValue}>{b.parameterValue}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className={selectClass}>
                <option value="">Select Category</option>{categories.map((c: any) => <option key={c._id} value={c.parameterValue}>{c.parameterValue}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Unit <span className="text-red-500">*</span></label>
              {units.length > 0 ? (
                <select value={formData.unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value })} className={selectClass} required>
                  <option value="">Select Unit</option>{units.map((u: any) => <option key={u._id} value={u.parameterValue}>{u.parameterValue}</option>)}
                </select>
              ) : (
                <select value={formData.unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value })} className={selectClass} required>
                  <option value="pcs">Pieces</option><option value="kg">Kilogram</option><option value="ltr">Litre</option><option value="box">Box</option><option value="pack">Pack</option><option value="dozen">Dozen</option>
                </select>
              )}
              {errors.unit && <p className="text-red-500 text-xs mt-1">{errors.unit}</p>}
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              {gstEnabled ? 'Tax & HSN Configuration (GST Mode)' : 'Tax Configuration (Non-GST Mode)'}
            </h3>
            {gstEnabled ? (
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium mb-1">HSN Master</label><select value={formData.hsnId} onChange={(e) => handleHsnSelect(e.target.value)} className={selectClass}><option value="">Select HSN</option>{hsns.map(h => <option key={h._id} value={h._id}>{h.hsnCode} - {h.hsnDescription} ({h.totalTaxPercent}%)</option>)}</select></div>
                <div><label className="block text-sm font-medium mb-1">Tax Master (GST)</label><select value={formData.taxId} onChange={(e) => handleTaxSelect(e.target.value)} className={selectClass}><option value="">Select Tax</option>{taxes.map(t => <option key={t._id} value={t._id}>{t.taxName} - {t.totalTaxPercent}% ({t.gstType})</option>)}</select></div>
                <Input label="Tax Rate %" type="number" value={formData.taxRate} onChange={(e: any) => setFormData({ ...formData, taxRate: e.target.value })} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Tax / VAT on Sales</label><select value={formData.taxId} onChange={(e) => handleTaxSelect(e.target.value)} className={selectClass}><option value="">No Tax</option>{taxes.map(t => <option key={t._id} value={t._id}>{t.taxName} - {t.totalTaxPercent}%</option>)}</select></div>
                <Input label="Tax Rate %" type="number" value={formData.taxRate} onChange={(e: any) => setFormData({ ...formData, taxRate: e.target.value })} />
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Input label="Cost Price" type="number" required value={formData.costPrice} onChange={(e: any) => setFormData({ ...formData, costPrice: e.target.value })} />
              {errors.costPrice && <p className="text-red-500 text-xs mt-1">{errors.costPrice}</p>}
            </div>
            <div>
              <Input label="Selling Price" type="number" required value={formData.sellingPrice} onChange={(e: any) => setFormData({ ...formData, sellingPrice: e.target.value })} />
              {errors.sellingPrice && <p className="text-red-500 text-xs mt-1">{errors.sellingPrice}</p>}
            </div>
            <Input label="Unit Price" type="number" required value={formData.unitPrice} onChange={(e: any) => setFormData({ ...formData, unitPrice: e.target.value })} />
          </div>
          <div className="grid grid-cols-4 gap-4">
            <Input label="HSN Code" value={formData.hsnCode} onChange={(e: any) => setFormData({ ...formData, hsnCode: e.target.value })} />
            <Input label="Min Stock" type="number" value={formData.minStock} onChange={(e: any) => setFormData({ ...formData, minStock: e.target.value })} />
            <Input label="Max Stock" type="number" value={formData.maxStock} onChange={(e: any) => setFormData({ ...formData, maxStock: e.target.value })} />
            <Input label="Reorder Level" type="number" value={formData.reorderLevel} onChange={(e: any) => setFormData({ ...formData, reorderLevel: e.target.value })} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Item Image</label>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
            <div className="flex items-center space-x-4">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Choose Image</button>
              {imagePreview && <img src={imagePreview} alt="" className="w-16 h-16 rounded object-cover" />}
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditingItem(null); setErrors({}); }}>Cancel</Button>
            <Button type="submit">{editingItem ? 'Update' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
