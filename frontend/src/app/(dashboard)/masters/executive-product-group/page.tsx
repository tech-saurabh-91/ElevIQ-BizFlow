'use client';

import { useEffect, useState } from 'react';
import { moduleAPI, masterAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import toast from 'react-hot-toast';

export default function ExecutiveProductGroupPage() {
  const perm = usePermission('/masters/executive-product-group');
  const [assignments, setAssignments] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [itemGroups, setItemGroups] = useState<any[]>([]);
  const [assignedExecutiveIds, setAssignedExecutiveIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({ executiveId: '', productGroups: [] as string[] });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [assignRes, usersRes, groupsRes] = await Promise.all([
        moduleAPI.getExecutiveProductGroups().catch(() => ({ data: { data: [] } })),
        masterAPI.getUsers({ limit: 500 }).catch(() => ({ data: { data: [] } })),
        moduleAPI.getItemGroups().catch(() => ({ data: { data: [] } })),
      ]);
      const assignData = assignRes.data.data || [];
      const usersData = usersRes.data?.data || [];
      const groupsData = groupsRes.data.data || [];
      setAssignments(assignData);
      setUsers(usersData);
      setItemGroups(groupsData);
      setAssignedExecutiveIds(assignData.map((a: any) => {
        const exec = a.executiveId;
        return typeof exec === 'string' ? exec : exec?._id;
      }).filter(Boolean));
    } catch { toast.error('Failed to load data'); } finally { setIsLoading(false); }
  };

  const getAvailableUsers = () => {
    const isMobileUser = (u: any) => {
      const sub = (u.roleId?.mobileSubType || '').toLowerCase();
      return sub === 'presale' || sub === 'vansale';
    };
    const mobileUsers = users.filter(isMobileUser);
    if (editing) return mobileUsers;
    return mobileUsers.filter(u => !assignedExecutiveIds.includes(u._id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (!formData.executiveId) { setErrors({ executiveId: 'Please select an executive' }); return; }
    if (formData.productGroups.length === 0) { setErrors({ productGroups: 'Please select at least one product group' }); return; }

    setIsSaving(true);
    try {
      if (editing) {
        await moduleAPI.updateExecutiveProductGroup(editing._id, formData);
        toast.success('Updated successfully');
      } else {
        await moduleAPI.createExecutiveProductGroup(formData);
        toast.success('Created successfully');
      }
      setIsModalOpen(false); setEditing(null); resetForm(); loadData();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Operation failed';
      toast.error(msg);
      setErrors({ submit: msg });
    } finally { setIsSaving(false); }
  };

  const handleEdit = (record: any) => {
    setEditing(record);
    const groupIds = (record.productGroups || []).map((g: any) => typeof g === 'string' ? g : g._id);
    setFormData({ executiveId: record.executiveId?._id || record.executiveId, productGroups: groupIds });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this allocation?')) return;
    try { await moduleAPI.deleteExecutiveProductGroup(id); toast.success('Deleted'); loadData(); } catch { toast.error('Failed'); }
  };

  const resetForm = () => {
    setFormData({ executiveId: '', productGroups: [] });
    setErrors({});
  };

  const toggleGroup = (id: string) => {
    setFormData(prev => ({
      ...prev,
      productGroups: prev.productGroups.includes(id)
        ? prev.productGroups.filter(x => x !== id)
        : [...prev.productGroups, id],
    }));
  };

  const toggleAllGroups = () => {
    if (formData.productGroups.length === itemGroups.length) {
      setFormData(prev => ({ ...prev, productGroups: [] }));
    } else {
      setFormData(prev => ({ ...prev, productGroups: itemGroups.map(g => g._id) }));
    }
  };

  const columns = [
    {
      key: 'executive',
      label: 'Executive',
      render: (r: any) => {
        const exec = r.executiveId;
        if (!exec) return '-';
        return <div><p className="font-medium">{exec.firstName} {exec.lastName}</p><p className="text-xs text-gray-500">{exec.email}</p></div>;
      },
    },
    {
      key: 'designation',
      label: 'Type',
      render: (r: any) => {
        const exec = r.executiveId;
        const desig = exec?.designation || '-';
        return <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800 capitalize">{desig}</span>;
      },
    },
    {
      key: 'productGroups',
      label: 'Product Groups',
      render: (r: any) => (
        <div className="flex flex-wrap gap-1">
          {(r.productGroups || []).map((g: any) => (
            <span key={g._id || g} className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded-full">{g.groupName || g}</span>
          ))}
        </div>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (r: any) => (
        <div className="flex space-x-2">
          {perm.canEdit && <button onClick={() => handleEdit(r)} className="text-blue-600 hover:text-blue-800">Edit</button>}
          {perm.canDelete && <button onClick={() => handleDelete(r._id)} className="text-red-600 hover:text-red-800">Delete</button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Executive - Product Group</h1>
        {perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Create</Button>}
      </div>
      <Table columns={columns} data={assignments} isLoading={isLoading} />
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditing(null); resetForm(); }} title={editing ? 'Edit Executive-Group' : 'Executive-Group'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm">{errors.submit}</div>}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Executive <span className="text-red-500">*</span></label>
            <select value={formData.executiveId} onChange={(e) => setFormData({ ...formData, executiveId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500" disabled={!!editing} required>
              <option value="">---Select---</option>
              {getAvailableUsers().map((u: any) => (
                <option key={u._id} value={u._id}>{u.firstName} {u.lastName} ({u.email}) - {u.roleId?.roleName || u.designation}</option>
              ))}
            </select>
            {errors.executiveId && <p className="text-red-500 text-xs mt-1">{errors.executiveId}</p>}
            {getAvailableUsers().length === 0 && !editing && (
              <p className="text-amber-600 text-xs mt-1">No Pre-Sales or Van-Sales executives found. Create users with Pre-Sales User / Van-Sales User role first.</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product Group <span className="text-red-500">*</span></label>
            <div className="border rounded-lg max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left w-10">
                      <input type="checkbox" checked={itemGroups.length > 0 && formData.productGroups.length === itemGroups.length}
                        onChange={toggleAllGroups} className="rounded" />
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Group Code</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Group Name</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {itemGroups.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-4 text-center text-gray-400">No item groups found</td></tr>
                  ) : itemGroups.map((g: any) => (
                    <tr key={g._id} className={`hover:bg-blue-50 cursor-pointer ${formData.productGroups.includes(g._id) ? 'bg-blue-50' : ''}`}
                      onClick={() => toggleGroup(g._id)}>
                      <td className="px-4 py-2">
                        <input type="checkbox" checked={formData.productGroups.includes(g._id)}
                          onChange={() => toggleGroup(g._id)} onClick={(e) => e.stopPropagation()} className="rounded" />
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{g.groupCode}</td>
                      <td className="px-4 py-2">{g.groupName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {errors.productGroups && <p className="text-red-500 text-xs mt-1">{errors.productGroups}</p>}
            <p className="text-xs text-gray-500 mt-1">{formData.productGroups.length} group(s) selected</p>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditing(null); resetForm(); }}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : editing ? 'Update' : 'Save'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
