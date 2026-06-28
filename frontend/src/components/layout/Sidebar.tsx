'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

type MenuPermission = {
  menuPath: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

const menuItems = [
  { name: 'Dashboard', path: '/dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  {
    name: 'Masters', path: '/masters', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
    children: [
      { name: 'Roles', path: '/masters/roles' },
      { name: 'Users', path: '/masters/users' },
      { name: 'Warehouses', path: '/masters/warehouses' },
      { name: 'VANs', path: '/masters/vans' },
      { name: 'Parameters', path: '/masters/parameters' },
      { name: 'Countries', path: '/masters/countries' },
      { name: 'Tax Master', path: '/masters/tax' },
      { name: 'HSN Master', path: '/masters/hsn' },
      { name: 'Items', path: '/masters/items' },
      { name: 'Item Groups', path: '/masters/item-groups' },
      { name: 'Item Sub-Groups', path: '/masters/item-sub-groups' },
      { name: 'Customers', path: '/masters/customers' },
      { name: 'Routes', path: '/masters/routes' },
      { name: 'Executive-Product Group', path: '/masters/executive-product-group' },
      { name: 'Schemes', path: '/masters/schemes' },
      { name: 'Discounts', path: '/masters/discounts' },
      { name: 'Stock Adjustment', path: '/masters/stock-adjustment' },
      { name: 'Stock Query', path: '/masters/stock-query' },
      { name: 'Month-Wise Pre-Sales Target', path: '/masters/pre-sales-target' },
      { name: 'Month-Wise Van-Sales Target', path: '/masters/van-sales-target' },
    ],
  },
  {
    name: 'Transactions', path: '/transactions', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
    children: [
      { name: 'Sales Orders', path: '/transactions/sales-orders' },
      { name: 'Expenses', path: '/transactions/expenses' },
      { name: 'Attendance', path: '/transactions/attendance' },
      { name: 'Tour Visits', path: '/transactions/tour-visits' },
    ],
  },
  { name: 'Approvals', path: '/approvals', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState<string[]>(['Masters']);
  const [userMenus, setUserMenus] = useState<MenuPermission[]>([]);

  useEffect(() => {
    try {
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        const menus = user?.roleId?.menus || user?.menus || [];
        setUserMenus(menus);
      }
    } catch {}
  }, []);

  const hasPermission = (path: string) => {
    if (userMenus.length === 0) return true;
    return userMenus.some(m => m.menuPath === path && m.canView);
  };

  const toggleExpanded = (name: string) => {
    setExpandedItems((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]
    );
  };

  const filteredMenuItems = menuItems
    .map(item => {
      if (item.children) {
        const visibleChildren = item.children.filter(child => hasPermission(child.path));
        return { ...item, children: visibleChildren };
      }
      return item;
    })
    .filter(item => {
      if (item.children) return item.children.length > 0;
      return hasPermission(item.path);
    });

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 bg-white border-r border-gray-200 pt-16">
      <div className="h-full overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {filteredMenuItems.map((item) => (
            <li key={item.name}>
              {item.children ? (
                <>
                  <button
                    onClick={() => toggleExpanded(item.name)}
                    className={`flex items-center w-full p-2 text-base font-normal rounded-lg transition-colors ${
                      pathname.startsWith(item.path)
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                    </svg>
                    <span className="ml-3">{item.name}</span>
                    <svg
                      className={`ml-auto w-4 h-4 transition-transform ${expandedItems.includes(item.name) ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="1.5"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  {expandedItems.includes(item.name) && (
                    <ul className="ml-8 mt-1 space-y-1">
                      {item.children.map((child) => (
                        <li key={child.path}>
                          <Link
                            href={child.path}
                            className={`block px-3 py-2 text-sm rounded-lg transition-colors ${
                              pathname === child.path
                                ? 'bg-blue-50 text-blue-600 font-medium'
                                : 'text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            {child.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <Link
                  href={item.path}
                  className={`flex items-center p-2 text-base font-normal rounded-lg transition-colors ${
                    pathname === item.path
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  <span className="ml-3">{item.name}</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
