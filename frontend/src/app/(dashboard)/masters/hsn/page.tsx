'use client';

import { useEffect, useState } from 'react';
import { moduleAPI, masterAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import toast from 'react-hot-toast';

interface TaxOption { _id: string; taxName: string; totalTaxPercent: number; gstType: string; cgstPercent?: number; sgstPercent?: number; igstPercent?: number; }

export default function HsnMasterPage() {
  const perm = usePermission('/masters/hsn');
  const [hsns, setHsns] = useState<any[]>([]);
  const [taxes, setTaxes] = useState<TaxOption[]>([]);
  const [gstEnabled, setGstEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({
    hsnCode: '', hsnDescription: '',
    effectiveFromDate: new Date().toISOString().split('T')[0],
    effectiveToDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    cgstTaxId: '', cgstDesc: '', cgstPercent: '',
    sgstTaxId: '', sgstDesc: '', sgstPercent: '',
    igstTaxId: '', igstDesc: '', igstPercent: '',
  });

  useEffect(() => {
    Promise.all([moduleAPI.getHsns(), moduleAPI.getTaxes(), masterAPI.getCompanyDetails()])
      .then(([h, t, c]) => { setHsns(h.data.data); setTaxes(t.data.data); setGstEnabled(c.data.data?.gstEnabled || false); })
      .catch(() => toast.error('Failed to fetch'))
      .finally(() => setIsLoading(false));
  }, []);

  const handleTaxSelect = (field: string, taxId: string) => {
    const tax = taxes.find(t => t._id === taxId);
    if (!tax) return;
    const newFormData = { ...formData, [field]: taxId };

    if (field === 'cgstTaxId') {
      newFormData.cgstDesc = `${tax.taxName} ${tax.cgstPercent || tax.totalTaxPercent / 2}%`;
      newFormData.cgstPercent = String(tax.cgstPercent || tax.totalTaxPercent / 2);
    } else if (field === 'sgstTaxId') {
      newFormData.sgstDesc = `${tax.taxName} ${tax.sgstPercent || tax.totalTaxPercent / 2}`;
      newFormData.sgstPercent = String(tax.sgstPercent || tax.totalTaxPercent / 2);
    } else if (field === 'igstTaxId') {
      newFormData.igstDesc = `${tax.taxName} ${tax.igstPercent || tax.totalTaxPercent}%`;
      newFormData.igstPercent = String(tax.igstPercent || tax.totalTaxPercent);
    }

    setFormData(newFormData);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsSaving(true);
    try {
      const payload = {
        ...formData,
        cgstPercent: Number(formData.cgstPercent) || 0,
        sgstPercent: Number(formData.sgstPercent) || 0,
        igstPercent: Number(formData.igstPercent) || 0,
      };
      if (editing) { await moduleAPI.updateHsn(editing._id, payload); toast.success('Updated'); }
      else { await moduleAPI.createHsn(payload); toast.success('Created'); }
      setIsModalOpen(false); setEditing(null); resetForm();
      const res = await moduleAPI.getHsns(); setHsns(res.data.data);
    } catch (err: any) { toast.error(err.response?.data?.message || 'Failed'); setErrors({ submit: err.response?.data?.message || err.message || 'Failed' }); }
    finally { setIsSaving(false); }
  };

  const handleEdit = (hsn: any) => {
    setEditing(hsn);
    setFormData({
      hsnCode: hsn.hsnCode, hsnDescription: hsn.hsnDescription,
      effectiveFromDate: hsn.effectiveFromDate.split('T')[0],
      effectiveToDate: hsn.effectiveToDate.split('T')[0],
      cgstTaxId: hsn.cgstTaxId?._id || '', cgstDesc: hsn.cgstDesc || '', cgstPercent: String(hsn.cgstPercent || ''),
      sgstTaxId: hsn.sgstTaxId?._id || '', sgstDesc: hsn.sgstDesc || '', sgstPercent: String(hsn.sgstPercent || ''),
      igstTaxId: hsn.igstTaxId?._id || '', igstDesc: hsn.igstDesc || '', igstPercent: String(hsn.igstPercent || ''),
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete?')) return;
    try { await moduleAPI.deleteHsn(id); toast.success('Deleted'); const res = await moduleAPI.getHsns(); setHsns(res.data.data); } catch { toast.error('Failed'); }
  };

  const resetForm = () => setFormData({
    hsnCode: '', hsnDescription: '',
    effectiveFromDate: new Date().toISOString().split('T')[0],
    effectiveToDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    cgstTaxId: '', cgstDesc: '', cgstPercent: '',
    sgstTaxId: '', sgstDesc: '', sgstPercent: '',
    igstTaxId: '', igstDesc: '', igstPercent: '',
  });

  if (!gstEnabled) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">HSN Master</h1>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <p className="text-yellow-700 font-medium">HSN Master is available only when GST is enabled.</p>
          <p className="text-yellow-600 text-sm mt-2">Enable GST in Company Settings (Super Admin) to use HSN codes.</p>
        </div>
      </div>
    );
  }

  const columns = [
    { key: 'hsnCode', label: 'HSN Code', render: (h: any) => <span className="font-mono font-semibold">{h.hsnCode}</span> },
    { key: 'hsnDescription', label: 'Description' },
    { key: 'totalTaxPercent', label: 'Total Tax %', render: (h: any) => <span className="font-semibold">{h.totalTaxPercent}%</span> },
    { key: 'effective', label: 'Effective Period', render: (h: any) => `${new Date(h.effectiveFromDate).toLocaleDateString()} - ${new Date(h.effectiveToDate).toLocaleDateString()}` },
    { key: 'isActive', label: 'Status', render: (h: any) => <span className={`px-2 py-1 text-xs font-semibold rounded-full ${h.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{h.isActive ? 'Yes' : 'No'}</span> },
    { key: 'actions', label: 'Actions', render: (h: any) => <div className="flex space-x-2">{perm.canEdit && <button onClick={() => handleEdit(h)} className="text-blue-600">Edit</button>}{perm.canDelete && <button onClick={() => handleDelete(h._id)} className="text-red-600">Delete</button>}</div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">HSN Master</h1>
          <p className="text-sm text-gray-500">GST Mode: Link HSN codes to Tax Masters</p>
        </div>
        {perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Create</Button>}
      </div>

      <Table columns={columns} data={hsns} isLoading={isLoading} />

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditing(null); }} title={editing ? 'Edit HSN' : 'HSN Master Form'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{errors.submit}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="HSN Code" required value={formData.hsnCode} onChange={(e: any) => setFormData({ ...formData, hsnCode: e.target.value })} />
            <Input label="HSN Description" required value={formData.hsnDescription} onChange={(e: any) => setFormData({ ...formData, hsnDescription: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Effective From" type="date" required value={formData.effectiveFromDate} onChange={(e: any) => setFormData({ ...formData, effectiveFromDate: e.target.value })} />
            <Input label="Effective To" type="date" required value={formData.effectiveToDate} onChange={(e: any) => setFormData({ ...formData, effectiveToDate: e.target.value })} />
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Tax Configuration (GST)</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CGST Tax</label>
                <select value={formData.cgstTaxId} onChange={(e) => handleTaxSelect('cgstTaxId', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">Select</option>
                  {taxes.map(t => <option key={t._id} value={t._id}>{t.taxName} - {t.totalTaxPercent}%</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SGST Tax</label>
                <select value={formData.sgstTaxId} onChange={(e) => handleTaxSelect('sgstTaxId', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">Select</option>
                  {taxes.map(t => <option key={t._id} value={t._id}>{t.taxName} - {t.totalTaxPercent}%</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">IGST Tax</label>
                <select value={formData.igstTaxId} onChange={(e) => handleTaxSelect('igstTaxId', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  <option value="">Select</option>
                  {taxes.map(t => <option key={t._id} value={t._id}>{t.taxName} - {t.totalTaxPercent}%</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-3">
              <Input label="CGST %" type="number" value={formData.cgstPercent} onChange={(e: any) => setFormData({ ...formData, cgstPercent: e.target.value })} />
              <Input label="SGST %" type="number" value={formData.sgstPercent} onChange={(e: any) => setFormData({ ...formData, sgstPercent: e.target.value })} />
              <Input label="IGST %" type="number" value={formData.igstPercent} onChange={(e: any) => setFormData({ ...formData, igstPercent: e.target.value })} />
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditing(null); }}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : editing ? 'Update' : 'Save'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
