import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { LoadingState } from '@/components/ui/misc';

import AuthLayout from '@/layouts/AuthLayout';
import PlatformLayout from '@/layouts/PlatformLayout';
import CompanyLayout from '@/layouts/CompanyLayout';

// ---- auth -----------------------------------------------------------------
const PlatformLogin = lazy(() => import('@/pages/platform/PlatformLogin'));
const CompanyLogin = lazy(() => import('@/pages/auth/CompanyLogin'));
const ForgotPassword = lazy(() => import('@/pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/auth/ResetPassword'));

// ---- shared ---------------------------------------------------------------
const NotFound = lazy(() => import('@/pages/NotFound'));
const Forbidden = lazy(() => import('@/pages/Forbidden'));

// ---- platform -------------------------------------------------------------
const PlatformDashboard = lazy(() => import('@/pages/platform/PlatformDashboard'));
const Companies = lazy(() => import('@/pages/platform/Companies'));
const CompanyCreate = lazy(() => import('@/pages/platform/CompanyCreate'));
const CompanyDetail = lazy(() => import('@/pages/platform/CompanyDetail'));
const CompanyEdit = lazy(() => import('@/pages/platform/CompanyEdit'));
const Plans = lazy(() => import('@/pages/platform/Plans'));
const Announcements = lazy(() => import('@/pages/platform/Announcements'));
const AuditLogs = lazy(() => import('@/pages/platform/AuditLogs'));
const PlatformReports = lazy(() => import('@/pages/platform/PlatformReports'));
const PlatformSettings = lazy(() => import('@/pages/platform/PlatformSettings'));
const Locations = lazy(() => import('@/pages/platform/Locations'));
const PlatformProfile = lazy(() => import('@/pages/platform/PlatformProfile'));

// ---- company --------------------------------------------------------------
const WorkspaceHome = lazy(() => import('@/pages/company/WorkspaceHome'));
const Profile = lazy(() => import('@/pages/company/Profile'));
const ChangePassword = lazy(() => import('@/pages/company/ChangePassword'));
const Sessions = lazy(() => import('@/pages/company/Sessions'));
const Customers = lazy(() => import('@/pages/company/Customers'));
const Orders = lazy(() => import('@/pages/company/Orders'));
const OrderEditor = lazy(() => import('@/pages/company/OrderEditor'));
const OrderDetail = lazy(() => import('@/pages/company/OrderDetail'));
const Invoices = lazy(() => import('@/pages/company/Invoices'));
const InvoiceEditor = lazy(() => import('@/pages/company/InvoiceEditor'));
const InvoiceDetail = lazy(() => import('@/pages/company/InvoiceDetail'));
const CreditNotes = lazy(() => import('@/pages/company/CreditNotes'));
const CreditNoteEditor = lazy(() => import('@/pages/company/CreditNoteEditor'));
const CreditNoteDetail = lazy(() => import('@/pages/company/CreditNoteDetail'));
const Payments = lazy(() => import('@/pages/company/Payments'));
const PaymentEditor = lazy(() => import('@/pages/company/PaymentEditor'));
const PaymentDetail = lazy(() => import('@/pages/company/PaymentDetail'));
const Products = lazy(() => import('@/pages/company/Products'));
const CatalogMasters = lazy(() => import('@/pages/company/CatalogMasters'));
const StockQuery = lazy(() => import('@/pages/company/StockQuery'));
const DayCashout = lazy(() => import('@/pages/company/DayCashout'));
const StockRequests = lazy(() => import('@/pages/company/StockRequests'));
const SalesVisit = lazy(() => import('@/pages/company/SalesVisit'));
const DayCashouts = lazy(() => import('@/pages/company/DayCashouts'));
const BeatPlan = lazy(() => import('@/pages/company/BeatPlan'));
const Suppliers = lazy(() => import('@/pages/company/Suppliers'));
const PriceLists = lazy(() => import('@/pages/company/PriceLists'));
const PriceReview = lazy(() => import('@/pages/company/PriceReview'));
const DiscountRules = lazy(() => import('@/pages/company/DiscountRules'));
const Schemes = lazy(() => import('@/pages/company/Schemes'));
const Warehouses = lazy(() => import('@/pages/company/Warehouses'));
const RoutesPage = lazy(() => import('@/pages/company/Routes'));
const Users = lazy(() => import('@/pages/company/Users'));
const CompanySettings = lazy(() => import('@/pages/company/CompanySettings'));
const AuditTrail = lazy(() => import('@/pages/company/AuditTrail'));

