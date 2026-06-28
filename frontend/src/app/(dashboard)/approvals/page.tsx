'use client';

import { useEffect, useState } from 'react';
import { transactionAPI } from '@/services/api';
import { Approval } from '@/types';
import Table from '@/components/common/Table';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Input from '@/components/common/Input';
import toast from 'react-hot-toast';

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<Approval | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject'>('approve');
  const [remarks, setRemarks] = useState('');
  const [filterType, setFilterType] = useState('');

  useEffect(() => {
    fetchApprovals();
  }, [filterType]);

  const fetchApprovals = async () => {
    try {
      const params: any = {};
      if (filterType) params.approvalType = filterType;
      const response = await transactionAPI.getPendingApprovals(params);
      setApprovals(response.data.data);
    } catch (error) {
      toast.error('Failed to fetch approvals');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAction = async () => {
    if (!selectedApproval) return;
    try {
      if (actionType === 'approve') {
        await transactionAPI.approveRequest(selectedApproval._id, { remarks });
        toast.success('Approved successfully');
      } else {
        if (!remarks) {
          toast.error('Rejection reason is required');
          return;
        }
        await transactionAPI.rejectRequest(selectedApproval._id, { rejectionReason: remarks });
        toast.success('Rejected successfully');
      }
      setIsModalOpen(false);
      setSelectedApproval(null);
      setRemarks('');
      fetchApprovals();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Operation failed');
    }
  };

  const openActionModal = (approval: Approval, type: 'approve' | 'reject') => {
    setSelectedApproval(approval);
    setActionType(type);
    setRemarks('');
    setIsModalOpen(true);
  };

  const approvalTypeLabels: Record<string, string> = {
    expense: 'Expense',
    van_assignment: 'VAN Assignment',
    sales_order: 'Sales Order',
    day_cash_out: 'Day Cash Out',
    cash_cheque_deposit: 'Cash/Cheque Deposit',
    sales_return: 'Sales Return',
    adhoc_sales_return: 'Adhoc Sales Return',
    stock_request: 'Stock Request',
    stock_receipt_variance: 'Stock Receipt Variance',
    stock_closing_variance: 'Stock Closing Variance',
  };

  const columns = [
    {
      key: 'type',
      label: 'Type',
      render: (approval: Approval) => (
        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
          {approvalTypeLabels[approval.approvalType] || approval.approvalType}
        </span>
      ),
    },
    {
      key: 'requestedBy',
      label: 'Requested By',
      render: (approval: Approval) => {
        const user = approval.requestedBy as any;
        return user?.firstName ? `${user.firstName} ${user.lastName}` : 'N/A';
      },
    },
    {
      key: 'amount',
      label: 'Amount',
      render: (approval: Approval) => `₹${approval.amount.toLocaleString()}`,
    },
    {
      key: 'createdAt',
      label: 'Date',
      render: (approval: Approval) => new Date(approval.createdAt).toLocaleDateString(),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (approval: Approval) => (
        <div className="flex space-x-2">
          <button
            onClick={() => openActionModal(approval, 'approve')}
            className="text-green-600 hover:text-green-800 font-medium"
          >
            Approve
          </button>
          <button
            onClick={() => openActionModal(approval, 'reject')}
            className="text-red-600 hover:text-red-800 font-medium"
          >
            Reject
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Pending Approvals</h1>
        <div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Types</option>
            {Object.entries(approvalTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <Table columns={columns} data={approvals} isLoading={isLoading} emptyMessage="No pending approvals" />

      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setSelectedApproval(null); }} title={`${actionType === 'approve' ? 'Approve' : 'Reject'} Request`}>
        <div className="space-y-4">
          <p className="text-gray-600">
            Are you sure you want to {actionType} this request?
          </p>
          {actionType === 'reject' && (
            <Input
              label="Rejection Reason"
              required
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Enter rejection reason"
            />
          )}
          {actionType === 'approve' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Remarks (Optional)</label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
              />
            </div>
          )}
          <div className="flex justify-end space-x-3 pt-4">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setSelectedApproval(null); }}>Cancel</Button>
            <Button
              variant={actionType === 'approve' ? 'success' : 'danger'}
              onClick={handleAction}
            >
              {actionType === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
