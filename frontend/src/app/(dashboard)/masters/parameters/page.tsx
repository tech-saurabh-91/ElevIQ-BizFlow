'use client';

import { useEffect, useState } from 'react';
import { moduleAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import toast from 'react-hot-toast';

const PARAM_TYPES = [
  { value: 'item_classification', label: 'Item Classification' },
  { value: 'brand', label: 'Brand' },
  { value: 'unit', label: 'Unit' },
  { value: 'payment_mode', label: 'Payment Mode' },
  { value: 'expense_type', label: 'Expense Type' },
  { value: 'customer_type', label: 'Customer Type' },
  { value: 'designation', label: 'Designation' },
  { value: 'visit_purpose', label: 'Visit Purpose' },
  { value: 'attendance_status', label: 'Attendance Status' },
  { value: 'order_status', label: 'Order Status' },
  { value: 'warehouse_nature', label: 'Warehouse Nature' },
  { value: 'other', label: 'Other' },
];

export default function ParametersPage() {
  const perm = usePermission('/masters/parameters');
  const [params, setParams] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({ parameterType: 'item_classification', parameterValue: '', description: '' });
  const [filterType, setFilterType] = useState('');

  useEffect(() => { fetchParams(); }, [filterType]);

  const fetchParams = async () => {
    try {
      const res = await moduleAPI.getParameters(filterType ? { parameterType: filterType } : {});
      setParams(res.data.data);
    } catch { toast.error('Failed'); } finally { setIsLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsSaving(true);
    try {
      if (editing) { await moduleAPI.updateParameter(editing._id, formData); toast.success('Updated'); }
      else { await moduleAPI.createParameter(formData); toast.success('Created'); }
      setIsModalOpen(false); setEditing(null); resetForm(); fetchParams();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Failed'); setErrors({ submit: err.response?.data?.message || err.message || 'Failed' }); }
    finally { setIsSaving(false); }
  };

  const handleEdit = (p: any) => { setEditing(p); setFormData({ parameterType: p.parameterType, parameterValue: p.parameterValue, description: p.description || '' }); setIsModalOpen(true); };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete?')) return;
    try { await moduleAPI.deleteParameter(id); toast.success('Deleted'); fetchParams(); } catch { toast.error('Failed'); }
  };

  const resetForm = () => setFormData({ parameterType: 'item_classification', parameterValue: '', description: '' });

  const columns = [
    { key: 'parameterType', label: 'Type', render: (p: any) => <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">{PARAM_TYPES.find(t => t.value === p.parameterType)?.label || p.parameterType}</span> },
    { key: 'parameterValue', label: 'Value', render: (p: any) => <span className="font-medium">{p.parameterValue}</span> },
    { key: 'description', label: 'Description' },
    { key: 'actions', label: 'Actions', render: (p: any) => <div className="flex space-x-2">{perm.canEdit && <button onClick={() => handleEdit(p)} className="text-blue-600">Edit</button>}{perm.canDelete && <button onClick={() => handleDelete(p._id)} className="text-red-600">Delete</button>}</div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Parameters</h1>
        <div className="flex gap-3">
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
            <option value="">All Types</option>
            {PARAM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Add Parameter</Button>}
        </div>
      </div>
      <Table columns={columns} data={params} isLoading={isLoading} />
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditing(null); }} title={editing ? 'Edit Parameter' : 'Add Parameter'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{errors.submit}</div>}
          <div><label className="block text-sm font-medium mb-1">Parameter Type *</label><select value={formData.parameterType} onChange={(e) => setFormData({ ...formData, parameterType: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required>{PARAM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
          <Input label="Parameter Value" required value={formData.parameterValue} onChange={(e: any) => setFormData({ ...formData, parameterValue: e.target.value })} />
          <Input label="Description" value={formData.description} onChange={(e: any) => setFormData({ ...formData, description: e.target.value })} />
          <div className="flex justify-end space-x-3 pt-4"><Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditing(null); }}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : editing ? 'Update' : 'Create'}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
