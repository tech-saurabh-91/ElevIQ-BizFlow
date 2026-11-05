/**
 * Navigation registry.
 *
 * Each item declares the route, label, icon, required permission(s) and the
 * roles it should appear for. `permission` is checked against the company role
 * matrix (COMPANY_ADMIN always sees everything).
 */
import {
  LayoutDashboard,
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
} from 'lucide-react';

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
    section: 'Sales',
    items: [
      { to: '/app/orders', label: 'Orders', icon: ShoppingCart, permission: 'orders.view' },
      { to: '/app/invoices', label: 'Invoices', icon: FileText, permission: 'invoices.view' },
      { to: '/app/payments', label: 'Payments & Collections', icon: Wallet, permission: 'payments.view' },
      { to: '/app/credit-notes', label: 'Credit Notes', icon: ClipboardList, permission: 'creditnotes.view' },
    ],
  },
  {
    section: 'Masters',
    items: [
      { to: '/app/customers', label: 'Customers', icon: Users, permission: 'customers.view' },
      { to: '/app/products', label: 'Products', icon: Package, permission: 'products.view' },
      { to: '/app/catalog', label: 'Categories & Units', icon: Layers, permission: 'products.view' },
      { to: '/app/suppliers', label: 'Suppliers', icon: Truck, permission: 'products.view' },
      { to: '/app/price-lists', label: 'Price Lists', icon: Tags, permission: 'products.view' },
      { to: '/app/warehouses', label: 'Warehouses', icon: Warehouse, permission: 'inventory.view' },
      { to: '/app/routes', label: 'Routes & Beats', icon: RouteIcon, permission: 'customers.view' },
    ],
  },
  {
    section: 'Field Force',
    items: [
      // Only for people who can drive a van.
      { to: '/app/my-beat', label: 'My Beat', icon: Navigation, roles: ['SALESMAN', 'MANAGER'] },
      { to: '/app/my-van', label: 'My Van', icon: Truck, roles: ['SALESMAN', 'MANAGER', 'WAREHOUSE'] },
      { to: '/app/stock-requests', label: 'Van Stock Requests', icon: ClipboardList, roles: ['SALESMAN', 'MANAGER', 'WAREHOUSE', 'COMPANY_ADMIN'] },
      { to: '/app/beat-plan', label: 'Beat Plan', icon: CalendarRange, permission: 'fieldforce.targets.manage' },
      { to: '/app/visits', label: 'Visits & Check-ins', icon: MapPin, permission: 'fieldforce.visits.view' },
      { to: '/app/attendance', label: 'Attendance', icon: CalendarCheck, permission: 'fieldforce.attendance.view' },
      { to: '/app/targets', label: 'Targets', icon: Target, permission: 'fieldforce.targets.view' },
      { to: '/app/expenses', label: 'Expenses', icon: Wallet, permission: 'fieldforce.expenses.view' },
    ],
  },
  {
    section: 'Insights',
    items: [
      { to: '/app/reports', label: 'Reports', icon: BarChart3, permission: 'reports.view' },
      { to: '/app/inventory', label: 'Inventory', icon: Boxes, permission: 'inventory.view' },
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
 * Filter a nav tree by the current user's permissions.
 * Platform users see everything (platform guards are separate).
 */
export const filterNav = (sections, { can, scope, role }) =>
  sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (scope === 'platform') return true;
        if (item.roles && !item.roles.includes(role)) return false;
        if (role === 'COMPANY_ADMIN') return true;
        if (!item.permission) return true;
        return typeof can === 'function' ? can(item.permission) : true;
      }),
    }))
    .filter((section) => section.items.length > 0);
