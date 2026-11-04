/**
 * ElevIQ SFA - central constants & permission matrix.
 * Keep every enum/status/role here so models, validators and frontend agree.
 */

export const APP_NAME = 'ElevIQ SFA';

// ---------------------------------------------------------------------------
// Platform (Service Provider) roles
// ---------------------------------------------------------------------------
export const PLATFORM_ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  PLATFORM_SUPPORT: 'PLATFORM_SUPPORT',
});

// ---------------------------------------------------------------------------
// Company (tenant) roles
// ---------------------------------------------------------------------------
export const COMPANY_ROLES = Object.freeze({
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  MANAGER: 'MANAGER',
  SALESMAN: 'SALESMAN',
  ACCOUNTANT: 'ACCOUNTANT',
  WAREHOUSE: 'WAREHOUSE',
});

export const COMPANY_ROLE_LIST = Object.values(COMPANY_ROLES);

// ---------------------------------------------------------------------------
// Subscription / company status
// ---------------------------------------------------------------------------
export const COMPANY_STATUS = Object.freeze({
  TRIAL: 'TRIAL',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
});
export const COMPANY_STATUS_LIST = Object.values(COMPANY_STATUS);

// Statuses in which a company's users are allowed to log in / use the API.
export const LIVE_COMPANY_STATUSES = Object.freeze([
  COMPANY_STATUS.TRIAL,
  COMPANY_STATUS.ACTIVE,
]);

export const BUSINESS_TYPES = Object.freeze(['RETAIL', 'WHOLESALE', 'BOTH']);

// ---------------------------------------------------------------------------
// Master data enums
// ---------------------------------------------------------------------------
export const CUSTOMER_TYPES = Object.freeze(['RETAIL', 'WHOLESALE', 'DISTRIBUTOR', 'DEALER']);

export const UNIT_TYPES = Object.freeze(['BASE', 'ALT']);

export const PAYMENT_MODES = Object.freeze(['CASH', 'UPI', 'CHEQUE', 'BANK_TRANSFER', 'CARD', 'OTHER']);

export const PAYMENT_TERMS = Object.freeze(['IMMEDIATE', 'NET_7', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'CUSTOM']);

// ---------------------------------------------------------------------------
// Order workflow
// ---------------------------------------------------------------------------
export const ORDER_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  CONFIRMED: 'CONFIRMED',
  PARTIALLY_INVOICED: 'PARTIALLY_INVOICED',
  FULLY_INVOICED: 'FULLY_INVOICED',
  DISPATCHED: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
});
export const ORDER_STATUS_LIST = Object.values(ORDER_STATUS);

// Status transitions allowed by the order state machine.
export const ORDER_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.DRAFT]: [ORDER_STATUS.PENDING_APPROVAL, ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PENDING_APPROVAL]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.REJECTED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.PARTIALLY_INVOICED, ORDER_STATUS.FULLY_INVOICED, ORDER_STATUS.CANCELLED, ORDER_STATUS.DISPATCHED],
  [ORDER_STATUS.PARTIALLY_INVOICED]: [ORDER_STATUS.FULLY_INVOICED, ORDER_STATUS.DISPATCHED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.FULLY_INVOICED]: [ORDER_STATUS.DISPATCHED],
  [ORDER_STATUS.DISPATCHED]: [ORDER_STATUS.DELIVERED],
  [ORDER_STATUS.DELIVERED]: [],
  [ORDER_STATUS.CANCELLED]: [],
  [ORDER_STATUS.REJECTED]: [],
});

// ---------------------------------------------------------------------------
// Invoice workflow
// ---------------------------------------------------------------------------
export const INVOICE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
});
export const INVOICE_STATUS_LIST = Object.values(INVOICE_STATUS);

export const CREDIT_NOTE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  CANCELLED: 'CANCELLED',
});
export const CREDIT_NOTE_STATUS_LIST = Object.values(CREDIT_NOTE_STATUS);

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export const CHEQUE_STATUS = Object.freeze(['RECEIVED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED']);

