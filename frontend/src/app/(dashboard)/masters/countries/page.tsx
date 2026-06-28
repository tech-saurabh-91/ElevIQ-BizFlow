'use client';

import { useEffect, useState } from 'react';
import { moduleAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import toast from 'react-hot-toast';

export default function CountriesPage() {
  const perm = usePermission('/masters/countries');
  const [countries, setCountries] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({ countryName: '', countryCode: '', currency: '', currencySymbol: '', phoneCode: '' });

  useEffect(() => { fetchCountries(); }, []);

  const fetchCountries = async () => {
    try { const res = await moduleAPI.getCountries(); setCountries(res.data.data); } catch { toast.error('Failed'); } finally { setIsLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsSaving(true);
    try {
      if (editing) { await moduleAPI.updateCountry(editing._id, formData); toast.success('Updated'); }
      else { await moduleAPI.createCountry(formData); toast.success('Created'); }
      setIsModalOpen(false); setEditing(null); resetForm(); fetchCountries();
    } catch (err: any) { setErrors({ submit: err.response?.data?.message || err.message || 'Failed' }); }
    finally { setIsSaving(false); }
  };

  const handleEdit = (c: any) => { setEditing(c); setFormData({ countryName: c.countryName, countryCode: c.countryCode, currency: c.currency, currencySymbol: c.currencySymbol || '', phoneCode: c.phoneCode || '' }); setIsModalOpen(true); };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete?')) return;
    try { await moduleAPI.deleteCountry(id); toast.success('Deleted'); fetchCountries(); } catch { toast.error('Failed'); }
  };

  const resetForm = () => setFormData({ countryName: '', countryCode: '', currency: '', currencySymbol: '', phoneCode: '' });

  const columns = [
    { key: 'country', label: 'Country', render: (c: any) => <div><p className="font-medium">{c.countryName}</p><p className="text-sm text-gray-500">{c.countryCode}</p></div> },
    { key: 'currency', label: 'Currency', render: (c: any) => `${c.currencySymbol || ''} ${c.currency}` },
    { key: 'phoneCode', label: 'Phone Code' },
    { key: 'actions', label: 'Actions', render: (c: any) => <div className="flex space-x-2">{perm.canEdit && <button onClick={() => handleEdit(c)} className="text-blue-600">Edit</button>}{perm.canDelete && <button onClick={() => handleDelete(c._id)} className="text-red-600">Delete</button>}</div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Countries</h1>{perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Add Country</Button>}</div>
      <Table columns={columns} data={countries} isLoading={isLoading} />
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditing(null); }} title={editing ? 'Edit Country' : 'Add Country'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{errors.submit}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Country Name" required value={formData.countryName} onChange={(e: any) => setFormData({ ...formData, countryName: e.target.value })} />
            <Input label="Country Code" required value={formData.countryCode} onChange={(e: any) => setFormData({ ...formData, countryCode: e.target.value.toUpperCase().slice(0, 3) })} placeholder="e.g. IN, US" maxLength={3} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Currency" required value={formData.currency} onChange={(e: any) => setFormData({ ...formData, currency: e.target.value })} placeholder="e.g. INR" />
            <Input label="Symbol" value={formData.currencySymbol} onChange={(e: any) => setFormData({ ...formData, currencySymbol: e.target.value })} placeholder="e.g. ₹" />
            <Input label="Phone Code" value={formData.phoneCode} onChange={(e: any) => setFormData({ ...formData, phoneCode: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="e.g. 91" />
          </div>
          <div className="flex justify-end space-x-3 pt-4"><Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditing(null); }}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : (editing ? 'Update' : 'Create')}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
