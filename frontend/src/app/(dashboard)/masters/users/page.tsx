'use client';

import { useEffect, useState } from 'react';
import { masterAPI, moduleAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import { User, Role } from '@/types';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import PasswordInput from '@/components/common/PasswordInput';
import toast from 'react-hot-toast';
import { COUNTRIES_DATA } from '@/utils/locationData';

export default function UsersPage() {
  const perm = usePermission('/masters/users');
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [designations, setDesignations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    phoneCountryCode: '+91',
    username: '',
    password: '',
    roleId: '',
    designation: 'executive',
  });

  useEffect(() => {
    fetchUsers();
    fetchRoles();
    fetchDesignations();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await masterAPI.getUsers();
      setUsers(response.data.data);
    } catch (error) {
      toast.error('Failed to fetch users');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const response = await masterAPI.getRoles();
      setRoles(response.data.data);
    } catch (error) {
      console.error('Failed to fetch roles');
    }
  };

  const fetchDesignations = async () => {
    try {
      const response = await moduleAPI.getParameters({ type: 'designation' });
      setDesignations(response.data.data);
    } catch (error) {
      console.error('Failed to fetch designations');
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.firstName.trim()) errs.firstName = 'First name is required';
    if (!formData.lastName.trim()) errs.lastName = 'Last name is required';
    if (!formData.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errs.email = 'Enter a valid email address';
    if (!formData.phone.trim()) errs.phone = 'Phone number is required';
    else if (!/^\d+$/.test(formData.phone)) errs.phone = 'Phone must contain only numbers';
    else {
      const country = COUNTRIES_DATA.find(c => c.phoneCode === formData.phoneCountryCode);
      if (country && formData.phone.length !== country.phoneLength) {
        errs.phone = `${country.name} phone must be ${country.phoneLength} digits`;
      }
    }
    if (!formData.username.trim()) errs.username = 'Username is required';
    if (!editingUser && !formData.password) errs.password = 'Password is required';
    else if (!editingUser && formData.password.length < 6) errs.password = 'Password must be at least 6 characters';
    if (!formData.roleId) errs.roleId = 'Please select a role';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      setIsSaving(true);
      const payload = {
        ...formData,
        phone: `${formData.phoneCountryCode}${formData.phone}`,
      };
      if (editingUser) {
        await masterAPI.updateUser(editingUser._id, payload);
        toast.success('User updated successfully');
      } else {
        await masterAPI.createUser(payload);
        toast.success('User created successfully');
      }
      setIsModalOpen(false);
      setEditingUser(null);
      resetForm();
      fetchUsers();
    } catch (error: any) {
      const msg = error.response?.data?.message || 'Operation failed';
      const fieldErrors = error.response?.data?.errors || [];
      const fullMsg = fieldErrors.length > 0 ? `${msg}: ${fieldErrors.join(', ')}` : msg;
      toast.error(fullMsg);
      setErrors({ submit: fullMsg });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    const phone = user.phone || '';
    let code = '+91';
    let number = phone;
    for (const c of COUNTRIES_DATA) {
      if (phone.startsWith(c.phoneCode)) {
        code = c.phoneCode;
        number = phone.substring(c.phoneCode.length);
        break;
      }
    }
    setFormData({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: number,
      phoneCountryCode: code,
      username: user.username,
      password: '',
      roleId: (user.roleId as Role)?._id || '',
      designation: user.designation,
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      await masterAPI.deleteUser(id);
      toast.success('User deleted successfully');
      fetchUsers();
    } catch (error: any) {
      const msg = error.response?.data?.message || 'Failed to delete user';
      toast.error(msg);
    }
  };

  const handleDeactivate = async (id: string) => {
    try {
      await masterAPI.deactivateUser(id);
      toast.success('User deactivated');
      fetchUsers();
    } catch (error: any) {
      const msg = error.response?.data?.message || 'Failed to deactivate';
      toast.error(msg);
    }
  };

  const resetForm = () => {
    setFormData({
      firstName: '', lastName: '', email: '', phone: '', phoneCountryCode: '+91',
      username: '', password: '', roleId: '', designation: 'executive',
    });
    setErrors({});
  };

  const phoneCountry = COUNTRIES_DATA.find(c => c.phoneCode === formData.phoneCountryCode);

  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: (user: User) => (
        <div>
          <p className="font-medium text-gray-900">{user.firstName} {user.lastName}</p>
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>
      ),
    },
    { key: 'username', label: 'Username' },
    { key: 'phone', label: 'Phone' },
    {
      key: 'designation',
      label: 'Designation',
      render: (user: User) => (
        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 capitalize">
          {user.designation}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (user: User) => (
        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
          user.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {user.isActive ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (user: User) => (
        <div className="flex space-x-2">
          {perm.canEdit && <button onClick={() => handleEdit(user)} className="text-blue-600 hover:text-blue-800">Edit</button>}
          {perm.canEdit && <button onClick={() => handleDeactivate(user._id)} className="text-yellow-600 hover:text-yellow-800">
            {user.isActive ? 'Deactivate' : 'Activate'}
          </button>}
          {perm.canDelete && <button onClick={() => handleDelete(user._id)} className="text-red-600 hover:text-red-800">Delete</button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        {perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Add User</Button>}
      </div>

      <Table columns={columns} data={users} isLoading={isLoading} />

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingUser(null); setErrors({}); }} title={editingUser ? 'Edit User' : 'Add User'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && (
            <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm">
              {errors.submit}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Input label="First Name" required value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} />
              {errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName}</p>}
            </div>
            <div>
              <Input label="Last Name" required value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} />
              {errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Input label="Email" type="email" required value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone <span className="text-red-500">*</span></label>
              <div className="flex">
                <select value={formData.phoneCountryCode} onChange={(e) => setFormData({ ...formData, phoneCountryCode: e.target.value })}
                  className="w-[130px] px-2 py-2 border border-r-0 border-gray-300 rounded-l-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-500">
                  {COUNTRIES_DATA.map(c => (
                    <option key={c.code} value={c.phoneCode}>{c.name} ({c.phoneCode})</option>
                  ))}
                </select>
                <input type="tel" value={formData.phone} onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  const maxLen = phoneCountry?.phoneLength || 15;
                  setFormData({ ...formData, phone: val.slice(0, maxLen) });
                }} placeholder={`e.g. ${phoneCountry?.phoneLength || 10} digits`}
                  className="w-full px-3 py-2 border border-gray-300 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-slate-500" required />
              </div>
              {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Input label="Username" required value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} />
              {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username}</p>}
            </div>
            {!editingUser && (
              <div>
                <PasswordInput label="Password" required value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
                {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role <span className="text-red-500">*</span></label>
              <select value={formData.roleId} onChange={(e) => setFormData({ ...formData, roleId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500">
                <option value="">Select Role</option>
                {roles.map((role) => (
                  <option key={role._id} value={role._id}>{role.roleName}</option>
                ))}
              </select>
              {errors.roleId && <p className="text-red-500 text-xs mt-1">{errors.roleId}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Designation</label>
              <select value={formData.designation} onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500">
                <option value="">Select Designation</option>
                {designations.length > 0 ? (
                  designations.map((d: any) => <option key={d._id} value={d.parameterValue}>{d.parameterValue}</option>)
                ) : (
                  <option value="executive" disabled>No designations created. Add in Parameters.</option>
                )}
              </select>
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-4">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditingUser(null); setErrors({}); }}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : (editingUser ? 'Update' : 'Create')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
