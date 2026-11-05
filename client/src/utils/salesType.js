/**
 * Field salesman sales types (mirror server/src/config/constants.js).
 * PRESALE books orders; VAN_SALE sells from a van (invoices, van stock,
 * returns, day cashout); BOTH does both. Only applies to the SALESMAN role.
 */
export const SALES_TYPES = [
  { value: 'PRESALE', label: 'Presale (orders)', hint: 'Books orders; goods are delivered later from the godown.' },
  { value: 'VAN_SALE', label: 'Van sale (spot invoice)', hint: 'Sells from a van: invoices, van stock, returns and day cashout.' },
  { value: 'BOTH', label: 'Both', hint: 'Books orders and sells from a van.' },
];

export const SALES_CHANNEL_PERMISSIONS = {
  'orders.create': 'PRESALE',
  'orders.update': 'PRESALE',
  'invoices.create': 'VAN_SALE',
  'invoices.update': 'VAN_SALE',
  'creditnotes.create': 'VAN_SALE',
  'creditnotes.update': 'VAN_SALE',
};

export const salesTypeAllows = (salesType, channel) =>
  !channel || !salesType || salesType === 'BOTH' || salesType === channel;

/** Does this user sell through `channel` ('PRESALE' | 'VAN_SALE')? Non-salesmen: yes. */
export const sellsVia = (user, channel) => user?.role !== 'SALESMAN' || salesTypeAllows(user?.salesType || 'BOTH', channel);

export const blockedBySalesType = (user, permission) =>
  user?.role === 'SALESMAN' && !salesTypeAllows(user?.salesType || 'BOTH', SALES_CHANNEL_PERMISSIONS[permission]);

export const salesTypeLabel = (v) => SALES_TYPES.find((t) => t.value === v)?.label || v;
