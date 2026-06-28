'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { INDIAN_STATES } from '@/utils/locationData';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

export default function CityManagementPage() {
  const [cities, setCities] = useState<any[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [filterState, setFilterState] = useState('');
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCity, setEditingCity] = useState<any>(null);
  const [formData, setFormData] = useState({ country: 'India', state: '', cityName: '', cityCode: '' });
  const [seeding, setSeeding] = useState(false);
  const [hasData, setHasData] = useState(false);
  const router = useRouter();

  const getToken = () => localStorage.getItem('superAdminToken');

  const apiFetch = async (url: string, options: any = {}) => {
    const res = await fetch(`${API_URL}${url}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...options.headers },
    });
    if (res.status === 401) { router.push('/super-admin/login'); throw new Error('Unauthorized'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
  };

  useEffect(() => {
    if (!getToken()) { router.push('/super-admin/login'); return; }
    loadCities();
    loadStates();
  }, [filterState]);

  const loadCities = async () => {
    try {
      const params = filterState ? `?state=${filterState}` : '';
      const res = await apiFetch(`/super-admin/cities${params}`);
      setCities(res.data);
      if (res.data.length > 0) setHasData(true);
    } catch { toast.error('Failed to load cities'); } finally { setIsLoading(false); }
  };

  const loadStates = async () => {
    try {
      const res = await apiFetch('/super-admin/cities/states?country=India');
      setStates(res.data);
      if (res.data.length > 0) setHasData(true);
    } catch {}
  };

  const handleCreate = () => {
    setEditingCity(null);
    setFormData({ country: 'India', state: '', cityName: '', cityCode: '' });
    setIsModalOpen(true);
  };

  const handleEdit = (city: any) => {
    setEditingCity(city);
    setFormData({ country: city.country, state: city.state, cityName: city.cityName, cityCode: city.cityCode || '' });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this city?')) return;
    try {
      await apiFetch(`/super-admin/cities/${id}`, { method: 'DELETE' });
      toast.success('Deleted');
      loadCities();
      loadStates();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (editingCity) {
        await apiFetch(`/super-admin/cities/${editingCity._id}`, { method: 'PUT', body: JSON.stringify(formData) });
        toast.success('Updated');
      } else {
        await apiFetch('/super-admin/cities', { method: 'POST', body: JSON.stringify(formData) });
        toast.success('Created');
      }
      setIsModalOpen(false);
      loadCities();
      loadStates();
    } catch (err: any) { toast.error(err.message); } finally { setIsSaving(false); }
  };

  // Seed Indian cities from our built-in data
  const handleSeedCities = async () => {
    if (!confirm('This will add all major Indian cities to the database. Existing cities will be skipped. Continue?')) return;
    setSeeding(true);
    try {
      const INDIAN_CITIES: Record<string, string[]> = {
        'Maharashtra': ['Mumbai', 'Pune', 'Nagpur', 'Thane', 'Nashik', 'Aurangabad', 'Solapur', 'Kolhapur', 'Amravati', 'Nanded', 'Jalgaon', 'Akola', 'Latur', 'Ahmednagar', 'Chandrapur', 'Parbhani', 'Ichalkaranji', 'Jalna', 'Sangli', 'Malegaon'],
        'Karnataka': ['Bengaluru', 'Mysuru', 'Hubballi', 'Mangaluru', 'Belagavi', 'Gulbarga', 'Davangere', 'Shivamogga', 'Tumakuru', 'Ballari', 'Bidar', 'Hospet', 'Raichur', 'Mandya', 'Hassan', 'Chikkamagaluru'],
        'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode', 'Vellore', 'Thoothukudi', 'Dindigul', 'Thanjavur', 'Ranipet', 'Sivakasi', 'Karur', 'Nagercoil', 'Kanchipuram'],
        'Delhi': ['New Delhi', 'Noida', 'Gurgaon', 'Faridabad', 'Ghaziabad', 'Dwarka', 'Rohini', 'Janakpuri'],
        'Uttar Pradesh': ['Lucknow', 'Kanpur', 'Agra', 'Varanasi', 'Meerut', 'Prayagraj', 'Bareilly', 'Aligarh', 'Moradabad', 'Saharanpur', 'Gorakhpur', 'Noida', 'Jhansi', 'Mathura', 'Allahabad'],
        'Gujarat': ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Junagadh', 'Gandhinagar', 'Anand', 'Bharuch', 'Valsad', 'Mehsana', 'Bhuj', 'Porbandar'],
        'Rajasthan': ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer', 'Bikaner', 'Alwar', 'Bharatpur', 'Jaisalmer', 'Mount Abu', 'Pushkar', 'Bhilwara', 'Sikar', 'Tonk'],
        'West Bengal': ['Kolkata', 'Howrah', 'Durgapur', 'Asansol', 'Siliguri', 'Bardhaman', 'Kharagpur', 'Bally', 'English Bazar', 'Bhatpara'],
        'Madhya Pradesh': ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Satna', 'Rewa', 'Dewas', 'Satna', 'Murwara', 'Bhopal'],
        'Telangana': ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Ramagundam', 'Khammam', 'Mahbubnagar', 'Medak', 'Nalgonda', 'Adilabad'],
        'Andhra Pradesh': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Tirupati', 'Rajahmundry', 'Kakinada', 'Kadapa', 'Anantapur', 'Eluru', 'Ongole', 'Chittoor'],
        'Kerala': ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Kollam', 'Thrissur', 'Alappuzha', 'Palakkad', 'Malappuram', 'Kannur', 'Kasaragod', 'Idukki', 'Wayanad'],
        'Punjab': ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali', 'Hoshiarpur', 'Moga', 'Abohar', 'Pathankot', 'Malerkotla', 'Khanna'],
        'Haryana': ['Faridabad', 'Gurgaon', 'Panipat', 'Ambala', 'Yamunanagar', 'Rohtak', 'Hisar', 'Karnal', 'Sonipat', 'Panchkula', 'Kurukshetra', 'Jind'],
        'Bihar': ['Patna', 'Gaya', 'Muzaffarpur', 'Bhagalpur', 'Darbhanga', 'Arrah', 'Begusarai', 'Katihar', 'Munger', 'Chhapra', 'Buxar', 'Hajipur'],
        'Odisha': ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri', 'Balasore', 'Bhadrak', 'Baripada', 'Jharsuguda'],
        'Jharkhand': ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Deoghar', 'Hazaribagh', 'Gumla', 'Dumka', 'Godda', 'Sahebganj'],
        'Chhattisgarh': ['Raipur', 'Bhilai', 'Bilaspur', 'Korba', 'Durg', 'Rajnandgaon', 'Jagdalpur', 'Ambikapur', 'Dantewada'],
        'Assam': ['Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat', 'Nagaon', 'Tinsukia', 'Tezpur', 'Bongaigaon', 'Barpeta'],
        'Goa': ['Panaji', 'Margao', 'Vasco da Ganda', 'Mapusa', 'Ponda', 'Curchorem', 'Sanquelim'],
        'Uttarakhand': ['Dehradun', 'Haridwar', 'Haldwani', 'Roorkee', 'Rishikesh', 'Kashipur', 'Rudrapur', 'Mussoorie', 'Nainital'],
        'Himachal Pradesh': ['Shimla', 'Manali', 'Dharamshala', 'Kullu', 'Mandi', 'Solan', 'Chamba', 'Hamirpur', 'Kangra'],
        'Jammu and Kashmir': ['Srinagar', 'Jammu', 'Anantnag', 'Baramulla', 'Udhampur', 'Kathua', 'Sopore', 'Budgam'],
        'Chandigarh': ['Chandigarh'],
        'Puducherry': ['Pondicherry', 'Karaikal', 'Mahe', 'Yanam'],
        'Sikkim': ['Gangtok', 'Namchi', 'Gyalshing', 'Rangpo', 'Singtam'],
        'Meghalaya': ['Shillong', 'Tura', 'Cherrapunji', 'Jowai', 'Baghmara'],
        'Manipur': ['Imphal', 'Thoubal', 'Churachandpur', 'Jiribam', 'Kakching'],
        'Nagaland': ['Kohima', 'Dimapur', 'Mokokchung', 'Tuensang', 'Wokha'],
        'Tripura': ['Agartala', 'Udaipur', 'Dharmanagar', 'Kailashahar', 'Belonia'],
        'Mizoram': ['Aizawl', 'Lunglei', 'Saiha', 'Champhai', 'Kolasib'],
        'Arunachal Pradesh': ['Itanagar', 'Naharlagun', 'Pasighat', 'Bomdila', 'Tawang'],
        'Andaman and Nicobar Islands': ['Port Blair', 'Diglipur', 'Rangat', 'Mayabunder'],
        'Dadra and Nagar Haveli and Daman and Diu': ['Daman', 'Diu', 'Silvassa'],
        'Ladakh': ['Leh', 'Kargil'],
        'Lakshadweep': ['Kavaratti', 'Agatti', 'Minicoy'],
      };

      let totalCreated = 0;
      let totalSkipped = 0;

      for (const [state, cities] of Object.entries(INDIAN_CITIES)) {
        const payload = {
          cities: cities.map(cityName => ({
            country: 'India',
            state,
            cityName,
            cityCode: cityName.substring(0, 3).toUpperCase(),
          })),
        };
        const res = await apiFetch('/super-admin/cities/bulk', { method: 'POST', body: JSON.stringify(payload) });
        totalCreated += res.data.created;
        totalSkipped += res.data.skipped;
      }

      toast.success(`Done! Created: ${totalCreated}, Skipped: ${totalSkipped}`);
      setHasData(true);
      loadCities();
      loadStates();
    } catch (err: any) { toast.error(err.message || 'Failed to seed cities'); } finally { setSeeding(false); }
  };

  const filteredCities = cities.filter(c =>
    !search || c.cityName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-slate-800 text-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">City Management</h1>
          <p className="text-sm text-slate-300">Add, edit, or delete cities for dropdowns</p>
        </div>
        <button onClick={() => router.push('/super-admin/dashboard')} className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-500 text-sm">Back to Dashboard</button>
      </header>

      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-sm text-gray-500">Total Cities</p>
            <p className="text-2xl font-bold">{cities.length}</p>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-sm text-gray-500">States Covered</p>
            <p className="text-2xl font-bold">{states.length}</p>
          </div>
          <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
            {hasData ? (
              <span className="px-4 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium">Cities seeded</span>
            ) : (
              <>
                <button onClick={handleSeedCities} disabled={seeding}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium">
                  {seeding ? 'Seeding...' : 'Seed Indian Cities'}
                </button>
                <span className="text-xs text-gray-500">Adds 500+ major cities</span>
              </>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow p-4 flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Filter by State</label>
            <select value={filterState} onChange={(e) => setFilterState(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              <option value="">All States</option>
              {states.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search City</label>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <button onClick={handleCreate} className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 text-sm font-medium">+ Add City</button>
        </div>

        {/* Cities Table */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">City Name</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">City Code</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">State</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Country</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
              ) : filteredCities.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No cities found. Click "Seed Indian Cities" to add data.</td></tr>
              ) : filteredCities.map(city => (
                <tr key={city._id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{city.cityName}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{city.cityCode || '-'}</td>
                  <td className="px-4 py-3 text-sm">{city.state}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{city.country}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleEdit(city)} className="text-blue-600 hover:text-blue-800 text-sm mr-3">Edit</button>
                    <button onClick={() => handleDelete(city._id)} className="text-red-600 hover:text-red-800 text-sm">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h2 className="text-lg font-bold mb-4">{editingCity ? 'Edit City' : 'Add City'}</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Country *</label>
                  <select value={formData.country} onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg" required>
                    <option value="India">India</option>
                    <option value="USA">USA</option>
                    <option value="UK">UK</option>
                    <option value="UAE">UAE</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State *</label>
                  <select value={formData.state} onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg" required>
                    <option value="">Select State</option>
                    {Object.keys(INDIAN_STATES).sort().map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City Name *</label>
                  <input type="text" value={formData.cityName} onChange={(e) => setFormData({ ...formData, cityName: e.target.value })}
                    placeholder="e.g. Mumbai" className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City Code</label>
                  <input type="text" value={formData.cityCode} onChange={(e) => setFormData({ ...formData, cityCode: e.target.value.toUpperCase() })}
                    placeholder="e.g. MUM" maxLength={5} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm">Cancel</button>
                  <button type="submit" disabled={isSaving} className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 text-sm">{isSaving ? 'Saving...' : editingCity ? 'Update' : 'Create'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