/**
 * Payment lifecycle.
 * DRAFT     - entered but not yet confirmed (not applied to any invoice).
 * RECEIVED  - confirmed and applied (fully or partially) to invoices / advance.
 * BOUNCED   - cheque/ECS bounced after being received (allocations reversed).
 * CANCELLED - voided by an admin (allocations reversed, kept for audit).
 */
export const PAYMENT_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  RECEIVED: 'RECEIVED',
  BOUNCED: 'BOUNCED',
  CANCELLED: 'CANCELLED',
});
export const PAYMENT_STATUS_LIST = Object.values(PAYMENT_STATUS);

/**
 * Allocation state (derived from amountApplied vs amount on a RECEIVED payment).
 * Kept separate from the lifecycle status so list filters stay simple.
 */
export const PAYMENT_ALLOCATION_STATUS = Object.freeze({
  UNAPPLIED: 'UNAPPLIED',
  PARTIALLY_APPLIED: 'PARTIALLY_APPLIED',
  FULLY_APPLIED: 'FULLY_APPLIED',
});
export const PAYMENT_ALLOCATION_STATUS_LIST = Object.values(PAYMENT_ALLOCATION_STATUS);

// ---------------------------------------------------------------------------
// Inventory (Phase 7)
// ---------------------------------------------------------------------------
/**
 * Stock ledger movement types. Each is a signed quantity applied to a
 * (product, warehouse) balance; the company-wide `Product.stock` total is
 * kept in sync by `inventoryService`.
 */
export const MOVEMENT_TYPES = Object.freeze({
  OPENING: 'OPENING', // initial / imported stock
  PURCHASE_RECEIPT: 'PURCHASE_RECEIPT', // GRN into a warehouse
  SALES_OUT: 'SALES_OUT', // order dispatched
  SALES_RETURN: 'SALES_RETURN', // goods returned by a customer
  PURCHASE_RETURN: 'PURCHASE_RETURN', // goods returned to a supplier
  ADJUSTMENT: 'ADJUSTMENT', // manual correction (+/-)
  TRANSFER_IN: 'TRANSFER_IN',
  TRANSFER_OUT: 'TRANSFER_OUT',
  DAMAGE: 'DAMAGE', // written off
  COUNT: 'COUNT', // stock count reconciliation
});
export const MOVEMENT_TYPE_LIST = Object.values(MOVEMENT_TYPES);

/** Why a manual stock adjustment was made. */
export const ADJUSTMENT_REASONS = Object.freeze([
  'OPENING', // first stock of a new warehouse / product (posts an OPENING movement)
  'COUNT',
  'DAMAGE',
  'THEFT',
  'EXPIRY',
  'CORRECTION',
  'OTHER',
]);

/**
 * Purchase order lifecycle.
 * DRAFT -> SENT -> PARTIALLY_RECEIVED -> RECEIVED (or CANCELLED at any
 * pre-received stage). Receipts are driven by GRNs.
 */
export const PURCHASE_ORDER_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
});
export const PURCHASE_ORDER_STATUS_LIST = Object.values(PURCHASE_ORDER_STATUS);

export const PO_TRANSITIONS = Object.freeze({
  [PURCHASE_ORDER_STATUS.DRAFT]: [PURCHASE_ORDER_STATUS.SENT, PURCHASE_ORDER_STATUS.CANCELLED],
  [PURCHASE_ORDER_STATUS.SENT]: [
    PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED,
    PURCHASE_ORDER_STATUS.RECEIVED,
    PURCHASE_ORDER_STATUS.CANCELLED,
  ],
  [PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED]: [
    PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED,
    PURCHASE_ORDER_STATUS.RECEIVED,
    PURCHASE_ORDER_STATUS.CANCELLED,
  ],
  [PURCHASE_ORDER_STATUS.RECEIVED]: [],
  [PURCHASE_ORDER_STATUS.CANCELLED]: [],
});

