'use client';

import { useEffect, useState } from 'react';
import { masterAPI, moduleAPI } from '@/services/api';
import Button from '@/components/common/Button';
import toast from 'react-hot-toast';
import { getFinancialYear, getFYMonths, canEditMonth } from '@/utils/financialYear';
import { usePermission } from '@/hooks/usePermission';

const MONTH_COLORS = [
  'bg-blue-600', 'bg-teal-500', 'bg-emerald-500',
  'bg-green-600', 'bg-olive-500', 'bg-yellow-600',
  'bg-amber-600', 'bg-orange-500', 'bg-red-500',
  'bg-pink-500', 'bg-rose-500', 'bg-purple-500',
];

export default function PreSalesTargetPage() {
  const perm = usePermission('/masters/pre-sales-target');
  const [company, setCompany] = useState<any>(null);
  const [fyInfo, setFyInfo] = useState<any>(null);
  const [fyMonths, setFyMonths] = useState<any[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<any>(null);
  const [presaleUsers, setPresaleUsers] = useState<any[]>([]);
  const [targets, setTargets] = useState<any[]>([]);
  const [editingTargets, setEditingTargets] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [companyRes, usersRes] = await Promise.all([
        masterAPI.getCompanyDetails().catch(() => ({ data: { data: null } })),
        masterAPI.getUsers({ limit: 500 }).catch(() => ({ data: { data: [] } })),
      ]);
      const comp = companyRes.data.data;
      setCompany(comp);
      const fyStart = comp?.financialYearStart || { month: 1, day: 1 };
      const fy = getFinancialYear(new Date(), fyStart);
      setFyInfo(fy);
      setFyMonths(getFYMonths(fy.fyYear, fyStart));

      const users = usersRes.data?.data || [];
      const presale = users.filter((u: any) => {
        const sub = (u.roleId?.mobileSubType || '').toLowerCase();
        return sub === 'presale' && u.isActive !== false;
      });
      setPresaleUsers(presale);
    } catch { toast.error('Failed to load data'); }
    finally { setIsLoading(false); }
  };

  const loadTargets = async (monthInFY: number) => {
    setIsDetailLoading(true);
    try {
      const res = await moduleAPI.getPreSalesTargets({ fyYear: fyInfo.fyYear, monthInFY });
      const data = res.data?.data || [];
      setTargets(data);
      const editMap: Record<string, number> = {};
      data.forEach((t: any) => {
        const uid = typeof t.userId === 'string' ? t.userId : t.userId?._id;
        editMap[uid] = t.targetAmount;
      });
      setEditingTargets(editMap);
    } catch { toast.error('Failed to load targets'); }
    finally { setIsDetailLoading(false); }
  };

  const openMonth = (month: any) => {
    if (!perm.canView) { toast.error('You do not have access'); return; }
    if (!canEditMonth(month.calendarMonth, month.calendarYear)) {
      toast.error('Cannot edit past month targets');
      return;
    }
    setSelectedMonth(month);
    loadTargets(month.monthInFY);
  };

  const handleTargetChange = (userId: string, value: string) => {
    const num = parseFloat(value) || 0;
    setEditingTargets(prev => ({ ...prev, [userId]: num }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const targetsPayload = presaleUsers.map(u => ({
        userId: u._id,
        targetAmount: editingTargets[u._id] || 0,
      }));
      await moduleAPI.savePreSalesTargets({
        targets: targetsPayload,
        fyYear: fyInfo.fyYear,
        fyLabel: fyInfo.fyLabel,
        monthInFY: selectedMonth.monthInFY,
        calendarMonth: selectedMonth.calendarMonth,
        calendarYear: selectedMonth.calendarYear,
      });
      toast.success('Targets saved successfully');
      handleBack();
    } catch { toast.error('Failed to save targets'); }
    finally { setIsSaving(false); }
  };

  const handleBack = () => {
    setSelectedMonth(null);
    setTargets([]);
    setEditingTargets({});
  };

  if (isLoading) return <div className="p-6 text-gray-500">Loading...</div>;

  if (selectedMonth) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Executive Target Master Detail</h1>
        </div>

        <div className="bg-white rounded-lg shadow border p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-500">Month</label>
              <div className="mt-1 text-lg font-semibold text-gray-900">{selectedMonth.name}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">Start Date</label>
              <div className="mt-1 text-lg font-semibold text-gray-900">
                {new Date(fyInfo.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase()}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">End Date</label>
              <div className="mt-1 text-lg font-semibold text-gray-900">
                {new Date(fyInfo.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase()}
              </div>
            </div>
          </div>

          <div className="flex gap-3 mb-6">
            <Button variant="secondary" onClick={handleBack}>Cancel</Button>
            {perm.canCreate && (
              <Button onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save'}</Button>
            )}
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium text-gray-500 w-16">Sr. No.</th>
                  <th className="px-4 py-3 font-medium text-gray-500">Executive Name</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-right">Sales Target</th>
                </tr>
              </thead>
              <tbody>
                {isDetailLoading ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
                ) : presaleUsers.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-500">No pre-sales executives found</td></tr>
                ) : (
                  presaleUsers.map((user, idx) => (
                    <tr key={user._id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">{idx + 1}</td>
                      <td className="px-4 py-3 text-gray-900">{user.firstName} {user.lastName}</td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          min={0}
                          value={editingTargets[user._id] || ''}
                          onChange={(e) => handleTargetChange(user._id, e.target.value)}
                          readOnly={!perm.canCreate}
                          className={`w-40 border rounded-lg px-3 py-2 text-sm text-right ${perm.canCreate ? 'border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500' : 'border-gray-200 bg-gray-50 cursor-not-allowed'}`}
                          placeholder="0"
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Month-Wise Executive Target Master</h1>
      </div>

      <div className="bg-white rounded-lg shadow border p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div>
            <label className="block text-sm font-medium text-gray-500">Financial Year Start Date</label>
            <div className="mt-1 text-lg font-semibold text-gray-900">
              {fyInfo ? new Date(fyInfo.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase() : '-'}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500">Financial Year End Date</label>
            <div className="mt-1 text-lg font-semibold text-gray-900">
              {fyInfo ? new Date(fyInfo.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase() : '-'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {fyMonths.map((month, idx) => {
            const editable = canEditMonth(month.calendarMonth, month.calendarYear);
            return (
              <button
                key={month.monthInFY}
                onClick={() => openMonth(month)}
                className={`py-4 px-6 rounded-lg text-white font-semibold text-lg transition-all ${
                  editable
                    ? `${MONTH_COLORS[idx]} hover:opacity-90 cursor-pointer`
                    : 'bg-gray-400 cursor-not-allowed opacity-60'
                }`}
              >
                {month.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
