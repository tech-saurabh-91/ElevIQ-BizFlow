'use client';

import { useEffect, useState } from 'react';
import { masterAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import { useAuthStore } from '@/store/authStore';
import { Role } from '@/types';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import toast from 'react-hot-toast';

const defaultMenus = [
  { menuName: 'Dashboard', menuPath: '/dashboard', canView: true, canCreate: false, canEdit: false, canDelete: false },
  { menuName: 'Roles', menuPath: '/masters/roles', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Users', menuPath: '/masters/users', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Warehouses', menuPath: '/masters/warehouses', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Van Link', menuPath: '/masters/vans', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Parameters', menuPath: '/masters/parameters', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Countries', menuPath: '/masters/countries', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Tax Master', menuPath: '/masters/tax', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'HSN Master', menuPath: '/masters/hsn', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Items', menuPath: '/masters/items', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Item Groups', menuPath: '/masters/item-groups', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Item Sub-Groups', menuPath: '/masters/item-sub-groups', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Customers', menuPath: '/masters/customers', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Routes', menuPath: '/masters/routes', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Executive-Product Group', menuPath: '/masters/executive-product-group', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Schemes', menuPath: '/masters/schemes', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Discounts', menuPath: '/masters/discounts', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Stock Adjustment', menuPath: '/masters/stock-adjustment', canView: true, canCreate: true, canEdit: true, canDelete: true },
  { menuName: 'Stock Query', menuPath: '/masters/stock-query', canView: true, canCreate: false, canEdit: false, canDelete: false },
  { menuName: 'Month-Wise Pre-Sales Target', menuPath: '/masters/pre-sales-target', canView: true, canCreate: true, canEdit: true, canDelete: false },
  { menuName: 'Month-Wise Van-Sales Target', menuPath: '/masters/van-sales-target', canView: true, canCreate: true, canEdit: true, canDelete: false },
  { menuName: 'Transactions', menuPath: '/transactions', canView: true, canCreate: true, canEdit: true, canDelete: false },
  { menuName: 'Approvals', menuPath: '/approvals', canView: true, canCreate: false, canEdit: false, canDelete: false },
  { menuName: 'Reports', menuPath: '/reports', canView: true, canCreate: false, canEdit: false, canDelete: false },
];

const mobileMenus = [
  { menuName: 'Sales Order', menuPath: '/mobile/sales-order', canView: true, canCreate: true, canEdit: true, canDelete: false },
  { menuName: 'Expenses', menuPath: '/mobile/expenses', canView: true, canCreate: true, canEdit: false, canDelete: false },
  { menuName: 'Attendance', menuPath: '/mobile/attendance', canView: true, canCreate: true, canEdit: false, canDelete: false },
  { menuName: 'Tour Visit', menuPath: '/mobile/tour-visit', canView: true, canCreate: true, canEdit: false, canDelete: false },
];

export default function RolesPage() {
  const perm = usePermission('/masters/roles');
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { loadUser } = useAuthStore();
  const [formData, setFormData] = useState({
    roleName: '',
    roleType: 'backoffice',
    mobileSubType: '',
    menus: [...defaultMenus],
  });

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    try {
      const response = await masterAPI.getRoles();
      setRoles(response.data.data);
    } catch (error) {
      toast.error('Failed to fetch roles');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRoleTypeChange = (type: string) => {
    setFormData({
      ...formData,
      roleType: type,
      menus: type === 'mobile' ? [...mobileMenus] : [...defaultMenus],
    });
  };

  const toggleMenuPermission = (index: number, field: string) => {
    const newMenus = [...formData.menus];
    (newMenus[index] as any)[field] = !(newMenus[index] as any)[field];
    setFormData({ ...formData, menus: newMenus });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsSaving(true);
    try {
      if (editingRole) {
        await masterAPI.updateRole(editingRole._id, formData);
        toast.success('Role updated successfully');
      } else {
        await masterAPI.createRole(formData);
        toast.success('Role created successfully');
      }
      setIsModalOpen(false);
      setEditingRole(null);
      resetForm();
      fetchRoles();
      await loadUser();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Operation failed');
      setErrors({ submit: error.response?.data?.message || error.message || 'Failed' });
    }
    finally { setIsSaving(false); }
  };

  const handleEdit = (role: Role) => {
    setEditingRole(role);
    setFormData({
      roleName: role.roleName,
      roleType: role.roleType,
      mobileSubType: role.mobileSubType || '',
      menus: role.menus,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this role?')) return;
    try {
      await masterAPI.deleteRole(id);
      toast.success('Role deleted successfully');
      fetchRoles();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete');
    }
  };

  const resetForm = () => {
    setFormData({
      roleName: '',
      roleType: 'backoffice',
      mobileSubType: '',
      menus: [...defaultMenus],
    });
  };

  const columns = [
    {
      key: 'roleName',
      label: 'Role Name',
      render: (role: Role) => (
        <div>
          <p className="font-medium text-gray-900">{role.roleName}</p>
          <p className="text-sm text-gray-500">{role.roleType}</p>
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      render: (role: Role) => (
        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
          role.roleType === 'backoffice' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
        }`}>
          {role.roleType}{role.mobileSubType ? ` (${role.mobileSubType})` : ''}
        </span>
      ),
    },
    {
      key: 'menus',
      label: 'Menus',
      render: (role: Role) => (
        <span className="text-sm text-gray-600">{role.menus.length} menus</span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (role: Role) => (
        <div className="flex space-x-2">
          {perm.canEdit && <button onClick={() => handleEdit(role)} className="text-blue-600 hover:text-blue-800">Edit</button>}
          {perm.canDelete && <button onClick={() => handleDelete(role._id)} className="text-red-600 hover:text-red-800">Delete</button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Roles</h1>
        {perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Add Role</Button>}
      </div>

      <Table columns={columns} data={roles} isLoading={isLoading} />

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingRole(null); }} title={editingRole ? 'Edit Role' : 'Add Role'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{errors.submit}</div>}
          <Input label="Role Name" required value={formData.roleName} onChange={(e) => setFormData({ ...formData, roleName: e.target.value })} />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role Type</label>
              <select value={formData.roleType} onChange={(e) => handleRoleTypeChange(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="backoffice">Back Office</option>
                <option value="mobile">Mobile</option>
              </select>
            </div>
            {formData.roleType === 'mobile' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Sub Type</label>
                <select value={formData.mobileSubType} onChange={(e) => setFormData({ ...formData, mobileSubType: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  <option value="presale">Pre-Sale</option>
                  <option value="vansale">Van Sale</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Menu Permissions</label>
            <div className="border rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Menu</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">View</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">Create</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">Edit</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {formData.menus.map((menu, index) => (
                    <tr key={menu.menuPath}>
                      <td className="px-4 py-2 text-sm">{menu.menuName}</td>
                      <td className="px-4 py-2 text-center">
                        <input type="checkbox" checked={menu.canView} onChange={() => toggleMenuPermission(index, 'canView')} className="rounded" />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input type="checkbox" checked={menu.canCreate} onChange={() => toggleMenuPermission(index, 'canCreate')} className="rounded" />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input type="checkbox" checked={menu.canEdit} onChange={() => toggleMenuPermission(index, 'canEdit')} className="rounded" />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input type="checkbox" checked={menu.canDelete} onChange={() => toggleMenuPermission(index, 'canDelete')} className="rounded" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditingRole(null); }}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : editingRole ? 'Update' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
