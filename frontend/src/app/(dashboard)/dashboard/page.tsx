'use client';

import { useEffect, useState } from 'react';
import { dashboardAPI } from '@/services/api';
import { DashboardData } from '@/types';

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const response = await dashboardAPI.getDashboard();
      setData(response.data.data);
    } catch (error) {
      console.error('Failed to fetch dashboard:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow p-6 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div className="h-8 bg-gray-200 rounded w-1/3"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const stats = [
    { name: 'Tour Visits', value: data?.today?.tourVisits || 0, color: 'text-blue-600', bg: 'bg-blue-50' },
    { name: "Today's Sales", value: data?.today?.sales || 0, color: 'text-green-600', bg: 'bg-green-50' },
    { name: 'Order Value', value: `₹${(data?.today?.orderValue || 0).toLocaleString()}`, color: 'text-purple-600', bg: 'bg-purple-50' },
    { name: 'Total Expense', value: `₹${(data?.today?.totalExpense || 0).toLocaleString()}`, color: 'text-red-600', bg: 'bg-red-50' },
  ];

  return (
    <div className="space-y-6">

      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.name} className={`${stat.bg} rounded-lg shadow p-6`}>
            <p className="text-sm text-gray-600">{stat.name}</p>
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Approvals & Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Approvals</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-yellow-50 rounded-lg">
              <span className="text-gray-700">Pending Approvals</span>
              <span className="text-lg font-bold text-yellow-600">{data?.approvals?.pending || 0}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
              <span className="text-gray-700">Approved Today</span>
              <span className="text-lg font-bold text-green-600">{data?.approvals?.approvedToday || 0}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Summary</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
              <span className="text-gray-700">Total Customers</span>
              <span className="text-lg font-bold text-blue-600">{data?.summary?.totalCustomers || 0}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg">
              <span className="text-gray-700">Total Items</span>
              <span className="text-lg font-bold text-purple-600">{data?.summary?.totalItems || 0}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
              <span className="text-gray-700">Total Users</span>
              <span className="text-lg font-bold text-green-600">{data?.summary?.totalUsers || 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Attendance History */}
      {data?.attendanceHistory && data.attendanceHistory.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Attendance</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {data.attendanceHistory.map((att) => (
                  <tr key={att._id}>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {new Date(att.date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        att.status === 'present' ? 'bg-green-100 text-green-800' :
                        att.status === 'absent' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {att.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{att.totalHours}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
