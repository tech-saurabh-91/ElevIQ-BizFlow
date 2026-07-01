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
  const [groups, setGroups] = useState<any[]>([]);
  const [vanWarehouses, setVanWarehouses] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [allAssignedUserIds, setAllAssignedUserIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'view'>('create');
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [selectedVanId, setSelectedVanId] = useState('');
  const [modalExecutives, setModalExecutives] = useState<any[]>([]);
  const [currentExecId, setCurrentExecId] = useState('');
  const [currentDayCashOut, setCurrentDayCashOut] = useState(false);
  const [editingGroupVanId, setEditingGroupVanId] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [assignRes, wareRes, usersRes] = await Promise.all([
        moduleAPI.getExecutiveVanAssignments().catch(() => ({ data: { data: [] } })),
        masterAPI.getWarehouses({ limit: 500 }).catch(() => ({ data: { data: [] } })),
        masterAPI.getUsers({ limit: 500 }).catch(() => ({ data: { data: [] } })),
      ]);
      const grouped = assignRes.data?.data || [];
      setGroups(grouped);

      const vanWareData = (wareRes.data?.data || []).filter((w: any) => w.isVanWarehouse && w.isActive !== false);
      setVanWarehouses(vanWareData);

      const assignedIds: string[] = [];
      grouped.forEach((g: any) => {
        g.executives?.forEach((e: any) => {
          const execId = typeof e.executiveId === 'object' ? e.executiveId?._id : e.executiveId;
          if (execId) assignedIds.push(execId);
        });
      });
      setAllAssignedUserIds(assignedIds);

      setAllUsers((usersRes.data?.data || []).filter((u: any) => u.isActive !== false));
    } catch { toast.error('Failed to load data'); }
    finally { setIsLoading(false); }
  };

  const getExecutiveName = (execId: any) => {
    if (!execId) return '-';
    const id = typeof execId === 'object' ? execId._id : execId;
    const u = allUsers.find((u: any) => u._id === id);
    if (u) return `${u.firstName} ${u.lastName}`;
    if (typeof execId === 'object') return `${execId.firstName || ''} ${execId.lastName || ''}`;
    return '-';
  };

  const getVanName = (vanId: any) => {
    if (!vanId) return '-';
    const id = typeof vanId === 'object' ? vanId._id : vanId;
    const ware = vanWarehouses.find((w: any) => w._id === id);
    return ware ? ware.warehouseName : (typeof vanId === 'object' ? vanId.warehouseName : '-');
  };

  const getParentWarehouse = (vanId: any) => {
    if (!vanId) return '-';
    if (typeof vanId === 'object' && vanId.vanParentWarehouseId) {
      return typeof vanId.vanParentWarehouseId === 'object' ? vanId.vanParentWarehouseId.warehouseName : '-';
    }
    const id = typeof vanId === 'object' ? vanId._id : vanId;
    const ware = vanWarehouses.find((w: any) => w._id === id);
    if (ware?.vanParentWarehouseId) {
      const pw = typeof ware.vanParentWarehouseId === 'object' ? ware.vanParentWarehouseId : vanWarehouses.find((w: any) => w._id === ware.vanParentWarehouseId);
      return pw?.warehouseName || '-';
    }
    return '-';
  };

  const getUserInfo = (user: any) => {
    if (!user) return '-';
    if (typeof user === 'object') return `${user.firstName || ''} ${user.lastName || ''}`.trim() || '-';
    return '-';
  };

  const getAvailableExecutives = (excludeIds: string[] = []) => {
    return allUsers.filter((u: any) => {
      const isVansale = (u.roleId?.mobileSubType || '').toLowerCase() === 'vansale';
      const notAssigned = !allAssignedUserIds.includes(u._id) || excludeIds.includes(u._id);
      return isVansale && notAssigned && u.isActive !== false;
    });
  };

  const openCreate = () => {
    setModalMode('create');
    setSelectedVanId('');
    setModalExecutives([]);
    setCurrentExecId('');
    setCurrentDayCashOut(false);
    setEditingGroupVanId('');
    setErrors({});
    setIsModalOpen(true);
  };

  const openEdit = (group: any) => {
    setModalMode('edit');
    const vanId = typeof group.vanId === 'object' ? group.vanId._id : group.vanId;
    setSelectedVanId(vanId);
    setEditingGroupVanId(vanId);
    const execs = (group.executives || []).map((e: any) => ({
      _id: e._id,
      executiveId: typeof e.executiveId === 'object' ? e.executiveId._id : e.executiveId,
      executiveName: typeof e.executiveId === 'object' ? `${e.executiveId.firstName || ''} ${e.executiveId.lastName || ''}` : getExecutiveName(e.executiveId),
      dayCashOutMandatory: e.dayCashOutMandatory,
    }));
    setModalExecutives(execs);
    setCurrentExecId('');
    setCurrentDayCashOut(false);
    setErrors({});
    setIsModalOpen(true);
  };

  const openView = (group: any) => {
    setModalMode('view');
    const vanId = typeof group.vanId === 'object' ? group.vanId._id : group.vanId;
    setSelectedVanId(vanId);
    setEditingGroupVanId(vanId);
    const execs = (group.executives || []).map((e: any) => ({
      _id: e._id,
      executiveId: typeof e.executiveId === 'object' ? e.executiveId._id : e.executiveId,
      executiveName: typeof e.executiveId === 'object' ? `${e.executiveId.firstName || ''} ${e.executiveId.lastName || ''}` : getExecutiveName(e.executiveId),
      dayCashOutMandatory: e.dayCashOutMandatory,
    }));
    setModalExecutives(execs);
    setErrors({});
    setIsModalOpen(true);
  };

  const handleAddExec = () => {
    setErrors({});
    if (!currentExecId) { setErrors({ exec: 'Please select an executive' }); return; }

    const alreadyAdded = modalExecutives.some(e => e.executiveId === currentExecId);
    if (alreadyAdded) { setErrors({ exec: 'This executive is already added' }); return; }

    const alreadyAssigned = allAssignedUserIds.includes(currentExecId) && !modalExecutives.some(e => e.executiveId === currentExecId);
    if (alreadyAssigned) { setErrors({ exec: 'This executive is already assigned to another VAN' }); return; }

    if (currentDayCashOut) {
      const existingYes = modalExecutives.find(e => e.dayCashOutMandatory);
      if (existingYes) { setErrors({ exec: 'Only one user can have Day Cash Out Mandatory = Yes' }); return; }
    }

    const user = allUsers.find((u: any) => u._id === currentExecId);
    setModalExecutives([...modalExecutives, {
      executiveId: currentExecId,
      executiveName: user ? `${user.firstName} ${user.lastName}` : '-',
      dayCashOutMandatory: currentDayCashOut,
    }]);
    setCurrentExecId('');
    setCurrentDayCashOut(false);
  };

  const handleRemoveExec = (index: number) => {
    setModalExecutives(modalExecutives.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setErrors({});
    const newErrors: Record<string, string> = {};

    if (!selectedVanId) newErrors.van = 'Please select a VAN';
    if (modalExecutives.length === 0) newErrors.exec = 'Please add at least one executive';

    const yesCount = modalExecutives.filter(e => e.dayCashOutMandatory).length;
    if (yesCount > 1) newErrors.exec = 'Only one user can have Day Cash Out Mandatory = Yes';

    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    setIsSaving(true);
    try {
      const payload = {
        vanId: selectedVanId,
        executives: modalExecutives.map(e => ({
          _id: e._id || undefined,
          executiveId: e.executiveId,
          dayCashOutMandatory: e.dayCashOutMandatory,
        })),
      };

      if (modalMode === 'edit') {
        await moduleAPI.updateExecutiveVanAssignments(editingGroupVanId, payload);
        toast.success('Updated successfully');
      } else {
        await moduleAPI.createExecutiveVanAssignments(payload);
        toast.success('Saved successfully');
      }
      setIsModalOpen(false);
      loadData();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to save');
    } finally { setIsSaving(false); }
  };

  const handleDeleteGroup = async (vanId: string) => {
    if (!confirm('Remove all assignments for this VAN?')) return;
    try {
      const id = typeof vanId === 'object' ? vanId._id : vanId;
      await moduleAPI.deleteExecutiveVanAssignments(id);
      toast.success('Deleted');
      loadData();
    } catch { toast.error('Failed to delete'); }
  };

  const columns = [
    {
      key: 'vanName', label: 'Van Name',
      render: (g: any) => <span className="font-medium">{getVanName(g.vanId)}</span>,
    },
    {
      key: 'parentWarehouse', label: 'Parent Warehouse',
      render: (g: any) => <span>{getParentWarehouse(g.vanId)}</span>,
    },
    {
      key: 'updatedBy', label: 'Created/Updated By',
      render: (g: any) => <span>{getUserInfo(g.updatedBy || g.createdBy)}</span>,
    },
    {
      key: 'actions', label: 'Action',
      render: (g: any) => (
        <div className="flex space-x-2">
          {perm.canView && <button onClick={() => openView(g)} className="text-green-600 hover:text-green-800">View</button>}
          {perm.canEdit && <button onClick={() => openEdit(g)} className="text-blue-600 hover:text-blue-800">Edit</button>}
          {perm.canDelete && <button onClick={() => handleDeleteGroup(typeof g.vanId === 'object' ? g.vanId._id : g.vanId)} className="text-red-600 hover:text-red-800">Delete</button>}
        </div>
      ),
    },
  ];

  const availableExecs = getAvailableExecutives(
    modalMode === 'edit' ? modalExecutives.map(e => e.executiveId) : []
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Van Link</h1>
        {perm.canCreate && <Button onClick={openCreate}>+ Van Assign</Button>}
      </div>

      <Table columns={columns} data={groups} isLoading={isLoading} />

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); }} title={modalMode === 'view' ? 'View Van Assign' : modalMode === 'edit' ? 'Edit Van Assign' : 'Van Assign'} size="lg">
        <div className="space-y-4">
          {modalMode !== 'view' && (
            <div>
              <label className="block text-sm font-medium mb-1">VAN / Warehouse <span className="text-red-500">*</span></label>
              <select value={selectedVanId} onChange={(e) => setSelectedVanId(e.target.value)}
                disabled={modalMode === 'edit'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100">
                <option value="">Select</option>
                {vanWarehouses.map((w: any) => (
                  <option key={w._id} value={w._id}>{w.warehouseName} ({w.vanNumber || 'No VAN No'})</option>
                ))}
              </select>
              {errors.van && <p className="text-red-500 text-xs mt-1">{errors.van}</p>}
            </div>
          )}

          {modalMode === 'view' && (
            <div>
              <label className="block text-sm font-medium mb-1">VAN / Warehouse</label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">{getVanName(selectedVanId)}</div>
            </div>
          )}

          {modalMode !== 'view' && (
            <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <div>
                <label className="block text-sm font-medium mb-1">Executive <span className="text-red-500">*</span></label>
                <select value={currentExecId} onChange={(e) => setCurrentExecId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  <option value="">Select</option>
                  {availableExecs.map((u: any) => (
                    <option key={u._id} value={u._id}>{u.firstName} {u.lastName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Day Cash Out Mandatory</label>
                <div className="flex gap-4 py-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={currentDayCashOut === false}
                      onChange={() => setCurrentDayCashOut(false)} className="h-4 w-4" />
                    <span className="text-sm">No</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={currentDayCashOut === true}
                      onChange={() => setCurrentDayCashOut(true)} className="h-4 w-4" />
                    <span className="text-sm">Yes</span>
                  </label>
                </div>
              </div>
              <Button onClick={handleAddExec} className="mb-0">Add</Button>
            </div>
          )}
          {errors.exec && <p className="text-red-500 text-xs">{errors.exec}</p>}

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {modalMode !== 'view' && <th className="px-4 py-2 text-left font-medium text-gray-600">Delete</th>}
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Executive</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Day Cash Out Mandatory</th>
                </tr>
              </thead>
              <tbody>
                {modalExecutives.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-4 text-center text-gray-400">No executives added</td></tr>
                ) : modalExecutives.map((exec, i) => (
                  <tr key={i} className="border-t">
                    {modalMode !== 'view' && (
                      <td className="px-4 py-2">
                        <button onClick={() => handleRemoveExec(i)} className="text-red-600 hover:text-red-800">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </td>
                    )}
                    <td className="px-4 py-2">{exec.executiveName}</td>
                    <td className="px-4 py-2">{exec.dayCashOutMandatory ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center pt-4 border-t">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            {modalMode !== 'view' && <Button onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save'}</Button>}
          </div>
        </div>
      </Modal>
    </div>
  );
}