/** Goods receipt note lifecycle. Posting a GRN books stock into a warehouse. */
export const GRN_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED',
});
export const GRN_STATUS_LIST = Object.values(GRN_STATUS);

/** Manual stock adjustment lifecycle (POSTED books the ledger movement). */
export const ADJUSTMENT_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  POSTED: 'POSTED',
  CANCELLED: 'CANCELLED',
});
export const ADJUSTMENT_STATUS_LIST = Object.values(ADJUSTMENT_STATUS);

/**
 * Warehouse-to-warehouse transfer lifecycle.
 * DRAFT -> DISPATCHED (stock leaves source) -> RECEIVED (stock lands in
 * destination). CANCELLED is only allowed before dispatch.
 */
export const TRANSFER_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  DISPATCHED: 'DISPATCHED',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
});
export const TRANSFER_STATUS_LIST = Object.values(TRANSFER_STATUS);

export const TRANSFER_TRANSITIONS = Object.freeze({
  [TRANSFER_STATUS.DRAFT]: [TRANSFER_STATUS.DISPATCHED, TRANSFER_STATUS.CANCELLED],
  [TRANSFER_STATUS.DISPATCHED]: [TRANSFER_STATUS.RECEIVED],
  [TRANSFER_STATUS.RECEIVED]: [],
  [TRANSFER_STATUS.CANCELLED]: [],
});

// ---------------------------------------------------------------------------
// Field force (Phase 7)
// ---------------------------------------------------------------------------
export const VISIT_OUTCOMES = Object.freeze(['ORDER_TAKEN', 'NO_ORDER', 'PAYMENT_COLLECTED', 'CLOSED', 'CUSTOMER_UNAVAILABLE']);

/**
 * Status constants are keyed objects (`EXPENSE_STATUS.DRAFT`), never arrays —
 * `*_LIST` derives from them via Object.values().
 */
export const EXPENSE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PAID: 'PAID',
});
export const EXPENSE_STATUS_LIST = Object.values(EXPENSE_STATUS);
export const LEAVE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
});
export const LEAVE_STATUS_LIST = Object.values(LEAVE_STATUS);

/** Expense claim categories (drive reporting + reimbursement policy). */
export const EXPENSE_CATEGORIES = Object.freeze([
  'TRAVEL',
  'FUEL',
  'FOOD',
  'LODGING',
  'COMMUNICATION',
  'OFFICE',
  'OTHER',
]);

/** Daily attendance status. */
export const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  HALF_DAY: 'HALF_DAY',
  LEAVE: 'LEAVE',
  HOLIDAY: 'HOLIDAY',
  WEEK_OFF: 'WEEK_OFF',
  WORK_FROM_HOME: 'WORK_FROM_HOME',
});
export const ATTENDANCE_STATUS_LIST = Object.values(ATTENDANCE_STATUS);

/** Visit lifecycle: PLANNED -> IN_PROGRESS -> COMPLETED (or CANCELLED/SKIPPED). */
export const VISIT_STATUS = Object.freeze({
  PLANNED: 'PLANNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  SKIPPED: 'SKIPPED',
});
export const VISIT_STATUS_LIST = Object.values(VISIT_STATUS);

/** Why the rep is visiting (outcome is recorded separately). */
export const VISIT_PURPOSES = Object.freeze([
  'ORDER',
  'COLLECTION',
  'PRESENTATION',
  'COMPLAINT',
  'RELATIONSHIP',
  'OTHER',
]);

/** Sales target periods + status. */
export const TARGET_PERIODS = Object.freeze(['WEEK', 'MONTH', 'QUARTER', 'YEAR']);
export const TARGET_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  ACHIEVED: 'ACHIEVED',
  MISSED: 'MISSED',
  CLOSED: 'CLOSED',
});
export const TARGET_STATUS_LIST = Object.values(TARGET_STATUS);

