import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SkeletonCard } from './components/DataState';
import { Layout } from './components/Layout';
import { getAppConfig } from './config';
import { SellerDataProvider } from './hooks/useSellerData';
import { ThemeProvider } from './hooks/useTheme';
import { OverviewPage } from './pages/OverviewPage';
import { PricingPage } from './pages/PricingPage';

const LivePage = lazy(() =>
  import('./pages/LivePage').then((mod) => ({ default: mod.LivePage })),
);

function RedirectToDashboard() {
  const { search } = useLocation();
  return <Navigate to={`/dashboard${search}`} replace />;
}

function LiveFallback() {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SkeletonCard height={80} />
      <SkeletonCard height={440} />
    </div>
  );
}

export function DashboardRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RedirectToDashboard />} />
      <Route path="/dashboard" element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="pricing" element={<PricingPage />} />
        <Route
          path="live"
          element={
            <Suspense fallback={<LiveFallback />}>
              <LivePage />
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<RedirectToDashboard />} />
    </Routes>
  );
}

export function App() {
  const config = getAppConfig();
  const basename =
    config.basePath !== '/' && config.basePath !== '/dashboard/'
      ? config.basePath.replace(/\/$/, '')
      : '/';

  return (
    <ThemeProvider>
      <SellerDataProvider configOverride={config}>
        <BrowserRouter basename={basename}>
          <DashboardRoutes />
        </BrowserRouter>
      </SellerDataProvider>
    </ThemeProvider>
  );
}
