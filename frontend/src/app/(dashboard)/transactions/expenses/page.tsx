'use client';

import { useEffect, useState } from 'react';
import { transactionAPI } from '@/services/api';
import { Expense } from '@/types';
import Table from '@/components/common/Table';
import toast from 'react-hot-toast';

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    transactionAPI.getExpenses().then(res => setExpenses(res.data.data)).catch(() => toast.error('Failed')).finally(() => setIsLoading(false));
  }, []);

  const columns = [
    { key: 'expenseNumber', label: 'Expense #', render: (e: Expense) => <span className="font-mono text-sm">{e.expenseNumber}</span> },
    { key: 'expenseType', label: 'Type' },
    { key: 'amount', label: 'Amount', render: (e: Expense) => `₹${e.amount.toLocaleString()}` },
    { key: 'status', label: 'Status', render: (e: Expense) => <span className={`px-2 py-1 text-xs font-semibold rounded-full ${e.status === 'approved' ? 'bg-green-100 text-green-800' : e.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>{e.status}</span> },
    { key: 'expenseDate', label: 'Date', render: (e: Expense) => new Date(e.expenseDate).toLocaleDateString() },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
      <Table columns={columns} data={expenses} isLoading={isLoading} />
    </div>
  );
}