// ---------------------------------------------------------------------------
// Audit action types
// ---------------------------------------------------------------------------
export const AUDIT_ACTIONS = Object.freeze({
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  STATUS_CHANGE: 'STATUS_CHANGE',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  LOGIN_FAILED: 'LOGIN_FAILED',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  EXPORT: 'EXPORT',
  IMPERSONATE: 'IMPERSONATE',
  PASSWORD_RESET: 'PASSWORD_RESET',
});

// ---------------------------------------------------------------------------
// Permission matrix:  module.action -> roles allowed (company level)
// COMPANY_ADMIN always has every permission (enforced in authorize()).
// This default matrix can be overridden per-tenant in Setting.rolePermissions.
// ---------------------------------------------------------------------------
const ALL_ROLES = Object.values(COMPANY_ROLES);

export const DEFAULT_PERMISSIONS = Object.freeze({
  'dashboard.view': ALL_ROLES,

  'users.view': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER],
  'users.create': [COMPANY_ROLES.COMPANY_ADMIN],
  'users.update': [COMPANY_ROLES.COMPANY_ADMIN],
  'users.delete': [COMPANY_ROLES.COMPANY_ADMIN],
  'users.export': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER],

  'customers.view': ALL_ROLES,
  'customers.create': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT],
  'customers.update': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT],
  'customers.delete': [COMPANY_ROLES.COMPANY_ADMIN],
  'customers.export': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT],

  'products.view': ALL_ROLES,
  'products.create': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.WAREHOUSE],
  'products.update': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.WAREHOUSE],
  'products.delete': [COMPANY_ROLES.COMPANY_ADMIN],
  'products.export': ALL_ROLES,

  'orders.view': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.SALESMAN, COMPANY_ROLES.ACCOUNTANT],
  'orders.create': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.SALESMAN],
  'orders.update': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.SALESMAN],
  'orders.delete': [COMPANY_ROLES.COMPANY_ADMIN],
  'orders.approve': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER],
  'orders.cancel': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER],
  'orders.export': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT],

  'invoices.view': [
    COMPANY_ROLES.COMPANY_ADMIN,
    COMPANY_ROLES.MANAGER,
    COMPANY_ROLES.SALESMAN,
    COMPANY_ROLES.ACCOUNTANT,
  ],
  'invoices.create': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT],
  'invoices.update': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.ACCOUNTANT],
  'invoices.delete': [COMPANY_ROLES.COMPANY_ADMIN],
  'invoices.cancel': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.ACCOUNTANT],
  'invoices.export': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT],

  'creditnotes.view': [
    COMPANY_ROLES.COMPANY_ADMIN,
    COMPANY_ROLES.MANAGER,
    COMPANY_ROLES.SALESMAN,
    COMPANY_ROLES.ACCOUNTANT,
  ],
  'creditnotes.create': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT],
  'creditnotes.update': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.ACCOUNTANT],
  'creditnotes.delete': [COMPANY_ROLES.COMPANY_ADMIN],
  'creditnotes.cancel': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.ACCOUNTANT],
  'creditnotes.export': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT],

  'payments.view': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT],
  'payments.create': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT, COMPANY_ROLES.SALESMAN],
  'payments.update': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.ACCOUNTANT],
  'payments.delete': [COMPANY_ROLES.COMPANY_ADMIN],
  'payments.cancel': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.ACCOUNTANT],
  'payments.export': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.ACCOUNTANT],

  'inventory.view': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.WAREHOUSE, COMPANY_ROLES.ACCOUNTANT],
  'inventory.manage': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.WAREHOUSE],
  'inventory.export': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.WAREHOUSE],

  // Inventory sub-modules (stock ledger, adjustments, transfers)
  'inventory.adjustments.view': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.WAREHOUSE],
  'inventory.adjustments.manage': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.WAREHOUSE],
  'inventory.transfers.view': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.WAREHOUSE],
  'inventory.transfers.manage': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.WAREHOUSE],

  // Purchasing (PO -> GRN)
  'purchases.view': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT, COMPANY_ROLES.WAREHOUSE],
  'purchases.create': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER],
  'purchases.update': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER],
  'purchases.delete': [COMPANY_ROLES.COMPANY_ADMIN],
  'purchases.approve': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER],
  'purchases.cancel': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER],
  'purchases.export': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT],

  'grn.view': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.WAREHOUSE, COMPANY_ROLES.ACCOUNTANT],
  'grn.create': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.WAREHOUSE],
  'grn.update': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.WAREHOUSE],
  'grn.delete': [COMPANY_ROLES.COMPANY_ADMIN],
  'grn.post': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.WAREHOUSE],

  'fieldforce.view': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER],
  'fieldforce.manage': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.SALESMAN],
  'fieldforce.approve': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER],

  // Field force sub-modules
  'fieldforce.attendance.view': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.SALESMAN],
  'fieldforce.attendance.manage': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.SALESMAN],
  'fieldforce.attendance.approve': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER],
  'fieldforce.visits.view': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.SALESMAN],
  'fieldforce.visits.manage': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.SALESMAN],
  'fieldforce.expenses.view': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.SALESMAN, COMPANY_ROLES.ACCOUNTANT],
  'fieldforce.expenses.manage': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.SALESMAN],
  'fieldforce.expenses.approve': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT],
  'fieldforce.targets.view': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.SALESMAN],
  'fieldforce.targets.manage': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER],

  'reports.view': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT],
  'reports.export': [COMPANY_ROLES.COMPANY_ADMIN, COMPANY_ROLES.MANAGER, COMPANY_ROLES.ACCOUNTANT],

  'settings.view': [COMPANY_ROLES.COMPANY_ADMIN],
  'settings.update': [COMPANY_ROLES.COMPANY_ADMIN],
  'audit.view': [COMPANY_ROLES.COMPANY_ADMIN],
});

