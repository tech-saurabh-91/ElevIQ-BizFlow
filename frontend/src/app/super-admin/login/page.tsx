'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PasswordInput from '@/components/common/PasswordInput';
import toast from 'react-hot-toast';

export default function SuperAdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error('Please enter email and password'); return; }

    setIsLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'}/super-admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Login failed');

      localStorage.setItem('superAdminToken', data.data.token);
      localStorage.setItem('superAdmin', JSON.stringify(data.data.admin));
      toast.success('Login successful');
      router.push('/super-admin/dashboard');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-700 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-slate-800">ElevIQ Super Admin</h1>
            <p className="text-gray-500 mt-2">Company Management Portal</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                placeholder="admin@eleviq.in" />
            </div>
            <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" />
            <button type="submit" disabled={isLoading}
              className="w-full bg-slate-800 text-white py-3 rounded-lg font-medium hover:bg-slate-900 transition-colors disabled:opacity-50">
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
