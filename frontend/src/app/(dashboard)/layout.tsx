'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { Toaster } from 'react-hot-toast';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, loadUser } = useAuthStore();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && mounted) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, mounted, router]);

  if (!mounted || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-right" />
      <Header />
      <Sidebar />
      <main className="ml-64 pt-16 min-h-screen p-6">
        {children}
      </main>
    </div>
  );
}
