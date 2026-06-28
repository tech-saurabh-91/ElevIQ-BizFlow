'use client';

import { useEffect, useState } from 'react';
import { moduleAPI, masterAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import { TaxMaster } from '@/types';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import toast from 'react-hot-toast';

export default function TaxMasterPage() {
  const perm = usePermission('/masters/tax');
  const [taxes, setTaxes] = useState<TaxMaster[]>([]);
  const [gstEnabled, setGstEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<TaxMaster | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({
    taxName: '',
    totalTaxPercent: '',
    effectDate: new Date().toISOString().split('T')[0],
    gstType: 'CGST+SGST',
    taxType: 'sales',
    cgstPercent: '',
    sgstPercent: '',
    igstPercent: '',
  });

  useEffect(() => {
    Promise.all([fetchTaxes(), fetchCompany()]);
  }, []);

  const fetchTaxes = async () => {
    try { const res = await moduleAPI.getTaxes(); setTaxes(res.data.data); } catch { toast.error('Failed to fetch'); } finally { setIsLoading(false); }
  };

  const fetchCompany = async () => {
    try {
      const res = await masterAPI.getCompanyDetails();
      setGstEnabled(res.data.data?.gstEnabled || false);
    } catch {}
  };

  const handleGstTypeChange = (type: string) => {
    const total = Number(formData.totalTaxPercent) || 0;
    let cgst = '', sgst = '', igst = '';

    if (type === 'CGST+SGST') {
      cgst = String(total / 2);
      sgst = String(total / 2);
      igst = String(total);
    } else if (type === 'CGST') {
      cgst = String(total);
    } else if (type === 'SGST') {
      sgst = String(total);
    } else if (type === 'IGST') {
      igst = String(total);
    }

    setFormData({ ...formData, gstType: type, cgstPercent: cgst, sgstPercent: sgst, igstPercent: igst });
  };

  const handleTotalTaxChange = (val: string) => {
    const total = Number(val) || 0;
    let cgst = '', sgst = '', igst = '';

    if (formData.gstType === 'CGST+SGST') {
      cgst = String(total / 2);
      sgst = String(total / 2);
      igst = String(total);
    } else if (formData.gstType === 'CGST') {
      cgst = String(total);
    } else if (formData.gstType === 'SGST') {
      sgst = String(total);
    } else if (formData.gstType === 'IGST') {
      igst = String(total);
    }

    setFormData({ ...formData, totalTaxPercent: val, cgstPercent: cgst, sgstPercent: sgst, igstPercent: igst });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsSaving(true);
    try {
      const payload: any = {
        taxName: formData.taxName,
        totalTaxPercent: Number(formData.totalTaxPercent),
        effectDate: formData.effectDate,
        taxType: formData.taxType,
      };

      if (gstEnabled) {
        payload.gstType = formData.gstType;
        payload.cgstPercent = Number(formData.cgstPercent) || 0;
        payload.sgstPercent = Number(formData.sgstPercent) || 0;
        payload.igstPercent = Number(formData.igstPercent) || 0;
      } else {
        payload.gstType = 'SIMPLE';
        payload.cgstPercent = 0;
        payload.sgstPercent = 0;
        payload.igstPercent = 0;
      }

      if (editing) { await moduleAPI.updateTax(editing._id, payload); toast.success('Updated'); }
      else { await moduleAPI.createTax(payload); toast.success('Created'); }
      setIsModalOpen(false); setEditing(null); resetForm(); fetchTaxes();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Failed'); setErrors({ submit: err.response?.data?.message || err.message || 'Failed' }); }
    finally { setIsSaving(false); }
  };

  const handleEdit = (tax: TaxMaster) => {
    setEditing(tax);
    setFormData({
      taxName: tax.taxName, totalTaxPercent: String(tax.totalTaxPercent),
      effectDate: tax.effectDate.split('T')[0], gstType: tax.gstType, taxType: tax.taxType,
      cgstPercent: String(tax.cgstPercent || ''), sgstPercent: String(tax.sgstPercent || ''),
      igstPercent: String(tax.igstPercent || ''),
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete?')) return;
    try { await moduleAPI.deleteTax(id); toast.success('Deleted'); fetchTaxes(); } catch { toast.error('Failed'); }
  };

  const resetForm = () => setFormData({
    taxName: '', totalTaxPercent: '', effectDate: new Date().toISOString().split('T')[0],
    gstType: gstEnabled ? 'CGST+SGST' : 'SIMPLE', taxType: 'sales', cgstPercent: '', sgstPercent: '', igstPercent: '',
  });

  const columns = [
    { key: 'taxName', label: 'Tax Name', render: (t: TaxMaster) => <div><p className="font-medium">{t.taxName}</p><p className="text-sm text-gray-500">{t.taxCode}</p></div> },
    { key: 'totalTaxPercent', label: 'Total Tax %', render: (t: TaxMaster) => <span className="font-semibold">{t.totalTaxPercent}%</span> },
    { key: 'effectDate', label: 'Effect Date', render: (t: TaxMaster) => new Date(t.effectDate).toLocaleDateString() },
    { key: 'gstType', label: 'Type', render: (t: TaxMaster) => <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">{t.gstType === 'SIMPLE' ? 'Tax' : t.gstType}</span> },
    ...(gstEnabled ? [
      { key: 'cgst', label: 'CGST', render: (t: TaxMaster) => `${t.cgstPercent || 0}%` },
      { key: 'sgst', label: 'SGST', render: (t: TaxMaster) => `${t.sgstPercent || 0}%` },
      { key: 'igst', label: 'IGST', render: (t: TaxMaster) => `${t.igstPercent || 0}%` },
    ] : []),
    { key: 'taxType', label: 'Tax Type', render: (t: TaxMaster) => <span className="capitalize">{t.taxType}</span> },
    { key: 'actions', label: 'Actions', render: (t: TaxMaster) => <div className="flex space-x-2">{perm.canEdit && <button onClick={() => handleEdit(t)} className="text-blue-600">Edit</button>}{perm.canDelete && <button onClick={() => handleDelete(t._id)} className="text-red-600">Delete</button>}</div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tax Master</h1>
          <p className="text-sm text-gray-500">{gstEnabled ? 'GST Mode: CGST, SGST, IGST breakup' : 'Non-GST Mode: Simple tax %'}</p>
        </div>
        {perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Create</Button>}
      </div>

      <Table columns={columns} data={taxes} isLoading={isLoading} />

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditing(null); }} title={editing ? 'Edit Tax' : 'Create Tax'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{errors.submit}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Tax Name" required value={formData.taxName} onChange={(e: any) => setFormData({ ...formData, taxName: e.target.value })} placeholder={gstEnabled ? "e.g. GST 18%" : "e.g. VAT 5%"} />
            <Input label={gstEnabled ? "Total GST %" : "Tax %"} type="number" required value={formData.totalTaxPercent} onChange={(e: any) => handleTotalTaxChange(e.target.value)} placeholder="e.g. 18" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Effect Date" type="date" required value={formData.effectDate} onChange={(e: any) => setFormData({ ...formData, effectDate: e.target.value })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tax Type</label>
              <select value={formData.taxType} onChange={(e) => setFormData({ ...formData, taxType: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="sales">Sales</option>
                <option value="purchase">Purchase</option>
                <option value="both">Both</option>
              </select>
            </div>
          </div>

          {gstEnabled ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">GST Type</label>
                <select value={formData.gstType} onChange={(e) => handleGstTypeChange(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  <option value="CGST+SGST">CGST + SGST (Intra-state)</option>
                  <option value="CGST">CGST Only</option>
                  <option value="SGST">SGST Only</option>
                  <option value="IGST">IGST (Inter-state)</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Input label="CGST %" type="number" value={formData.cgstPercent} onChange={(e: any) => setFormData({ ...formData, cgstPercent: e.target.value })} />
                <Input label="SGST %" type="number" value={formData.sgstPercent} onChange={(e: any) => setFormData({ ...formData, sgstPercent: e.target.value })} />
                <Input label="IGST %" type="number" value={formData.igstPercent} onChange={(e: any) => setFormData({ ...formData, igstPercent: e.target.value })} />
              </div>
            </>
          ) : (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-700">Non-GST Mode: Only total tax % will be used. No CGST/SGST/IGST breakup.</p>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditing(null); }}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : editing ? 'Update' : 'Save'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
