'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import PasswordInput from '@/components/common/PasswordInput';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const { login } = useAuthStore();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setErrorMsg('Please enter email and password'); return; }
    setIsLoading(true);
    setErrorMsg('');
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (error: any) {
      const msg = error.message || 'Login failed. Please try again.';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-blue-600">ElevIQ SFA</h1>
            <p className="text-gray-500 mt-2">Sales Force Automation</p>
          </div>

          {errorMsg && (
            <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <p className="ml-3 text-sm text-red-700">{errorMsg}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email / Username</label>
              <input type="text" value={email} onChange={(e) => { setEmail(e.target.value); setErrorMsg(''); }}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter email or username" />
            </div>
            <PasswordInput label="Password" value={password} onChange={(e) => { setPassword(e.target.value); setErrorMsg(''); }} placeholder="Enter password" />
            <button type="submit" disabled={isLoading}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50">
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
          <p className="mt-4 text-xs text-center text-gray-400">
            Contact your service provider for account access
          </p>
        </div>
      </div>
    </div>
  );
}
