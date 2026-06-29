'use client';

import { useEffect, useState } from 'react';
import { masterAPI, moduleAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import toast from 'react-hot-toast';

export default function VansPage() {
  const perm = usePermission('/masters/vans');
  const [assignments, setAssignments] = useState<any[]>([]);
  const [vans, setVans] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    executiveId: '',
    vanId: '',
    dayCashOutMandatory: false,
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [assignRes, vansRes, usersRes] = await Promise.all([
        moduleAPI.getExecutiveVanAssignments({ limit: 500 }).catch(() => ({ data: { data: [] } })),
        masterAPI.getVans({ limit: 500 }).catch(() => ({ data: { data: [] } })),
        masterAPI.getUsers({ limit: 500 }).catch(() => ({ data: { data: [] } })),
      ]);
      setAssignments(assignRes.data.data || []);
      setVans(vansRes.data.data || []);
      const vanSaleUsers = (usersRes.data?.data || []).filter((u: any) => {
        const sub = (u.roleId?.mobileSubType || '').toLowerCase();
        return sub === 'vansale' && u.isActive !== false;
      });
      setUsers(vanSaleUsers);
    } catch { toast.error('Failed to load data'); }
    finally { setIsLoading(false); }
  };

  const assignedExecutiveIds = assignments.map((a: any) => {
    return typeof a.executiveId === 'object' ? a.executiveId?._id : a.executiveId;
  });

  const availableUsers = users.filter((u: any) => !assignedExecutiveIds.includes(u._id));

  const handleAdd = async () => {
    setErrors({});
    const newErrors: Record<string, string> = {};

    if (!formData.executiveId) newErrors.executiveId = 'Please select an executive';
    if (!formData.vanId) newErrors.vanId = 'Please select a VAN';

    if (formData.dayCashOutMandatory) {
      const existingCashOut = assignments.find((a: any) => a.dayCashOutMandatory);
      if (existingCashOut) {
        newErrors.dayCashOutMandatory = 'Only one user can have Day Cash Out Mandatory = Yes';
      }
    }

    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    setIsSaving(true);
    try {
      await moduleAPI.createExecutiveVanAssignment({
        executiveId: formData.executiveId,
        vanId: formData.vanId,
        dayCashOutMandatory: formData.dayCashOutMandatory,
      });
      toast.success('Executive assigned successfully');
      setFormData({ executiveId: '', dayCashOutMandatory: false });
      loadData();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to assign');
    } finally { setIsSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this assignment?')) return;
    try {
      await moduleAPI.deleteExecutiveVanAssignment(id);
      toast.success('Removed');
      loadData();
    } catch { toast.error('Failed to remove'); }
  };

  const columns = [
    {
      key: 'executive', label: 'Executive',
      render: (r: any) => {
        const u = r.executiveId;
        return <span>{u?.firstName} {u?.lastName}</span>;
      },
    },
    {
      key: 'van', label: 'VAN',
      render: (r: any) => <span>{r.vanId?.vanName || '-'}</span>,
    },
    {
      key: 'dayCashOut', label: 'Day Cash Out Mandatory',
      render: (r: any) => <span>{r.dayCashOutMandatory ? 'Yes' : 'No'}</span>,
    },
    {
      key: 'actions', label: 'Action',
      render: (r: any) => perm.canDelete && (
        <button onClick={() => handleDelete(r._id)} className="text-red-600 hover:text-red-800">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Van Link</h1>
        {perm.canCreate && <Button onClick={() => setIsModalOpen(true)}>+ Van Assign</Button>}
      </div>

      <Table columns={columns} data={assignments} isLoading={isLoading} />

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setFormData({ executiveId: '', vanId: '', dayCashOutMandatory: false }); setErrors({}); }} title="Van Link" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Executive <span className="text-red-500">*</span></label>
            <select value={formData.executiveId} onChange={(e) => setFormData({ ...formData, executiveId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              <option value="">Select</option>
              {availableUsers.map((u: any) => (
                <option key={u._id} value={u._id}>{u.firstName} {u.lastName}</option>
              ))}
            </select>
            {errors.executiveId && <p className="text-red-500 text-xs mt-1">{errors.executiveId}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">VAN <span className="text-red-500">*</span></label>
            <select value={formData.vanId} onChange={(e) => setFormData({ ...formData, vanId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              <option value="">Select</option>
              {vans.filter((v: any) => v.isActive !== false).map((v: any) => (
                <option key={v._id} value={v._id}>{v.vanName}</option>
              ))}
            </select>
            {errors.vanId && <p className="text-red-500 text-xs mt-1">{errors.vanId}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Day Cash Out Mandatory</label>
            <div className="flex gap-4 py-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={formData.dayCashOutMandatory === false}
                  onChange={() => setFormData({ ...formData, dayCashOutMandatory: false })} className="h-4 w-4" />
                <span className="text-sm">No</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={formData.dayCashOutMandatory === true}
                  onChange={() => setFormData({ ...formData, dayCashOutMandatory: true })} className="h-4 w-4" />
                <span className="text-sm">Yes</span>
              </label>
            </div>
            {errors.dayCashOutMandatory && <p className="text-red-500 text-xs mt-1">{errors.dayCashOutMandatory}</p>}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setFormData({ executiveId: '', vanId: '', dayCashOutMandatory: false }); setErrors({}); }}>Close</Button>
            <Button onClick={handleAdd} disabled={isSaving}>{isSaving ? 'Saving...' : 'Add'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
