export interface Company {
  _id: string;
  companyCode: string;
  companyName: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  noOfUsers: number;
  activeUsers: number;
  licenseType: string;
  licenseValidFrom: string;
  licenseValidTo: string;
  isLicenseValid: boolean;
  adminUserId?: User;
  gstNumber?: string;
  stateCode?: string;
  taxInclusive: boolean;
  taxInclusiveSetOn?: string;
  taxInclusiveLocked: boolean;
  defaultTaxId?: string;
  defaultHsnId?: string;
  isActive: boolean;
}

export interface TaxMaster {
  _id: string;
  taxName: string;
  taxCode: string;
  totalTaxPercent: number;
  effectDate: string;
  gstType: 'CGST' | 'SGST' | 'IGST' | 'CGST+SGST' | 'UTGST' | 'CESS';
  cgstPercent: number;
  sgstPercent: number;
  igstPercent: number;
  cessPercent: number;
  taxType: 'sales' | 'purchase' | 'both';
  isActive: boolean;
}

export interface HsnMaster {
  _id: string;
  hsnCode: string;
  hsnDescription: string;
  effectiveFromDate: string;
  effectiveToDate: string;
  cgstTaxId?: TaxMaster;
  cgstDesc?: string;
  cgstPercent: number;
  sgstTaxId?: TaxMaster;
  sgstDesc?: string;
  sgstPercent: number;
  igstTaxId?: TaxMaster;
  igstDesc?: string;
  igstPercent: number;
  totalTaxPercent: number;
  isActive: boolean;
}

export interface Role {
  _id: string;
  roleName: string;
  roleType: 'mobile' | 'backoffice';
  mobileSubType?: 'presale' | 'vansale' | '';
  companyId: string;
  menus: Menu[];
  isActive: boolean;
}

export interface Menu {
  menuName: string;
  menuPath: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface User {
  _id: string;
  companyId: string;
  roleId: Role;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  username: string;
  designation: string;
  isLoginAllowed: boolean;
  isActive: boolean;
  lastLogin?: string;
}

export interface Warehouse {
  _id: string;
  warehouseName: string;
  warehouseCode: string;
  parentWarehouseId?: Warehouse;
  address: string;
  city: string;
  state?: string;
  pincode?: string;
  warehouseType: 'main' | 'sub' | 'van' | 'godown';
  isActive: boolean;
}

export interface VAN {
  _id: string;
  vanName: string;
  vanCode: string;
  warehouseId: Warehouse;
  customerId?: Customer;
  vehicleNumber?: string;
  driverName?: string;
  driverPhone?: string;
  capacity: number;
  isActive: boolean;
}

export interface Item {
  _id: string;
  itemName: string;
  itemCode: string;
  itemDescription?: string;
  category?: string;
  brand?: string;
  customerItemCode?: string;
  unit: string;
  unitPrice: number;
  costPrice: number;
  sellingPrice: number;
  taxRate: number;
  hsnCode?: string;
  sku: string;
  barcode?: string;
  minStock: number;
  maxStock: number;
  reorderLevel: number;
  isActive: boolean;
}

export interface Customer {
  _id: string;
  customerCode: string;
  customerName: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  address: string;
  city?: string;
  state?: string;
  pincode?: string;
  routeId?: Route;
  customerType: 'retailer' | 'wholesaler' | 'distributor' | 'general';
  gstNumber?: string;
  creditLimit: number;
  outstandingAmount: number;
  isActive: boolean;
}

export interface Route {
  _id: string;
  routeName: string;
  routeNumber: string;
  routeDescription?: string;
  startLocation?: string;
  endLocation?: string;
  distance?: number;
  estimatedTime?: number;
  isActive: boolean;
}

export interface Location {
  _id: string;
  customerId: Customer;
  locationName: string;
  address: string;
  city?: string;
  state?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  landmark?: string;
  contactPhone?: string;
  isActive: boolean;
}

export interface Scheme {
  _id: string;
  schemeName: string;
  schemeCode: string;
  description?: string;
  itemId: Item;
  schemeType: 'percentage' | 'flat' | 'buy_x_get_y' | 'free_item' | 'combo';
  discountValue: number;
  validFrom: string;
  validTo: string;
  isActive: boolean;
}

export interface Discount {
  _id: string;
  discountName: string;
  discountCode: string;
  itemId: Item;
  discountType: 'percentage' | 'flat';
  discountValue: number;
  maxDiscount?: number;
  minQuantity: number;
  validFrom: string;
  validTo: string;
  isActive: boolean;
}

export interface SalesOrder {
  _id: string;
  orderNumber: string;
  customerId: Customer;
  executiveId: User;
  warehouseId: Warehouse;
  orderDate: string;
  items: SalesOrderItem[];
  subtotal: number;
  totalDiscount: number;
  totalTax: number;
  grandTotal: number;
  paymentMode: string;
  paymentStatus: string;
  orderStatus: string;
  status: 'pending' | 'approved' | 'rejected';
  isActive: boolean;
}

export interface SalesOrderItem {
  itemId: Item;
  itemName?: string;
  itemCode?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
}

export interface Expense {
  _id: string;
  expenseNumber: string;
  executiveId: User;
  expenseType: string;
  amount: number;
  expenseDate: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  isActive: boolean;
}

export interface Attendance {
  _id: string;
  userId: User;
  date: string;
  checkInTime?: string;
  checkOutTime?: string;
  status: 'present' | 'absent' | 'half_day' | 'late' | 'on_leave';
  totalHours: number;
  isActive: boolean;
}

export interface Approval {
  _id: string;
  approvalType: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: User;
  remarks?: string;
  rejectionReason?: string;
  createdAt: string;
}

export interface DashboardData {
  today: {
    tourVisits: number;
    sales: number;
    orderValue: number;
    totalInvoices: number;
    totalExpense: number;
  };
  approvals: {
    pending: number;
    approvedToday: number;
  };
  attendanceHistory: Attendance[];
  summary: {
    totalCustomers: number;
    totalItems: number;
    totalUsers: number;
  };
  recentOrders: SalesOrder[];
}

export interface PaginatedResponse<T> {
  success: boolean;
  statusCode: number;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
}
