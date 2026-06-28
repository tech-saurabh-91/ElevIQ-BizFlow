import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  login: (data: { email: string; password: string }) => api.post('/auth/login', data),
  getMe: () => api.get('/auth/me'),
  changePassword: (data: { currentPassword: string; newPassword: string }) => api.put('/auth/change-password', data),
};

export const masterAPI = {
  // Company
  getCompanyDetails: () => api.get('/master/company/details'),
  updateCompany: (data: any) => api.put('/master/company/update', data),

  // Roles
  getRoles: (params?: any) => api.get('/master/role', { params }),
  getRole: (id: string) => api.get(`/master/role/${id}`),
  createRole: (data: any) => api.post('/master/role', data),
  updateRole: (id: string, data: any) => api.put(`/master/role/${id}`, data),
  deleteRole: (id: string) => api.delete(`/master/role/${id}`),

  // Users
  getUsers: (params?: any) => api.get('/master/user', { params }),
  getUser: (id: string) => api.get(`/master/user/${id}`),
  createUser: (data: any) => api.post('/master/user', data),
  updateUser: (id: string, data: any) => api.put(`/master/user/${id}`, data),
  deleteUser: (id: string) => api.delete(`/master/user/${id}`),
  deactivateUser: (id: string) => api.put(`/master/user/${id}/deactivate`),
  activateUser: (id: string) => api.put(`/master/user/${id}/activate`),
  assignApp: (id: string, data: any) => api.put(`/master/user/${id}/assign-app`, data),

  // Warehouses
  getWarehouses: (params?: any) => api.get('/master/warehouse', { params }),
  getWarehouse: (id: string) => api.get(`/master/warehouse/${id}`),
  createWarehouse: (data: any) => api.post('/master/warehouse', data),
  updateWarehouse: (id: string, data: any) => api.put(`/master/warehouse/${id}`, data),
  deleteWarehouse: (id: string) => api.delete(`/master/warehouse/${id}`),

  // VANs
  getVans: (params?: any) => api.get('/master/van', { params }),
  getVan: (id: string) => api.get(`/master/van/${id}`),
  createVan: (data: any) => api.post('/master/van', data),
  updateVan: (id: string, data: any) => api.put(`/master/van/${id}`, data),
  deleteVan: (id: string) => api.delete(`/master/van/${id}`),
};

