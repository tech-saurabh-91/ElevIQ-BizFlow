/**
 * Navigation registry.
 *
 * Each item declares the route, label, icon, required permission(s) and the
 * roles it should appear for. `permission` is checked against the company role
 * matrix (COMPANY_ADMIN always sees everything).
 */
import {
  LayoutDashboard,
  ShoppingBag,
  PackagePlus,
  ReceiptText,
  HandCoins,
  Undo2,
  Scale,
  Navigation,
  CalendarRange,
  Building2,
  CreditCard,
  Users,
  Settings,
  ShieldCheck,
  Megaphone,
  ScrollText,
  Package,
  ShoppingCart,
  FileText,
  Wallet,
  Boxes,
  Truck,
  MapPin,
  BarChart3,
  UserCog,
  CalendarCheck,
  Target,
  Route as RouteIcon,
  Tags,
  Layers,
  Warehouse,
  ClipboardList,
  LineChart,
  Globe2,
  Gift,
  Percent,
} from 'lucide-react';
import { sellsVia } from '@/utils/salesType';

// ---- Platform (Service Provider) ------------------------------------------
export const platformNav = [
  {
    section: 'Overview',
    items: [
      { to: '/platform', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/platform/companies', label: 'Companies', icon: Building2, permission: 'companies.view' },
      { to: '/platform/plans', label: 'Plans', icon: CreditCard, permission: 'plans.view' },
      { to: '/platform/locations', label: 'Locations', icon: Globe2, permission: 'settings.view' },
    ],
  },
  {
    section: 'Intelligence',
    items: [
      { to: '/platform/reports', label: 'Platform Reports', icon: LineChart, permission: 'reports.view' },
      { to: '/platform/announcements', label: 'Announcements', icon: Megaphone, permission: 'announcements.view' },
    ],
  },
  {
    section: 'Governance',
    items: [
      { to: '/platform/audit-logs', label: 'Audit Logs', icon: ScrollText, permission: 'audit.view' },
      { to: '/platform/settings', label: 'Platform Settings', icon: Settings, permission: 'settings.view' },
    ],
  },
];

// ---- Company workspace -----------------------------------------------------
export const companyNav = [
  {
    section: 'Workspace',
    items: [{ to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    // A field salesman's day, in order: mark in, sell, (van) cash out, mark out.
    section: 'My Day',
    items: [
      { to: '/app/attendance', label: 'Attendance', icon: CalendarCheck, roles: ['SALESMAN'] },
      { to: '/app/sales', label: 'Sales Visit', icon: Navigation, roles: ['SALESMAN', 'MANAGER'] },
      { to: '/app/stock-query', label: 'Stock Query', icon: Boxes, roles: ['SALESMAN', 'MANAGER', 'WAREHOUSE'], stock: true },
      { to: '/app/stock-requests', label: 'Van Stock Requests', icon: ClipboardList, roles: ['SALESMAN', 'MANAGER', 'WAREHOUSE', 'COMPANY_ADMIN'], channel: 'VAN_SALE', stock: true },
      { to: '/app/day-cashout', label: 'Day Cashout', icon: Wallet, roles: ['SALESMAN'], channel: 'VAN_SALE', stock: true },
      // Running offers, so the salesman can pitch them at the shop.
      { to: '/app/schemes', label: 'Schemes', icon: Gift, permission: 'schemes.view', roles: ['SALESMAN'] },
    ],
  },
  {
    // A salesman books all of these inside a shop visit (Sales Visit); here
    // they only look back at what they booked.
    section: 'My Records',
    items: [
      { to: '/app/orders', label: 'My Orders', icon: ShoppingCart, permission: 'orders.view', roles: ['SALESMAN'], channel: 'PRESALE' },
      { to: '/app/invoices', label: 'My Invoices', icon: FileText, permission: 'invoices.view', roles: ['SALESMAN'], channel: 'VAN_SALE' },
      { to: '/app/payments', label: 'My Collections', icon: Wallet, permission: 'payments.view', roles: ['SALESMAN'] },
      { to: '/app/credit-notes', label: 'My Returns', icon: ClipboardList, permission: 'creditnotes.view', roles: ['SALESMAN'], channel: 'VAN_SALE' },
    ],
  },
  {
    section: 'Sales',
    items: [
      { to: '/app/orders', label: 'Orders', icon: ShoppingCart, permission: 'orders.view', excludeRoles: ['SALESMAN'] },
      { to: '/app/invoices', label: 'Invoices', icon: FileText, permission: 'invoices.view', excludeRoles: ['SALESMAN'] },
      { to: '/app/payments', label: 'Payments & Collections', icon: Wallet, permission: 'payments.view', excludeRoles: ['SALESMAN'] },
      { to: '/app/credit-notes', label: 'Credit Notes', icon: ClipboardList, permission: 'creditnotes.view', excludeRoles: ['SALESMAN'] },
    ],
  },
  {
    // Back-office masters. A salesman sees customers only when allowed to add
    // new shops; products, prices and routes reach them inside the visit.
    section: 'Masters',
    items: [
      { to: '/app/customers', label: 'Customers', icon: Users, permission: 'customers.view', salesmanPermission: 'customers.create' },
      { to: '/app/products', label: 'Products', icon: Package, permission: 'products.view', excludeRoles: ['SALESMAN'] },
      { to: '/app/catalog', label: 'Categories & Units', icon: Layers, permission: 'products.view', excludeRoles: ['SALESMAN'] },
      { to: '/app/price-lists', label: 'Price Lists', icon: Tags, permission: 'products.view', excludeRoles: ['SALESMAN'] },
      // Selling prices to look at after purchases move the cost.
      { to: '/app/price-review', label: 'Price Review', icon: Scale, permission: 'products.update', alsoPermission: 'products.cost.view' },
      { to: '/app/discounts', label: 'Discounts', icon: Percent, permission: 'discounts.view', excludeRoles: ['SALESMAN'] },
      { to: '/app/schemes', label: 'Schemes', icon: Gift, permission: 'schemes.view', excludeRoles: ['SALESMAN'] },
      { to: '/app/warehouses', label: 'Warehouses', icon: Warehouse, permission: 'inventory.view', excludeRoles: ['SALESMAN'], stock: true },
      { to: '/app/routes', label: 'Routes & Beats', icon: RouteIcon, permission: 'customers.view', excludeRoles: ['SALESMAN'] },
    ],
  },
  {
    // Buying side: order -> receive -> book the supplier's bill -> pay; returns.
    section: 'Purchase',
    items: [
      { to: '/app/purchase-orders', label: 'Purchase Orders', icon: ShoppingBag, permission: 'purchases.view', stock: true },
      { to: '/app/goods-receipts', label: 'Goods Receipts', icon: PackagePlus, permission: 'grn.view', stock: true },
      { to: '/app/purchase-bills', label: 'Supplier Bills', icon: ReceiptText, permission: 'bills.view', stock: true },
      { to: '/app/supplier-payments', label: 'Supplier Payments', icon: HandCoins, permission: 'supplierpayments.view', stock: true },
      { to: '/app/purchase-returns', label: 'Purchase Returns', icon: Undo2, permission: 'purchasereturns.view', stock: true },
      { to: '/app/suppliers', label: 'Suppliers', icon: Truck, permission: 'products.view', excludeRoles: ['SALESMAN'] },
    ],
  },
  {
    section: 'Field Force',
    items: [
      { to: '/app/beat-plan', label: 'Beat Plan', icon: CalendarRange, permission: 'fieldforce.targets.manage' },
      { to: '/app/day-cashouts', label: 'Day Cashouts', icon: Wallet, permission: 'vans.daycash.approve', stock: true },
      // Team views; a salesman works from "My Day".
      { to: '/app/visits', label: 'Visits Report', icon: MapPin, permission: 'fieldforce.visits.view', excludeRoles: ['SALESMAN'] },
      { to: '/app/attendance', label: 'Attendance', icon: CalendarCheck, permission: 'fieldforce.attendance.view', excludeRoles: ['SALESMAN'] },
      { to: '/app/targets', label: 'Targets', icon: Target, permission: 'fieldforce.targets.view' },
      { to: '/app/expenses', label: 'Expenses', icon: Wallet, permission: 'fieldforce.expenses.view' },
    ],
  },
  {
    section: 'Insights',
    items: [
      { to: '/app/reports', label: 'Reports', icon: BarChart3, anyPermission: ['reports.view', 'reports.register.view', 'reports.mis.view', 'reports.listing.view'] },
      { to: '/app/inventory', label: 'Inventory', icon: Boxes, permission: 'inventory.view', stock: true },
    ],
  },
  {
    section: 'Administration',
    items: [
      { to: '/app/users', label: 'Users & Teams', icon: UserCog, permission: 'users.view' },
      { to: '/app/settings', label: 'Company Settings', icon: Settings, permission: 'settings.view' },
      { to: '/app/audit-logs', label: 'Audit Trail', icon: ShieldCheck, permission: 'audit.view' },
    ],
  },
];

/**
 * Phone tab bar: after Home, the first three of these the user can open
 * (everything else sits under "More").
 */
export const mobileTabs = (role) =>
  role === 'SALESMAN'
    ? ['/app/sales', '/app/attendance', '/app/orders', '/app/invoices', '/app/payments']
    : ['/app/orders', '/app/invoices', '/app/customers', '/app/payments', '/app/reports'];
export const platformMobileTabs = ['/platform/companies', '/platform/plans', '/platform/reports'];

/**
 * Filter a nav tree by the current user's permissions.
 * Platform users see everything (platform guards are separate).
 */
export const filterNav = (sections, { can, scope, role, user, salesOnly = false }) =>
  sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (scope === 'platform') return true;
        if (item.roles && !item.roles.includes(role)) return false;
        if (item.excludeRoles && item.excludeRoles.includes(role)) return false;
        // Channel items (van stock, day cashout...) only for salesmen who sell that way.
        if (item.channel && !sellsVia(user || { role }, item.channel)) return false;
        // A sales-only company keeps no stock: no inventory, warehouse or van screens.
        if (item.stock && salesOnly) return false;
        if (role === 'COMPANY_ADMIN') return true;
        if (item.alsoPermission && typeof can === 'function' && !can(item.alsoPermission)) return false;
        if (item.anyPermission) return typeof can === 'function' ? item.anyPermission.some((p) => can(p)) : true;
        if (role === 'SALESMAN' && item.salesmanPermission && typeof can === 'function' && !can(item.salesmanPermission)) return false;
        if (!item.permission) return true;
        return typeof can === 'function' ? can(item.permission) : true;
      }),
    }))
    .filter((section) => section.items.length > 0);
