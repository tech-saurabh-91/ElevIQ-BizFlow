'use client';

import { useAuthStore } from '@/store/authStore';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

export default function Header() {
  const { user, company, logout } = useAuthStore();
  const router = useRouter();

  const licenseWarning = useMemo(() => {
    if (!company?.licenseValidTo) return null;
    const expiryDate = new Date(company.licenseValidTo);
    const today = new Date();
    // Normalize both to start of day for accurate comparison
    expiryDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const daysUntilExpiry = Math.round((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      return { type: 'expired', message: 'License Expired!', days: 0 };
    } else if (daysUntilExpiry === 0) {
      return { type: 'warning', message: 'License expires today!', days: 0 };
    } else if (daysUntilExpiry <= 10) {
      return { type: 'warning', message: `License expires in ${daysUntilExpiry} day${daysUntilExpiry > 1 ? 's' : ''}`, days: daysUntilExpiry };
    }
    return null;
  }, [company?.licenseValidTo]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200">
      {licenseWarning && (
        <div className={`px-4 py-1.5 text-center text-sm font-medium ${
          licenseWarning.type === 'expired'
            ? 'bg-red-600 text-white'
            : 'bg-yellow-400 text-yellow-900'
        }`}>
          {licenseWarning.type === 'expired' ? (
            <span>License Expired! Please contact your service provider to renew.</span>
          ) : (
            <span>{licenseWarning.message}. Please contact your service provider to renew.</span>
          )}
        </div>
      )}

      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center">
          <button className="mr-3 lg:hidden">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-blue-600">ElevIQ SFA</h1>
          {company && (
            <span className="ml-3 text-sm text-gray-500 hidden sm:inline">
              {company.companyName} ({company.companyCode})
            </span>
          )}
        </div>

        <div className="flex items-center space-x-4">
          {company && (
            <span className={`hidden md:inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
              company.taxInclusive ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'
            }`}>
              Tax: {company.taxInclusive ? 'Inclusive' : 'Exclusive'}
            </span>
          )}

          {company && (
            <div className="hidden md:block text-right">
              <p className="text-xs text-gray-500">License valid till</p>
              <p className={`text-sm font-medium ${
                licenseWarning?.type === 'expired' ? 'text-red-600' :
                licenseWarning?.type === 'warning' ? 'text-yellow-600' : 'text-green-600'
              }`}>
                {new Date(company.licenseValidTo).toLocaleDateString()}
              </p>
            </div>
          )}

          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-sm font-medium text-blue-600">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </span>
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-gray-700">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-gray-500">{user?.designation}</p>
            </div>
          </div>

          <button onClick={handleLogout} className="text-gray-500 hover:text-red-600 transition-colors" title="Logout">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
