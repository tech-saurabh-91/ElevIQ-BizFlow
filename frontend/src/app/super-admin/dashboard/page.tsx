'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import PasswordInput from '@/components/common/PasswordInput';
import LocationSelects from '@/components/common/LocationSelects';
import { COUNTRIES_DATA } from '@/utils/locationData';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

interface Company {
  _id: string; companyName: string; companyCode: string; email: string; phone: string;
  phoneCountryCode?: string; address?: string; city?: string; state?: string; country?: string;
  pincode?: string; noOfUsers: number; activeUsers: number; licenseValidFrom: string; licenseValidTo: string;
  isLicenseActive: boolean; isActive: boolean; taxInclusive: boolean; taxInclusiveLocked?: boolean;
  logo?: string; gstNumber?: string; stateCode?: string; licenseType?: string;
  financialYearStart?: { month: number; day: number };
  daysUntilExpiry: number; adminUserId?: { firstName: string; lastName: string; email: string };
}

const InputField = ({ label, required, error, ...props }: any) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    <input {...props} className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 ${error ? 'border-red-500' : 'border-gray-300'} ${props.className || ''}`} />
    {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
  </div>
);

export default function SuperAdminDashboard() {
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stats, setStats] = useState({ totalCompanies: 0, activeCompanies: 0, totalUsers: 0, expiredLicenses: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extendCompanyId, setExtendCompanyId] = useState('');
  const [extendDate, setExtendDate] = useState('');
  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES_DATA[0]);
  const [phoneError, setPhoneError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [formData, setFormData] = useState({
    companyName: '', email: '', phone: '', phoneCountryCode: '+91', address: '', city: '', state: '', country: 'India',
    pincode: '', noOfUsers: '5', licenseValidFrom: '', licenseValidTo: '', taxInclusive: false, gstEnabled: false, gstNumber: '', stateCode: '',
    licenseType: 'monthly', firstName: '', lastName: '', username: '', password: '', confirmPassword: '',
    financialYearMonth: 1, financialYearDay: 1,
  });
  const router = useRouter();

  const getToken = () => localStorage.getItem('superAdminToken');

  const apiFetch = async (url: string, options: any = {}) => {
    const res = await fetch(`${API_URL}${url}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...options.headers },
    });
    if (res.status === 401) { localStorage.removeItem('superAdminToken'); router.push('/super-admin/login'); throw new Error('Unauthorized'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
  };

  useEffect(() => {
    if (!getToken()) { router.push('/super-admin/login'); return; }
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [companiesRes, statsRes] = await Promise.all([
        apiFetch(`/super-admin/companies?limit=100${search ? `&search=${search}` : ''}`),
        apiFetch('/super-admin/stats'),
      ]);
      setCompanies(companiesRes.data.data);
      setStats(statsRes.data);
    } catch { toast.error('Failed to load'); } finally { setIsLoading(false); }
  };

  const handleSearch = () => loadData();

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '');
    if (val.length <= selectedCountry.phoneLength) {
      setFormData(prev => ({ ...prev, phone: val }));
      setPhoneError(val.length > 0 && val.length !== selectedCountry.phoneLength ? `Phone must be ${selectedCountry.phoneLength} digits` : '');
    }
  };

  const handlePhoneCountryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const country = COUNTRIES_DATA.find(c => c.phoneCode === e.target.value);
    if (country) { setSelectedCountry(country); setFormData(prev => ({ ...prev, phone: '', phoneCountryCode: country.phoneCode })); setPhoneError(''); }
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setFormData(prev => {
      const confirm = prev.confirmPassword;
      setConfirmPasswordError(confirm && val !== confirm ? 'Passwords do not match' : '');
      return { ...prev, password: val };
    });
    setPasswordError(val.length < 6 ? 'Password must be at least 6 characters' : '');
  };

  const handleConfirmPasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setFormData(prev => {
      setConfirmPasswordError(val !== prev.password ? 'Passwords do not match' : '');
      return { ...prev, confirmPassword: val };
    });
  };

  const resetForm = () => {
    setFormData({
      companyName: '', email: '', phone: '', phoneCountryCode: '+91', address: '', city: '', state: '', country: 'India',
      pincode: '', noOfUsers: '5', licenseValidFrom: '', licenseValidTo: '', taxInclusive: false, gstEnabled: false, gstNumber: '', stateCode: '',
      licenseType: 'monthly', firstName: '', lastName: '', username: '', password: '', confirmPassword: '',
      financialYearMonth: 1, financialYearDay: 1,
    });
    setSelectedCountry(COUNTRIES_DATA[0]); setPhoneError(''); setPasswordError(''); setConfirmPasswordError(''); setEditingCompany(null);
  };

  const openCreate = () => { resetForm(); setView('create'); };

  const openEdit = (c: Company) => {
    setEditingCompany(c);
    const phoneCode = c.phoneCountryCode || '+91';
    const country = COUNTRIES_DATA.find(ct => ct.phoneCode === phoneCode) || COUNTRIES_DATA[0];
    setSelectedCountry(country);
    setFormData({
      companyName: c.companyName || '', email: c.email || '', phone: c.phone || '', phoneCountryCode: phoneCode,
      address: c.address || '', city: c.city || '', state: c.state || '', country: c.country || 'India',
      pincode: c.pincode || '', noOfUsers: String(c.noOfUsers || 5),
      licenseValidFrom: c.licenseValidFrom ? c.licenseValidFrom.split('T')[0] : '',
      licenseValidTo: c.licenseValidTo ? c.licenseValidTo.split('T')[0] : '',
      taxInclusive: c.taxInclusive || false, gstEnabled: (c as any).gstEnabled || false,
      gstNumber: c.gstNumber || '', stateCode: c.stateCode || '',
      licenseType: c.licenseType || 'monthly', firstName: '', lastName: '', username: '', password: '', confirmPassword: '',
      financialYearMonth: (c as any).financialYearStart?.month || 1,
      financialYearDay: (c as any).financialYearStart?.day || 1,
    });
    setView('edit');
  };

  const handleSubmitCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.phone.length !== selectedCountry.phoneLength) { setPhoneError(`Phone must be ${selectedCountry.phoneLength} digits`); return; }
    if (!editingCompany) {
      if (formData.password.length < 6) { setPasswordError('Password must be at least 6 characters'); return; }
      if (formData.password !== formData.confirmPassword) { setConfirmPasswordError('Passwords do not match'); return; }
    }

    setIsSaving(true);
    try {
      const payload: any = {
        companyName: formData.companyName, email: formData.email, phone: formData.phone,
        phoneCountryCode: formData.phoneCountryCode, address: formData.address, city: formData.city,
        state: formData.state, country: formData.country, pincode: formData.pincode,
        noOfUsers: Number(formData.noOfUsers), licenseValidFrom: formData.licenseValidFrom,
        licenseValidTo: formData.licenseValidTo, taxInclusive: formData.taxInclusive,
        gstEnabled: formData.gstEnabled, gstNumber: formData.gstNumber, stateCode: formData.stateCode, licenseType: formData.licenseType,
        financialYearStart: { month: formData.financialYearMonth, day: formData.financialYearDay },
      };

      if (editingCompany) {
        await apiFetch(`/super-admin/companies/${editingCompany._id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('Company updated successfully');
      } else {
        payload.firstName = formData.firstName;
        payload.lastName = formData.lastName;
        payload.username = formData.username || formData.email.split('@')[0];
        payload.password = formData.password;
        await apiFetch('/super-admin/companies', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Company created successfully with admin user');
      }
      setView('list'); resetForm(); loadData();
    } catch (err: any) { toast.error(err.message); } finally { setIsSaving(false); }
  };

  const handleExtendLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch(`/super-admin/companies/${extendCompanyId}/extend-license`, { method: 'PUT', body: JSON.stringify({ licenseValidTo: extendDate }) });
      toast.success('License extended'); setShowExtendModal(false); setExtendCompanyId(''); setExtendDate(''); loadData();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleToggleActive = async (id: string) => {
    try { await apiFetch(`/super-admin/companies/${id}/toggle-active`, { method: 'PUT' }); toast.success('Status toggled'); loadData(); }
    catch (err: any) { toast.error(err.message); }
  };

  const handleDeleteCompany = async (id: string) => {
    if (!confirm('Delete this company and all its users?')) return;
    try { await apiFetch(`/super-admin/companies/${id}`, { method: 'DELETE' }); toast.success('Deleted'); loadData(); }
    catch (err: any) { toast.error(err.message); }
  };

  const handleLogout = () => { localStorage.removeItem('superAdminToken'); localStorage.removeItem('superAdmin'); router.push('/super-admin/login'); };

  // CREATE / EDIT FORM
  if (view === 'create' || view === 'edit') {
    const isEdit = view === 'edit';
    return (
      <div className="min-h-screen bg-gray-100">
        <header className="bg-slate-800 text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{isEdit ? 'Edit Company' : 'Create New Company'}</h1>
            <p className="text-sm text-slate-300">{isEdit ? `Editing: ${editingCompany?.companyName}` : 'Fill in all company details'}</p>
          </div>
          <button onClick={() => { setView('list'); resetForm(); }} className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-500 text-sm">Back to List</button>
        </header>

        <div className="max-w-4xl mx-auto p-6">
          <form onSubmit={handleSubmitCompany} className="space-y-6">
            {/* Company Information */}
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b">Company Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InputField label="Company Name" required value={formData.companyName} onChange={(e: any) => setFormData({ ...formData, companyName: e.target.value })} placeholder="Enter company name" />
                <InputField label="Email" type="email" required value={formData.email} onChange={(e: any) => setFormData({ ...formData, email: e.target.value })} placeholder="company@email.com" disabled={isEdit} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone <span className="text-red-500">*</span></label>
                  <div className="flex gap-2">
                    <select value={formData.phoneCountryCode} onChange={handlePhoneCountryChange} className="w-28 px-2 py-2 border rounded-lg bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500">
                      {COUNTRIES_DATA.map(c => <option key={c.code} value={c.phoneCode}>{c.phoneCode} {c.code}</option>)}
                    </select>
                    <input type="tel" required value={formData.phone} onChange={handlePhoneChange} placeholder={`${selectedCountry.phoneLength} digits`}
                      className={`flex-1 min-w-0 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 ${phoneError ? 'border-red-500' : 'border-gray-300'}`} />
                  </div>
                  {phoneError && <p className="text-xs text-red-500 mt-1">{phoneError}</p>}
                </div>
                <InputField label="Address" value={formData.address} onChange={(e: any) => setFormData({ ...formData, address: e.target.value })} placeholder="Street address" />
                <InputField label="Pincode" value={formData.pincode} onChange={(e: any) => setFormData({ ...formData, pincode: e.target.value })} placeholder="Pincode" />
              </div>
            </div>

            {/* Country / State / City */}
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b">Location</h2>
              <LocationSelects
                country={formData.country}
                state={formData.state}
                city={formData.city}
                stateCode={formData.stateCode}
                onCountryChange={(val) => setFormData({ ...formData, country: val, state: '', city: '', stateCode: '' })}
                onStateChange={(val, code) => setFormData({ ...formData, state: val, stateCode: code, city: '' })}
                onCityChange={(val) => setFormData({ ...formData, city: val })}
                showCity={true}
                showStateCode={true}
                required
              />
            </div>

            {/* Tax & GST */}
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b">Tax Configuration</h2>

              {/* GST Toggle */}
              <div className="mb-4">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input type="checkbox" checked={formData.gstEnabled}
                    onChange={(e) => setFormData({ ...formData, gstEnabled: e.target.checked })} className="h-5 w-5 text-slate-600 rounded" />
                  <div>
                    <span className="font-medium text-gray-900">Enable GST</span>
                    <p className="text-xs text-gray-500">Enable GST with HSN codes and CGST/SGST/IGST breakup. Disable for simple tax (VAT/GST single).</p>
                  </div>
                </label>
              </div>

              {formData.gstEnabled ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InputField label="GST Number" value={formData.gstNumber} onChange={(e: any) => setFormData({ ...formData, gstNumber: e.target.value })} placeholder="22AAAAA0000A1Z5" />
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">State Code</label>
                      <input type="text" value={formData.stateCode} readOnly placeholder="Auto-filled from state"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500" />
                    </div>
                  </div>
                  <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-700">GST Mode: Tax Master will have CGST, SGST, IGST fields. HSN Master will be available. Items can be linked to HSN codes.</p>
                  </div>
                </>
              ) : (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-700">Non-GST Mode: Tax Master will have simple tax % (e.g., GST 16%, VAT 5%). No HSN codes. Items linked directly to tax.</p>
                </div>
              )}

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Tax Calculation Mode <span className="text-red-500">*</span></label>
                <div className="flex gap-6">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input type="radio" name="taxInclusive" checked={formData.taxInclusive === false}
                      onChange={() => setFormData({ ...formData, taxInclusive: false })} className="h-4 w-4 text-slate-600" />
                    <div>
                      <span className="font-medium text-gray-900">Tax Exclusive</span>
                      <p className="text-xs text-gray-500">Tax added on top of price</p>
                    </div>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input type="radio" name="taxInclusive" checked={formData.taxInclusive === true}
                      onChange={() => setFormData({ ...formData, taxInclusive: true })} className="h-4 w-4 text-slate-600" />
                    <div>
                      <span className="font-medium text-gray-900">Tax Inclusive</span>
                      <p className="text-xs text-gray-500">Tax included in price</p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Financial Year Start <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Month</label>
                    <select value={formData.financialYearMonth} onChange={(e) => setFormData({ ...formData, financialYearMonth: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500">
                      {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                        <option key={i} value={i + 1}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Day</label>
                    <select value={formData.financialYearDay} onChange={(e) => setFormData({ ...formData, financialYearDay: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500">
                      {Array.from({ length: 31 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>{i + 1}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">Locked after company creation. Used for monthly targets and reports.</p>
              </div>
            </div>

            {/* License & Users */}
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b">License & Users</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InputField label="Max Users" type="number" min="1" value={formData.noOfUsers} onChange={(e: any) => setFormData({ ...formData, noOfUsers: e.target.value })} />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">License Type</label>
                  <select value={formData.licenseType} onChange={(e) => setFormData({ ...formData, licenseType: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500">
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="half-yearly">Half Yearly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <InputField label="License From" type="date" required value={formData.licenseValidFrom} onChange={(e: any) => setFormData({ ...formData, licenseValidFrom: e.target.value })} />
                <InputField label="License To" type="date" required value={formData.licenseValidTo} onChange={(e: any) => setFormData({ ...formData, licenseValidTo: e.target.value })} />
              </div>
              {isEdit && (
                <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-700">To extend the license, use the &quot;Extend&quot; button from the company list.</p>
                </div>
              )}
            </div>

            {/* Admin User - Only for create */}
            {!isEdit && (
              <div className="bg-white rounded-xl shadow p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b">Admin User Account</h2>
                <p className="text-sm text-gray-500 mb-4">This user will be the company administrator with full access.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <InputField label="First Name" required value={formData.firstName} onChange={(e: any) => setFormData({ ...formData, firstName: e.target.value })} placeholder="Admin first name" />
                  <InputField label="Last Name" required value={formData.lastName} onChange={(e: any) => setFormData({ ...formData, lastName: e.target.value })} placeholder="Admin last name" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <InputField label="Username" value={formData.username} onChange={(e: any) => setFormData({ ...formData, username: e.target.value })} placeholder="Defaults to email prefix" />
                  <PasswordInput label="Password" required value={formData.password} onChange={handlePasswordChange} placeholder="Min 6 characters" error={passwordError} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <PasswordInput label="Confirm Password" required value={formData.confirmPassword} onChange={handleConfirmPasswordChange} placeholder="Re-enter password" error={confirmPasswordError} />
                  <div></div>
                </div>
              </div>
            )}

            {/* Submit */}
            <div className="flex justify-end space-x-4">
              <button type="button" onClick={() => { setView('list'); resetForm(); }}
                className="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium">Cancel</button>
              <button type="submit" disabled={isSaving}
                className="px-6 py-3 bg-slate-800 text-white rounded-lg hover:bg-slate-700 font-medium disabled:opacity-50">
                {isSaving ? 'Saving...' : isEdit ? 'Update Company' : 'Create Company & Admin User'}
              </button>
            </div>
          </form>
        </div>

        {showExtendModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
              <div className="p-6 border-b"><h2 className="text-xl font-bold">Extend License</h2></div>
              <form onSubmit={handleExtendLicense} className="p-6 space-y-4">
                <InputField label="New Expiry Date" type="date" required value={extendDate} onChange={(e: any) => setExtendDate(e.target.value)} min={new Date().toISOString().split('T')[0]} />
                <div className="flex justify-end space-x-3 pt-4">
                  <button type="button" onClick={() => setShowExtendModal(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">Extend</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // LIST VIEW
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-slate-800 text-white px-6 py-4 flex items-center justify-between">
        <div><h1 className="text-xl font-bold">ElevIQ Super Admin</h1><p className="text-sm text-slate-300">Company Management Portal</p></div>
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/super-admin/cities')} className="text-slate-300 hover:text-white text-sm px-3 py-1 bg-slate-700 rounded-lg hover:bg-slate-600">City Management</button>
          <button onClick={handleLogout} className="text-slate-300 hover:text-white text-sm">Logout</button>
        </div>
      </header>

      <div className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Companies', value: stats.totalCompanies, color: 'text-blue-600' },
            { label: 'Active Companies', value: stats.activeCompanies, color: 'text-green-600' },
            { label: 'Total Users', value: stats.totalUsers, color: 'text-purple-600' },
            { label: 'Expired Licenses', value: stats.expiredLicenses, color: 'text-red-600' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl shadow p-4">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search company name, code, email..." className="flex-1 px-4 py-2 border rounded-lg" />
          <button onClick={handleSearch} className="px-4 py-2 bg-gray-200 rounded-lg">Search</button>
          <button onClick={openCreate} className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700">+ New Company</button>
        </div>

        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Company</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Code</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Users</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">License</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Expiry</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
              ) : companies.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No companies found</td></tr>
              ) : companies.map((c) => (
                <tr key={c._id} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><p className="font-medium">{c.companyName}</p><p className="text-xs text-gray-500">{c.email}</p></td>
                  <td className="px-4 py-3 font-mono text-xs">{c.companyCode}</td>
                  <td className="px-4 py-3">{c.activeUsers}/{c.noOfUsers}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${c.isLicenseActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {c.isLicenseActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-sm ${c.daysUntilExpiry <= 10 ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                      {new Date(c.licenseValidTo).toLocaleDateString()}
                      {c.daysUntilExpiry <= 10 && c.daysUntilExpiry >= 0 && <span className="ml-1 text-xs">({c.daysUntilExpiry}d)</span>}
                      {c.daysUntilExpiry < 0 && <span className="ml-1 text-xs text-red-500">(Expired)</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${c.isActive ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}>
                      {c.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex space-x-2 text-xs">
                      <button onClick={() => openEdit(c)} className="text-blue-600 hover:underline">Edit</button>
                      <button onClick={() => { setExtendCompanyId(c._id); setShowExtendModal(true); }} className="text-green-600 hover:underline">Extend</button>
                      <button onClick={() => handleToggleActive(c._id)} className={c.isActive ? 'text-orange-600 hover:underline' : 'text-green-600 hover:underline'}>
                        {c.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => handleDeleteCompany(c._id)} className="text-red-600 hover:underline">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showExtendModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b"><h2 className="text-xl font-bold">Extend License</h2></div>
            <form onSubmit={handleExtendLicense} className="p-6 space-y-4">
              <InputField label="New Expiry Date" type="date" required value={extendDate} onChange={(e: any) => setExtendDate(e.target.value)} min={new Date().toISOString().split('T')[0]} />
              <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setShowExtendModal(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">Extend</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