// ---- Phase 7: inventory + field force -------------------------------------
const Inventory = lazy(() => import('@/pages/company/Inventory'));
const Visits = lazy(() => import('@/pages/company/Visits'));
const Attendance = lazy(() => import('@/pages/company/Attendance'));
const Targets = lazy(() => import('@/pages/company/Targets'));
const Expenses = lazy(() => import('@/pages/company/Expenses'));

// ---- Phase 8: reports + notifications -------------------------------------
const Reports = lazy(() => import('@/pages/company/Reports'));
const Notifications = lazy(() => import('@/pages/company/Notifications'));

// ---- guards ---------------------------------------------------------------

function FullPageLoader({ label = 'Loading your workspace…' }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <LoadingState label={label} />
    </div>
  );
}

/** Requires a session; honours scope so a company user can't open /platform. */
function Protected({ scope, children }) {
  const { user, bootstrapping } = useAuth();
  const location = useLocation();

  if (bootstrapping) return <FullPageLoader />;

  if (!user) {
    const login = scope === 'platform' ? '/platform/login' : '/login';
    return <Navigate to={login} replace state={{ from: location.pathname + location.search }} />;
  }

  if (scope && user.scope !== scope) {
    return <Navigate to={user.scope === 'platform' ? '/platform' : '/app'} replace />;
  }

  if (user.mustChangePassword && !location.pathname.startsWith('/app/change-password')) {
    return <Navigate to="/app/change-password" replace />;
  }

  return children;
}

/** Login screens only for signed-out visitors. */
function PublicOnly({ children }) {
  const { user, bootstrapping } = useAuth();
  if (bootstrapping) return <FullPageLoader label="Checking your session…" />;
  if (user) return <Navigate to={user.scope === 'platform' ? '/platform' : '/app'} replace />;
  return children;
}

/**
 * Company modules are permission-gated at the route level as well as in the
 * sidebar, so a deep link cannot render a module the user may not use.
 */
function RequirePermission({ permission, children }) {
  const { can, isAdmin } = usePermissions();
  if (isAdmin || !permission || can(permission)) return children;
  return <Forbidden />;
}

const guard = (permission, element) => (
  <RequirePermission permission={permission}>{element}</RequirePermission>
);

