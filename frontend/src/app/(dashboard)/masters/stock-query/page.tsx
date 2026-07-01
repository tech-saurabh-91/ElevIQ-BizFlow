'use client';

import { useEffect, useState, useRef } from 'react';
import { masterAPI, moduleAPI } from '@/services/api';
import Button from '@/components/common/Button';
import toast from 'react-hot-toast';

type StockRow = {
  warehouseName: string;
  warehouseCode: string;
  itemName: string;
  itemCode: string;
  balanceQty: number;
  requestedQty: number;
};

export default function StockQueryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showLov, setShowLov] = useState(false);
  const [results, setResults] = useState<StockRow[]>([]);
  const [hasQueried, setHasQueried] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const loRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadItems();
    const handler = (e: MouseEvent) => { if (loRef.current && !loRef.current.contains(e.target as Node)) setShowLov(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadItems = async () => {
    try {
      const res = await moduleAPI.getItems({ limit: 500 });
      setItems(res.data.data || []);
    } catch { toast.error('Failed to load items'); }
  };

  const handleSearch = (val: string) => {
    setSearchText(val);
    setSelectedItem(null);
    setResults([]);
    setHasQueried(false);
            if (val.length < 1) { setSearchResults(items.filter((i: any) => i.isActive !== false).slice(0, 20)); return; }
    const q = val.toLowerCase();
    setSearchResults(
      items
        .filter((i: any) => i.isActive !== false)
        .filter((i: any) =>
          i.itemCode?.toLowerCase().includes(q) ||
          i.itemName?.toLowerCase().includes(q) ||
          i.unit?.toLowerCase().includes(q)
        )
        .slice(0, 20)
    );
  };

  const selectItem = (item: any) => {
    setSelectedItem(item);
    setSearchText(`${item.itemCode} - ${item.itemName}`);
    setShowLov(false);
    setResults([]);
    setHasQueried(false);
  };

  const handleQuery = async () => {
    if (!selectedItem) { toast.error('Please select an item first'); return; }
    setIsQuerying(true);
    setHasQueried(true);
    try {
      const res = await moduleAPI.getStockSummaries({ itemId: selectedItem._id, limit: 500 });
      const data = (res.data.data || []).map((s: any) => ({
        warehouseName: s.warehouseId?.warehouseName || '-',
        warehouseCode: s.warehouseId?.warehouseCode || '-',
        itemName: s.itemId?.itemName || selectedItem.itemName,
        itemCode: s.itemId?.itemCode || selectedItem.itemCode,
        balanceQty: s.balanceQty || 0,
        requestedQty: s.requestedQty || 0,
      }));
      setResults(data);
      if (data.length === 0) toast('No stock records found for this item');
    } catch { toast.error('Failed to query stock'); }
    finally { setIsQuerying(false); }
  };

  const handleBackfill = async () => {
    setIsBackfilling(true);
    try {
      const res = await moduleAPI.backfillStockSummaries();
      toast.success(res.data.message || 'Backfill complete');
      loadItems();
    } catch { toast.error('Backfill failed'); }
    finally { setIsBackfilling(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Query</h1>
          <p className="text-sm text-gray-500 mt-1">Check item-wise stock across all warehouses</p>
        </div>
        <Button variant="secondary" onClick={handleBackfill} disabled={isBackfilling}>
          {isBackfilling ? 'Backfilling...' : 'Sync Stock Data'}
        </Button>
      </div>

      <div className="bg-white rounded-lg shadow border p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="relative" ref={loRef}>
            <label className="block text-sm font-medium text-gray-700 mb-1">Item Description *</label>
            <input
              type="text"
              value={searchText}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => { setSearchResults(items.filter((i: any) => i.isActive !== false).slice(0, 20)); setShowLov(true); }}
              placeholder="Search by code, name, group, unit..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {showLov && searchResults.length > 0 && (
              <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
                <div className="sticky top-0 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 border-b grid grid-cols-8 gap-2">
                  <span className="col-span-2">Code</span>
                  <span className="col-span-4">Item Name</span>
                  <span className="col-span-2">Unit</span>
                </div>
                {searchResults.map((item: any) => (
                  <button
                    key={item._id}
                    type="button"
                    onClick={() => selectItem(item)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-0 grid grid-cols-8 gap-2 items-center"
                  >
                    <span className="col-span-2 font-medium text-gray-900">{item.itemCode}</span>
                    <span className="col-span-4 text-gray-700 truncate">{item.itemName}</span>
                    <span className="col-span-2 text-gray-500">{item.unit || '-'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <Button onClick={handleQuery} disabled={isQuerying || !selectedItem} className="px-6">
              {isQuerying ? 'Querying...' : 'Query'}
            </Button>
          </div>
        </div>
      </div>

      {hasQueried && (
        <div className="bg-white rounded-lg shadow border">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold text-gray-900">
              Stock Details — {selectedItem?.itemName}
              <span className="ml-2 text-sm font-normal text-gray-500">({selectedItem?.itemCode})</span>
            </h2>
          </div>
          {results.length === 0 ? (
            <div className="px-6 py-10 text-center text-gray-500">No stock records found for this item across any warehouse.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-500 w-16">Sr. No.</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Warehouse</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Item Name</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Balance Qty</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-right">Reserved Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, idx) => (
                    <tr key={idx} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">{idx + 1}</td>
                      <td className="px-4 py-3 text-gray-900">{row.warehouseName}</td>
                      <td className="px-4 py-3 text-gray-900">{row.itemName}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{row.balanceQty}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{row.requestedQty}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-gray-50 font-semibold">
                    <td colSpan={3} className="px-4 py-3 text-gray-900">Total</td>
                    <td className="px-4 py-3 text-right text-gray-900">{results.reduce((a, r) => a + r.balanceQty, 0)}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{results.reduce((a, r) => a + r.requestedQty, 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