// Build a fully-populated default matrix (every action -> explicit role list).
export const buildDefaultPermissions = () => {
  const out = {};
  for (const [key, val] of Object.entries(DEFAULT_PERMISSIONS)) {
    out[key] = [...val];
  }
  return out;
};

// ---------------------------------------------------------------------------
// Business logic knobs (defaults; overridable in Setting)
// ---------------------------------------------------------------------------
export const BUSINESS_DEFAULTS = Object.freeze({
  financialYearStartMonth: 1, // 1 = April (India) handled via month index config
  rounding: 'NEAREST', // NEAREST | DOWN | NONE
  allowNegativeStock: false,
  creditLimitAction: 'WARN', // WARN | BLOCK
  orderApprovalThreshold: 0, // 0 = no approval needed
  lowStockThreshold: 10,
});

// ---------------------------------------------------------------------------
// Number series prefixes
// ---------------------------------------------------------------------------
export const SERIES_PREFIX = Object.freeze({
  ORDER: 'SO',
  INVOICE: 'INV',
  CREDIT_NOTE: 'CN',
  PAYMENT: 'RCPT',
  PURCHASE: 'PO',
  GRN: 'GRN',
  ADJUSTMENT: 'ADJ',
  TRANSFER: 'TRF',
  EXPENSE: 'EXP',
  VISIT: 'VIS',
});

export const ALLOWED_UPLOAD_MIME = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);

export const MODULES = Object.freeze([
  'dashboard',
  'users',
  'customers',
  'products',
  'orders',
  'invoices',
  'creditnotes',
  'payments',
  'inventory',
  'purchases',
  'grn',
  'fieldforce',
  'reports',
  'settings',
  'audit',
]);

export const ACTIONS = Object.freeze(['view', 'create', 'update', 'delete', 'approve', 'cancel', 'export']);
