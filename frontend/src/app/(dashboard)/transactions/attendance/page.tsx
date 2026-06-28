'use client';

import { useEffect, useState } from 'react';
import { transactionAPI, moduleAPI } from '@/services/api';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

export default function AttendancePage() {
  const [records, setRecords] = useState<any[]>([]);
  const [attendanceStatuses, setAttendanceStatuses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({ date: new Date().toISOString().split('T')[0], checkIn: '', checkOut: '', status: 'present', remarks: '' });

  useEffect(() => {
    fetchRecords();
    fetchStatuses();
  }, []);

  const fetchStatuses = async () => {
    try { const res = await moduleAPI.getParameters({ type: 'attendance_status' }); setAttendanceStatuses(res.data.data); } catch {}
  };

  const fetchRecords = async () => {
    try { const res = await transactionAPI.getAttendance(); setRecords(res.data.data); } catch { toast.error('Failed to load'); } finally { setIsLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({}); setIsSaving(true);
    try {
      if (editing) { await transactionAPI.updateAttendance(editing._id, formData); toast.success('Updated'); }
      else { await transactionAPI.createAttendance(formData); toast.success('Marked'); }
      setIsModalOpen(false); setEditing(null); resetForm(); fetchRecords();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Failed'); setErrors({ submit: err.response?.data?.message || err.message || 'Failed' }); } finally { setIsSaving(false); }
  };

  const handleEdit = (r: any) => {
    setEditing(r);
    setFormData({ date: r.date?.split('T')[0] || '', checkIn: r.checkIn || '', checkOut: r.checkOut || '', status: r.status, remarks: r.remarks || '' });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this record?')) return;
    try { await transactionAPI.deleteAttendance(id); toast.success('Deleted'); fetchRecords(); } catch { toast.error('Failed'); }
  };

  const resetForm = () => setFormData({ date: new Date().toISOString().split('T')[0], checkIn: '', checkOut: '', status: 'present', remarks: '' });

  const statusColor = (s: string) => {
    const m: Record<string, string> = { present: 'bg-green-100 text-green-800', absent: 'bg-red-100 text-red-800', half_day: 'bg-yellow-100 text-yellow-800', leave: 'bg-blue-100 text-blue-800' };
    return m[s] || 'bg-gray-100';
  };

  const columns = [
    { key: 'date', label: 'Date', render: (r: any) => r.date ? format(new Date(r.date), 'dd MMM yyyy') : '-' },
    { key: 'user', label: 'Executive', render: (r: any) => r.userId?.firstName ? `${r.userId.firstName} ${r.userId.lastName}` : '-' },
    { key: 'checkIn', label: 'Check In' },
    { key: 'checkOut', label: 'Check Out' },
    { key: 'status', label: 'Status', render: (r: any) => <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColor(r.status)}`}>{r.status?.replace('_', ' ')}</span> },
    { key: 'remarks', label: 'Remarks' },
    { key: 'actions', label: 'Actions', render: (r: any) => <div className="flex space-x-2"><button onClick={() => handleEdit(r)} className="text-blue-600">Edit</button><button onClick={() => handleDelete(r._id)} className="text-red-600">Delete</button></div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Attendance</h1><Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Mark Attendance</Button></div>
      <Table columns={columns} data={records} isLoading={isLoading} />
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditing(null); }} title={editing ? 'Edit Attendance' : 'Mark Attendance'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{errors.submit}</div>}
          <Input label="Date" type="date" required value={formData.date} onChange={(e: any) => setFormData({ ...formData, date: e.target.value })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Check In" type="time" value={formData.checkIn} onChange={(e: any) => setFormData({ ...formData, checkIn: e.target.value })} />
            <Input label="Check Out" type="time" value={formData.checkOut} onChange={(e: any) => setFormData({ ...formData, checkOut: e.target.value })} />
          </div>
          <div><label className="block text-sm font-medium mb-1">Status *</label>
            <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required>
              <option value="">Select Status</option>
              {attendanceStatuses.length > 0 ? (
                attendanceStatuses.map((s: any) => <option key={s._id} value={s.parameterValue}>{s.parameterValue}</option>)
              ) : (
                <option value="present" disabled>No statuses created. Add in Parameters.</option>
              )}
            </select></div>
          <Input label="Remarks" value={formData.remarks} onChange={(e: any) => setFormData({ ...formData, remarks: e.target.value })} />
          <div className="flex justify-end space-x-3 pt-4"><Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditing(null); }}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : (editing ? 'Update' : 'Submit')}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
