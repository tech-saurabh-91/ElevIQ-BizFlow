'use client';

import { useEffect, useState, useRef } from 'react';
import { moduleAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import toast from 'react-hot-toast';

export default function ItemGroupsPage() {
  const perm = usePermission('/masters/item-groups');
  const [groups, setGroups] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({ groupName: '', description: '' });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchGroups(); }, []);

  const fetchGroups = async () => {
    try { const res = await moduleAPI.getItemGroups(); setGroups(res.data.data); } catch { toast.error('Failed'); } finally { setIsLoading(false); }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsSaving(true);
    try {
      const payload = new FormData();
      payload.append('groupName', formData.groupName);
      payload.append('description', formData.description);
      if (imageFile) payload.append('image', imageFile);

      if (editing) { await moduleAPI.updateItemGroup(editing._id, payload); toast.success('Updated'); }
      else { await moduleAPI.createItemGroup(payload); toast.success('Created'); }
      setIsModalOpen(false); setEditing(null); resetForm(); fetchGroups();
    } catch (err: any) { setErrors({ submit: err.response?.data?.message || err.message || 'Failed' }); }
    finally { setIsSaving(false); }
  };

  const handleEdit = (g: any) => {
    setEditing(g);
    setFormData({ groupName: g.groupName, description: g.description || '' });
    setImagePreview(g.image || '');
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete?')) return;
    try { await moduleAPI.deleteItemGroup(id); toast.success('Deleted'); fetchGroups(); } catch { toast.error('Failed'); }
  };

  const resetForm = () => { setFormData({ groupName: '', description: '' }); setImageFile(null); setImagePreview(''); };

  const columns = [
    { key: 'image', label: 'Image', render: (g: any) => g.image ? <img src={g.image} alt="" className="w-10 h-10 rounded object-cover" /> : <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center text-gray-400 text-xs">No</div> },
    { key: 'group', label: 'Group', render: (g: any) => <div><p className="font-medium">{g.groupName}</p><p className="text-xs text-gray-500">{g.groupCode}</p></div> },
    { key: 'description', label: 'Description' },
    { key: 'isActive', label: 'Status', render: (g: any) => <span className={`px-2 py-1 text-xs rounded-full ${g.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{g.isActive ? 'Active' : 'Inactive'}</span> },
    { key: 'actions', label: 'Actions', render: (g: any) => <div className="flex space-x-2">{perm.canEdit && <button onClick={() => handleEdit(g)} className="text-blue-600">Edit</button>}{perm.canDelete && <button onClick={() => handleDelete(g._id)} className="text-red-600">Delete</button>}</div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Item Groups</h1>{perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Add Group</Button>}</div>
      <Table columns={columns} data={groups} isLoading={isLoading} />
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditing(null); }} title={editing ? 'Edit Group' : 'Add Group'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{errors.submit}</div>}
          <Input label="Group Name" required value={formData.groupName} onChange={(e: any) => setFormData({ ...formData, groupName: e.target.value })} />
          <Input label="Description" value={formData.description} onChange={(e: any) => setFormData({ ...formData, description: e.target.value })} />
          <div>
            <label className="block text-sm font-medium mb-1">Image</label>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
            <div className="flex items-center space-x-4">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Choose Image</button>
              {imagePreview && <img src={imagePreview} alt="" className="w-16 h-16 rounded object-cover" />}
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-4"><Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditing(null); }}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : (editing ? 'Update' : 'Create')}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
