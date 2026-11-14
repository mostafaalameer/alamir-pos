import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { ProtectedRoute, homeFor } from './components/ProtectedRoute';
import { AdminLayout } from './layouts/AdminLayout';
import { LoginPage } from './pages/LoginPage';
import { PosPage } from './pages/PosPage';
import { DashboardPage } from './pages/admin/DashboardPage';
import { ProductsPage } from './pages/admin/ProductsPage';
import { InvoicesPage } from './pages/admin/InvoicesPage';
import { ExpiryPage } from './pages/admin/ExpiryPage';
import { ShiftsPage } from './pages/admin/ShiftsPage';
import { ReportsPage } from './pages/admin/ReportsPage';
import { LoyaltyPage } from './pages/admin/LoyaltyPage';
import { BackupPage } from './pages/admin/BackupPage';
import { UsersPage } from './pages/admin/UsersPage';

function RootRedirect() {
  const { session } = useAuth();
  return <Navigate to={session ? homeFor(session.user.role) : '/login'} replace />;
}

export function App() {
  return (
    <AuthProvider>
      <DataProvider>
        <BrowserRouter>
          <Toaster
            position="top-center"
            dir="rtl"
            richColors
            theme="dark"
            toastOptions={{
              style: { fontFamily: 'inherit' },
            }}
          />
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            {/* Admin-only routes with collapsible RTL Sidebar Layout */}
            <Route element={<ProtectedRoute allow={['ADMIN']} />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="products" element={<ProductsPage />} />
                <Route path="invoices" element={<InvoicesPage />} />
                <Route path="expiry" element={<ExpiryPage />} />
                <Route path="shifts" element={<ShiftsPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="loyalty" element={<LoyaltyPage />} />
                <Route path="settings/loyalty" element={<LoyaltyPage />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="backup" element={<BackupPage />} />
              </Route>
            </Route>

            {/* Cashier & Admin POS Checkout Route */}
            <Route element={<ProtectedRoute allow={['ADMIN', 'CASHIER']} />}>
              <Route path="/pos" element={<PosPage />} />
            </Route>

            <Route path="*" element={<RootRedirect />} />
          </Routes>
        </BrowserRouter>
      </DataProvider>
    </AuthProvider>
  );
}

export default App;
