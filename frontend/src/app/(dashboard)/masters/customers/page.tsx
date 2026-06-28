'use client';

import { useEffect, useState } from 'react';
import { moduleAPI } from '@/services/api';
import { usePermission } from '@/hooks/usePermission';
import { Customer } from '@/types';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import LocationSelects from '@/components/common/LocationSelects';
import toast from 'react-hot-toast';
import { COUNTRIES_DATA } from '@/utils/locationData';

export default function CustomersPage() {
  const perm = usePermission('/masters/customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerTypes, setCustomerTypes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({
    customerName: '',
    contactPerson: '',
    phone: '',
    phoneCountryCode: '+91',
    email: '',
    address: '',
    city: '',
    state: '',
    country: 'India',
    stateCode: '',
    pincode: '',
    customerType: 'retailer',
    gstNumber: '',
    creditLimit: '0',
  });

  useEffect(() => {
    fetchCustomers();
    fetchCustomerTypes();
  }, []);

  const fetchCustomers = async () => {
    try {
      const response = await moduleAPI.getCustomers();
      setCustomers(response.data.data);
    } catch (error) {
      toast.error('Failed to fetch customers');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCustomerTypes = async () => {
    try {
      const response = await moduleAPI.getParameters({ type: 'customer_type' });
      setCustomerTypes(response.data.data);
    } catch (error) {
      console.error('Failed to fetch customer types');
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.customerName.trim()) errs.customerName = 'Customer name is required';
    if (!formData.phone.trim()) errs.phone = 'Phone number is required';
    else if (!/^\d+$/.test(formData.phone)) errs.phone = 'Phone must contain only numbers';
    else {
      const country = COUNTRIES_DATA.find(c => c.phoneCode === formData.phoneCountryCode);
      if (country && formData.phone.length !== country.phoneLength) {
        errs.phone = `${country.name} phone must be ${country.phoneLength} digits`;
      }
    }
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errs.email = 'Enter a valid email address';
    }
    if (!formData.address.trim()) errs.address = 'Address is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      const payload = {
        ...formData,
        phone: `${formData.phoneCountryCode}${formData.phone}`,
        creditLimit: Number(formData.creditLimit),
      };
      if (editingCustomer) {
        await moduleAPI.updateCustomer(editingCustomer._id, payload);
        toast.success('Customer updated successfully');
      } else {
        await moduleAPI.createCustomer(payload);
        toast.success('Customer created successfully');
      }
      setIsModalOpen(false);
      setEditingCustomer(null);
      resetForm();
      fetchCustomers();
    } catch (error: any) {
      const msg = error.response?.data?.message || 'Operation failed';
      toast.error(msg);
      setErrors({ submit: msg });
    }
  };

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    const phone = customer.phone || '';
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
      customerName: customer.customerName,
      contactPerson: customer.contactPerson || '',
      phone: number,
      phoneCountryCode: code,
      email: customer.email || '',
      address: customer.address,
      city: customer.city || '',
      state: customer.state || '',
      country: (customer as any).country || 'India',
      stateCode: (customer as any).stateCode || '',
      pincode: customer.pincode || '',
      customerType: customer.customerType,
      gstNumber: customer.gstNumber || '',
      creditLimit: String(customer.creditLimit),
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this customer?')) return;
    try {
      await moduleAPI.deleteCustomer(id);
      toast.success('Customer deleted successfully');
      fetchCustomers();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete');
    }
  };

  const resetForm = () => {
    setFormData({
      customerName: '', contactPerson: '', phone: '', phoneCountryCode: '+91', email: '', address: '',
      city: '', state: '', country: 'India', stateCode: '', pincode: '', customerType: 'retailer', gstNumber: '', creditLimit: '0',
    });
    setErrors({});
  };

  const phoneCountry = COUNTRIES_DATA.find(c => c.phoneCode === formData.phoneCountryCode);

  const columns = [
    {
      key: 'customer',
      label: 'Customer',
      render: (c: Customer) => (
        <div>
          <p className="font-medium text-gray-900">{c.customerName}</p>
          <p className="text-sm text-gray-500">{c.customerCode}</p>
        </div>
      ),
    },
    { key: 'phone', label: 'Phone' },
    { key: 'city', label: 'City' },
    {
      key: 'customerType',
      label: 'Type',
      render: (c: Customer) => (
        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 capitalize">{c.customerType}</span>
      ),
    },
    {
      key: 'outstandingAmount',
      label: 'Outstanding',
      render: (c: Customer) => `₹${c.outstandingAmount.toLocaleString()}`,
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (c: Customer) => (
        <div className="flex space-x-2">
          {perm.canEdit && <button onClick={() => handleEdit(c)} className="text-blue-600 hover:text-blue-800">Edit</button>}
          {perm.canDelete && <button onClick={() => handleDelete(c._id)} className="text-red-600 hover:text-red-800">Delete</button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
        {perm.canCreate && <Button onClick={() => { resetForm(); setIsModalOpen(true); }}>+ Add Customer</Button>}
      </div>

      <Table columns={columns} data={customers} isLoading={isLoading} />

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingCustomer(null); setErrors({}); }} title={editingCustomer ? 'Edit Customer' : 'Add Customer'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.submit && (
            <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm">
              {errors.submit}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Input label="Customer Name" required value={formData.customerName} onChange={(e) => setFormData({ ...formData, customerName: e.target.value })} />
              {errors.customerName && <p className="text-red-500 text-xs mt-1">{errors.customerName}</p>}
            </div>
            <Input label="Contact Person" value={formData.contactPerson} onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
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
            <div>
              <Input label="Email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
            </div>
          </div>
          <div>
            <Input label="Address" required value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
            {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address}</p>}
          </div>
          <LocationSelects
            country={formData.country}
            state={formData.state}
            city={formData.city}
            stateCode={formData.stateCode}
            onCountryChange={(val) => setFormData({ ...formData, country: val, state: '', city: '', stateCode: '' })}
            onStateChange={(val, code) => setFormData({ ...formData, state: val, stateCode: code, city: '' })}
            onCityChange={(val) => setFormData({ ...formData, city: val })}
            showCity={true}
            showStateCode={false}
          />
          <div>
            <Input label="Pincode" value={formData.pincode} onChange={(e) => setFormData({ ...formData, pincode: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select value={formData.customerType} onChange={(e) => setFormData({ ...formData, customerType: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="">Select Type</option>
                {customerTypes.length > 0 ? (
                  customerTypes.map((t: any) => <option key={t._id} value={t.parameterValue}>{t.parameterValue}</option>)
                ) : (
                  <option value="retailer" disabled>No types created. Add in Parameters.</option>
                )}
              </select>
            </div>
            <Input label="GST Number" value={formData.gstNumber} onChange={(e) => setFormData({ ...formData, gstNumber: e.target.value })} />
            <Input label="Credit Limit" type="number" value={formData.creditLimit} onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })} />
          </div>
          <div className="flex justify-end space-x-3 pt-4">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setEditingCustomer(null); setErrors({}); }}>Cancel</Button>
            <Button type="submit">{editingCustomer ? 'Update' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
