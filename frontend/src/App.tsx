import { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "./components/layout/AppLayout";
import { Toaster } from "./components/ui/toaster";
import { useAuthStore } from "./store/auth";
import { Dashboard } from "./pages/Dashboard";
import { Analytics } from "./pages/Analytics";
import { UsageLogs } from "./pages/UsageLogs";
import { Channels } from "./pages/Channels";
import { Tokens } from "./pages/Tokens";
import { Pricing } from "./pages/Pricing";
import { ApiTest } from "./pages/ApiTest";
import { NotFound } from "./pages/NotFound";
import { SystemSettings } from "./pages/SystemSettings";
import { Users } from "./pages/Users";
import { MyAccount } from "./pages/MyAccount";
import { Redemptions } from "./pages/Redemptions";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

// 管理员路由: 仅 admin/root 可访问; 普通用户跳转个人中心
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, currentUser } = useAuthStore();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if ((currentUser?.role ?? 0) < 10) {
    return <Navigate to="/account" replace />;
  }

  return <>{children}</>;
}

function HomeRoute() {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return null;
  }

  if (isAuthenticated) {
    // 登录用户统一进总览看板 (普通用户看自己的调用, 管理员看全局)
    return <Navigate to="/dashboard" replace />;
  }

  return <Dashboard />;
}

function App() {
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <AppLayout>
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/analytics" element={<Navigate to="/dashboard" replace />} />
            <Route
              path="/api-test"
              element={
                <ProtectedRoute>
                  <ApiTest />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Analytics />
                </ProtectedRoute>
              }
            />
            <Route
              path="/usage-logs"
              element={
                <AdminRoute>
                  <UsageLogs />
                </AdminRoute>
              }
            />
            <Route
              path="/channels"
              element={
                <AdminRoute>
                  <Channels />
                </AdminRoute>
              }
            />
            <Route
              path="/channels/new"
              element={
                <AdminRoute>
                  <Channels createMode />
                </AdminRoute>
              }
            />
            <Route
              path="/channels/edit/:key"
              element={
                <AdminRoute>
                  <Channels editRoute />
                </AdminRoute>
              }
            />
            <Route
              path="/tokens"
              element={
                <ProtectedRoute>
                  <Tokens />
                </ProtectedRoute>
              }
            />
            <Route
              path="/tokens/new"
              element={
                <ProtectedRoute>
                  <Tokens createMode />
                </ProtectedRoute>
              }
            />
            <Route
              path="/tokens/edit/:key"
              element={
                <ProtectedRoute>
                  <Tokens editRoute />
                </ProtectedRoute>
              }
            />
                        <Route
              path="/users"
              element={
                <AdminRoute>
                  <Users />
                </AdminRoute>
              }
            />
            <Route
              path="/account"
              element={
                <ProtectedRoute>
                  <MyAccount />
                </ProtectedRoute>
              }
            />
            <Route
              path="/redemptions"
              element={
                <AdminRoute>
                  <Redemptions />
                </AdminRoute>
              }
            />
            <Route
              path="/pricing"
              element={
                <ProtectedRoute>
                  <Pricing />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <AdminRoute>
                  <SystemSettings />
                </AdminRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
        <Toaster />
      </Router>
    </QueryClientProvider>
  );
}

export default App;