function RootRedirect() {
  const { user, bootstrapping } = useAuth();
  if (bootstrapping) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.scope === 'platform' ? '/platform' : '/app'} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />

        {/* ---------------- Platform (Service Provider) ---------------- */}
        <Route
          path="/platform/login"
          element={
            <PublicOnly>
              <AuthLayout variant="platform">
                <PlatformLogin />
              </AuthLayout>
            </PublicOnly>
          }
        />
        <Route
          path="/platform"
          element={
            <Protected scope="platform">
              <PlatformLayout />
            </Protected>
          }
        >
          <Route index element={<PlatformDashboard />} />
          <Route path="companies" element={<Companies />} />
          <Route path="companies/new" element={<CompanyCreate />} />
          <Route path="companies/:id" element={<CompanyDetail />} />
          <Route path="companies/:id/edit" element={<CompanyEdit />} />
          <Route path="plans" element={<Plans />} />
          <Route path="reports" element={<PlatformReports />} />
          <Route path="announcements" element={<Announcements />} />
          <Route path="audit-logs" element={<AuditLogs />} />
          <Route path="settings" element={<PlatformSettings />} />
          <Route path="locations" element={<Locations />} />
          <Route path="profile" element={<PlatformProfile />} />
          <Route path="*" element={<Navigate to="/platform" replace />} />
        </Route>

        {/* ---------------- Company workspace ---------------- */}
        <Route path="/login" element={
          <PublicOnly>
            <AuthLayout variant="company">
              <CompanyLogin />
            </AuthLayout>
          </PublicOnly>
        } />
        <Route path="/forgot-password" element={
          <PublicOnly>
            <AuthLayout variant="company">
              <ForgotPassword />
            </AuthLayout>
          </PublicOnly>
        } />
        <Route path="/reset-password" element={
          <PublicOnly>
            <AuthLayout variant="company">
              <ResetPassword />
            </AuthLayout>
          </PublicOnly>
        } />

        <Route
          path="/app"
          element={
            <Protected scope="company">
              <CompanyLayout />
            </Protected>
          }
        >
          <Route index element={<WorkspaceHome />} />
          <Route path="profile" element={<Profile />} />
          <Route path="change-password" element={<ChangePassword />} />
          <Route path="sessions" element={<Sessions />} />

          {/* Sales */}
          <Route path="orders" element={guard('orders.view', <Orders />)} />
          <Route path="orders/new" element={guard('orders.create', <OrderEditor />)} />
          <Route path="orders/:id" element={guard('orders.view', <OrderDetail />)} />
          <Route path="orders/:id/edit" element={guard('orders.update', <OrderEditor />)} />
          <Route path="invoices" element={guard('invoices.view', <Invoices />)} />
          <Route path="invoices/new" element={guard('invoices.create', <InvoiceEditor />)} />
          <Route path="invoices/:id" element={guard('invoices.view', <InvoiceDetail />)} />
          <Route path="invoices/:id/edit" element={guard('invoices.update', <InvoiceEditor />)} />
          <Route path="credit-notes" element={guard('creditnotes.view', <CreditNotes />)} />
          <Route
            path="credit-notes/new"
            element={guard('creditnotes.create', <CreditNoteEditor />)}
          />
          <Route path="credit-notes/:id" element={guard('creditnotes.view', <CreditNoteDetail />)} />
          <Route
            path="credit-notes/:id/edit"
            element={guard('creditnotes.update', <CreditNoteEditor />)}
          />
          <Route path="payments" element={guard('payments.view', <Payments />)} />
          <Route path="payments/new" element={guard('payments.create', <PaymentEditor />)} />
          <Route path="payments/:id" element={guard('payments.view', <PaymentDetail />)} />
          <Route path="payments/:id/edit" element={guard('payments.update', <PaymentEditor />)} />

          {/* Masters */}
          <Route path="customers" element={guard('customers.view', <Customers />)} />
          <Route path="products" element={guard('products.view', <Products />)} />
          <Route path="catalog" element={guard('products.view', <CatalogMasters />)} />
          <Route path="stock-query" element={<StockQuery />} />
          <Route path="day-cashout" element={<DayCashout />} />
          <Route path="my-van" element={<Navigate to="/app/stock-query" replace />} />
          <Route path="stock-requests" element={<StockRequests />} />
          <Route path="sales" element={<SalesVisit />} />
          <Route path="my-beat" element={<Navigate to="/app/sales" replace />} />
          <Route path="day-cashouts" element={guard('vans.daycash.approve', <DayCashouts />)} />
          <Route path="beat-plan" element={guard('fieldforce.targets.manage', <BeatPlan />)} />
          <Route path="suppliers" element={guard('products.view', <Suppliers />)} />
          <Route path="price-lists" element={guard('products.view', <PriceLists />)} />
          <Route path="price-review" element={guard('products.update', guard('products.cost.view', <PriceReview />))} />
          <Route path="discounts" element={guard('discounts.view', <DiscountRules />)} />
          <Route path="schemes" element={guard('schemes.view', <Schemes />)} />
          <Route path="warehouses" element={guard('inventory.view', <Warehouses />)} />
          <Route path="routes" element={guard('customers.view', <RoutesPage />)} />

          {/* Field force */}
          <Route path="visits" element={guard('fieldforce.visits.view', <Visits />)} />
          <Route path="attendance" element={guard('fieldforce.attendance.view', <Attendance />)} />
          <Route path="targets" element={guard('fieldforce.targets.view', <Targets />)} />
          <Route path="expenses" element={guard('fieldforce.expenses.view', <Expenses />)} />

          {/* Insights */}
          <Route
            path="reports"
            element={guard('reports.view', <Reports />)}
          />
          <Route path="inventory" element={guard('inventory.view', <Inventory />)} />

          {/* Admin */}
          <Route path="users" element={guard('users.view', <Users />)} />
          <Route path="settings" element={guard('settings.view', <CompanySettings />)} />
          <Route path="audit-logs" element={guard('audit.view', <AuditTrail />)} />
          <Route
            path="notifications"
            element={guard(null, <Notifications />)}
          />

          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>

        {/* Convenience aliases */}
        <Route path="/dashboard" element={<Navigate to="/app" replace />} />

        {/* Errors */}
        <Route path="/403" element={<Forbidden />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
