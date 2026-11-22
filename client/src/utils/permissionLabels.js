/**
 * Human names for permission keys ("creditnotes.cancel" -> Credit notes /
 * Cancel), shared by the role matrix (Company settings) and a user's own
 * access (Users -> Access).
 */
export const MODULE_LABELS = {
  bills: 'Supplier bills',
  supplierpayments: 'Supplier payments',
  purchasereturns: 'Purchase returns',
  dashboard: 'Dashboard',
  users: 'Users & teams',
  customers: 'Customers',
  products: 'Products',
  discounts: 'Discounts (master)',
  schemes: 'Schemes',
  pricing: 'Pricing',
  orders: 'Sales orders',
  invoices: 'Invoices',
  creditnotes: 'Credit notes',
  payments: 'Payments & collections',
  inventory: 'Inventory',
  purchases: 'Purchase orders',
  grn: 'Goods receipts (GRN)',
  fieldforce: 'Field force',
  reports: 'Reports',
  settings: 'Company settings',
  audit: 'Audit trail',
  books: 'Books & year close',
  documents: 'Printing',
  vans: 'Vans',
};

const AREA_LABELS = {
  register: 'Register reports',
  mis: 'MIS reports',
  listing: 'Listing reports',
  cost: 'Cost & margin',
  adjustments: 'Stock adjustments',
  transfers: 'Stock transfers',
  attendance: 'Attendance',
  visits: 'Visits',
  expenses: 'Expenses',
  targets: 'Targets',
  daycash: 'Day cash',
};

const ACTION_LABELS = {
  view: 'View',
  create: 'Create',
  update: 'Edit',
  delete: 'Delete',
  export: 'Export',
  approve: 'Approve',
  cancel: 'Cancel',
  manage: 'Manage',
  post: 'Post',
  dispatch: 'Dispatch & deliver',
  override: 'Type price / discount by hand',
  print: 'Print, PDF & email',
  close: 'Close the year',
  backdate: 'Enter documents in an ended year (until it is closed)',
};

/** Whole-key names where the parts read badly. */
const KEY_LABELS = {
  'documents.print.original': 'Print the original again / allow another original',
};

const ACTION_ORDER = ['view', 'create', 'update', 'delete', 'manage', 'approve', 'dispatch', 'post', 'print', 'cancel', 'export'];

const humanize = (word) => word.charAt(0).toUpperCase() + word.slice(1).replace(/([A-Z])/g, ' $1').toLowerCase();

export const moduleLabel = (module) => MODULE_LABELS[module] || humanize(module);

export const permissionLabel = (key) => {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  const [, ...rest] = key.split('.');
  const action = rest.pop();
  const area = rest.length ? `${AREA_LABELS[rest[0]] || humanize(rest[0])} · ` : '';
  return `${area}${ACTION_LABELS[action] || humanize(action || '')}`;
};

/** { module: [keys] } with module-level actions first, then each area, actions in a natural order. */
export const groupPermissions = (keys) => {
  const out = {};
  [...keys].sort().forEach((key) => {
    const module = key.split('.')[0];
    out[module] = out[module] || [];
    out[module].push(key);
  });
  const rank = (key) => {
    if (KEY_LABELS[key]) return 'zz';
    const parts = key.split('.');
    const action = parts[parts.length - 1];
    const area = parts.length > 2 ? parts[1] : '';
    const i = ACTION_ORDER.indexOf(action);
    return `${area}|${String(i === -1 ? 99 : i).padStart(2, '0')}`;
  };
  Object.values(out).forEach((list) => list.sort((a, b) => rank(a).localeCompare(rank(b))));
  // Modules in the order of their names, as people read them.
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => moduleLabel(a).localeCompare(moduleLabel(b))));
};

/** Never given to one user or a profile (mirror of the server). */
export const ADMIN_ONLY_PERMISSIONS = ['users.create', 'users.update', 'users.delete', 'settings.update'];

/** Granting these asks for a confirmation (mirror of the server). */
export const isSensitivePermission = (key) =>
  /\.(delete|cancel|approve)$/.test(key) ||
  ['books.close', 'books.backdate', 'audit.view', 'settings.view', 'documents.print.original', 'pricing.override', 'products.cost.view'].includes(key);