export const moduleAPI = {
  // Items
  getItems: (params?: any) => api.get('/module/item', { params }),
  getItem: (id: string) => api.get(`/module/item/${id}`),
  createItem: (data: any) => api.post('/module/item', data),
  updateItem: (id: string, data: any) => api.put(`/module/item/${id}`, data),
  deleteItem: (id: string) => api.delete(`/module/item/${id}`),

  // Customers
  getCustomers: (params?: any) => api.get('/module/customer', { params }),
  getCustomer: (id: string) => api.get(`/module/customer/${id}`),
  createCustomer: (data: any) => api.post('/module/customer', data),
  updateCustomer: (id: string, data: any) => api.put(`/module/customer/${id}`, data),
  deleteCustomer: (id: string) => api.delete(`/module/customer/${id}`),

  // Routes
  getRoutes: (params?: any) => api.get('/module/route', { params }),
  getRoute: (id: string) => api.get(`/module/route/${id}`),
  createRoute: (data: any) => api.post('/module/route', data),
  updateRoute: (id: string, data: any) => api.put(`/module/route/${id}`, data),
  deleteRoute: (id: string) => api.delete(`/module/route/${id}`),

  // Locations
  getLocations: (params?: any) => api.get('/module/location', { params }),
  getLocation: (id: string) => api.get(`/module/location/${id}`),
  createLocation: (data: any) => api.post('/module/location', data),
  updateLocation: (id: string, data: any) => api.put(`/module/location/${id}`, data),
  deleteLocation: (id: string) => api.delete(`/module/location/${id}`),

  // Executive Product Groups
  getExecutiveProductGroups: (params?: any) => api.get('/module/executive-product-group', { params }),
  getExecutiveProductGroup: (id: string) => api.get(`/module/executive-product-group/${id}`),
  createExecutiveProductGroup: (data: any) => api.post('/module/executive-product-group', data),
  updateExecutiveProductGroup: (id: string, data: any) => api.put(`/module/executive-product-group/${id}`, data),
  deleteExecutiveProductGroup: (id: string) => api.delete(`/module/executive-product-group/${id}`),

  // Schemes
  getSchemes: (params?: any) => api.get('/module/scheme', { params }),
  getScheme: (id: string) => api.get(`/module/scheme/${id}`),
  createScheme: (data: any) => api.post('/module/scheme', data),
  updateScheme: (id: string, data: any) => api.put(`/module/scheme/${id}`, data),
  deleteScheme: (id: string) => api.delete(`/module/scheme/${id}`),

  // Discounts
  getDiscounts: (params?: any) => api.get('/module/discount', { params }),
  getDiscount: (id: string) => api.get(`/module/discount/${id}`),
  createDiscount: (data: any) => api.post('/module/discount', data),
  updateDiscount: (id: string, data: any) => api.put(`/module/discount/${id}`, data),
  deleteDiscount: (id: string) => api.delete(`/module/discount/${id}`),

  // Parameters
  getParameters: (params?: any) => api.get('/module/parameter', { params }),
  getParameter: (id: string) => api.get(`/module/parameter/${id}`),
  createParameter: (data: any) => api.post('/module/parameter', data),
  updateParameter: (id: string, data: any) => api.put(`/module/parameter/${id}`, data),
  deleteParameter: (id: string) => api.delete(`/module/parameter/${id}`),

  // Countries
  getCountries: (params?: any) => api.get('/module/country', { params }),
  getCountry: (id: string) => api.get(`/module/country/${id}`),
  createCountry: (data: any) => api.post('/module/country', data),
  updateCountry: (id: string, data: any) => api.put(`/module/country/${id}`, data),
  deleteCountry: (id: string) => api.delete(`/module/country/${id}`),

  // Tax Master
  getTaxes: (params?: any) => api.get('/module/tax', { params }),
  getTax: (id: string) => api.get(`/module/tax/${id}`),
  createTax: (data: any) => api.post('/module/tax', data),
  updateTax: (id: string, data: any) => api.put(`/module/tax/${id}`, data),
  deleteTax: (id: string) => api.delete(`/module/tax/${id}`),

  // HSN Master
  getHsns: (params?: any) => api.get('/module/hsn', { params }),
  getHsn: (id: string) => api.get(`/module/hsn/${id}`),
  createHsn: (data: any) => api.post('/module/hsn', data),
  updateHsn: (id: string, data: any) => api.put(`/module/hsn/${id}`, data),
  deleteHsn: (id: string) => api.delete(`/module/hsn/${id}`),

  // Item Groups
  getItemGroups: (params?: any) => api.get('/module/item-group', { params }),
  getItemGroup: (id: string) => api.get(`/module/item-group/${id}`),
  createItemGroup: (data: any) => api.post('/module/item-group', data),
  updateItemGroup: (id: string, data: any) => api.put(`/module/item-group/${id}`, data),
  deleteItemGroup: (id: string) => api.delete(`/module/item-group/${id}`),

  // Item Sub-Groups
  getItemSubGroups: (params?: any) => api.get('/module/item-sub-group', { params }),
  getItemSubGroup: (id: string) => api.get(`/module/item-sub-group/${id}`),
  createItemSubGroup: (data: any) => api.post('/module/item-sub-group', data),
  updateItemSubGroup: (id: string, data: any) => api.put(`/module/item-sub-group/${id}`, data),
  deleteItemSubGroup: (id: string) => api.delete(`/module/item-sub-group/${id}`),

  // Stock Adjustments
  getStockAdjustments: (params?: any) => api.get('/module/stock-adjustment', { params }),
  getStockAdjustment: (id: string) => api.get(`/module/stock-adjustment/${id}`),
  createStockAdjustment: (data: any) => api.post('/module/stock-adjustment', data),
  updateStockAdjustment: (id: string, data: any) => api.put(`/module/stock-adjustment/${id}`, data),
  deleteStockAdjustment: (id: string) => api.delete(`/module/stock-adjustment/${id}`),

  // Stock Summary
  getStockSummaries: (params?: any) => api.get('/module/stock-summary', { params }),
  getStockSummary: (id: string) => api.get(`/module/stock-summary/${id}`),

  // Pre-Sales Target
  getPreSalesTargets: (params: any) => api.get('/module/pre-sales-target', { params }),
  savePreSalesTargets: (data: any) => api.post('/module/pre-sales-target', data),

  // Van-Sales Target
  getVanSalesTargets: (params: any) => api.get('/module/van-sales-target', { params }),
  saveVanSalesTargets: (data: any) => api.post('/module/van-sales-target', data),
};

export const transactionAPI = {
  // Sales Orders
  getSalesOrders: (params?: any) => api.get('/transaction/sales-order', { params }),
  getSalesOrder: (id: string) => api.get(`/transaction/sales-order/${id}`),
  createSalesOrder: (data: any) => api.post('/transaction/sales-order', data),
  updateSalesOrder: (id: string, data: any) => api.put(`/transaction/sales-order/${id}`, data),

  // Expenses
  getExpenses: (params?: any) => api.get('/transaction/expense', { params }),
  getExpense: (id: string) => api.get(`/transaction/expense/${id}`),
  createExpense: (data: any) => api.post('/transaction/expense', data),
  updateExpense: (id: string, data: any) => api.put(`/transaction/expense/${id}`, data),

  // Attendance
  getAttendance: (params?: any) => api.get('/transaction/attendance', { params }),
  getAttendanceRecord: (id: string) => api.get(`/transaction/attendance/${id}`),
  createAttendance: (data: any) => api.post('/transaction/attendance', data),
  updateAttendance: (id: string, data: any) => api.put(`/transaction/attendance/${id}`, data),
  deleteAttendance: (id: string) => api.delete(`/transaction/attendance/${id}`),

  // Tour Visits
  getTourVisits: (params?: any) => api.get('/transaction/tour-visit', { params }),
  getTourVisit: (id: string) => api.get(`/transaction/tour-visit/${id}`),
  createTourVisit: (data: any) => api.post('/transaction/tour-visit', data),
  updateTourVisit: (id: string, data: any) => api.put(`/transaction/tour-visit/${id}`, data),
  deleteTourVisit: (id: string) => api.delete(`/transaction/tour-visit/${id}`),

  // Approvals
  getPendingApprovals: (params?: any) => api.get('/transaction/approval/pending', { params }),
  approveRequest: (id: string, data?: any) => api.put(`/transaction/approval/${id}/approve`, data),
  rejectRequest: (id: string, data: any) => api.put(`/transaction/approval/${id}/reject`, data),
};

export const dashboardAPI = {
  getDashboard: () => api.get('/dashboard'),
};

export default api;
