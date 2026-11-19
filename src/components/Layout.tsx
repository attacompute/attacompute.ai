import { Activity, LayoutDashboard, Moon, RefreshCw, SlidersHorizontal, Sun } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useSellerData } from '../hooks/useSellerData';
import { useTheme } from '../hooks/useTheme';
import { formatRelativeAge } from '../lib/format';
import { BrandMark } from './BrandMark';

export function Layout() {
  const { resolved, toggle } = useTheme();
  const { config, profile, status, loading, refreshing, lastUpdatedAt, rateLimitUntilMs, refresh } =
    useSellerData();

  const updatedLabel = lastUpdatedAt
    ? `Updated ${formatRelativeAge(Math.floor(lastUpdatedAt / 1000))}`
    : loading
      ? 'Connecting…'
      : 'Offline';

  const statusTone = rateLimitUntilMs
    ? 'pill-warn'
    : status?.overall === 'down'
      ? 'pill-bad'
      : profile.live
        ? 'pill-good'
        : 'pill-warn';

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/dashboard" className="brand" aria-label={`${config.sellerName} seller dashboard`}>
            <BrandMark />
            <span>{config.sellerName}</span>
            <span className="brand-tag">seller</span>
          </NavLink>

          <nav className="nav-tabs" aria-label="Primary">
            <NavLink
              to="/dashboard"
              end
              className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
            >
              <LayoutDashboard size={15} aria-hidden="true" />
              <span>Overview</span>
            </NavLink>
            <NavLink
              to="/dashboard/pricing"
              className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
              <span>Pricing</span>
            </NavLink>
            <NavLink
              to="/dashboard/live"
              className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
            >
              <Activity size={15} aria-hidden="true" />
              <span>Live</span>
            </NavLink>
          </nav>

          <div className="topbar-spacer" />

          <div className="topbar-actions">
            {config.useFixtures && (
              <span className="pill pill-accent" title="Viewing sanitized sample snapshot">
                Fixture preview
              </span>
            )}
            <span className={`pill ${statusTone} hide-mobile`} role="status" aria-live="polite">
              <span className={`status-dot${profile.live ? ' pulse' : ''}`} aria-hidden="true" />
              <span>{updatedLabel}</span>
            </span>

            <button
              type="button"
              className="btn btn-icon"
              onClick={() => void refresh(true)}
              disabled={refreshing}
              aria-label="Refresh public AntSeedStats data"
              title="Refresh data"
            >
              <RefreshCw
                size={15}
                aria-hidden="true"
                style={refreshing ? { animation: 'spin 0.9s linear infinite' } : undefined}
              />
            </button>

            <button
              type="button"
              className="btn btn-icon"
              onClick={toggle}
              aria-label={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {resolved === 'dark' ? (
                <Sun size={16} aria-hidden="true" />
              ) : (
                <Moon size={16} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="main-content">
        <Outlet />
      </main>

      <footer className="app-footer">
        <div className="app-footer-inner">
          <span>
            Public read-only telemetry for <strong>{config.sellerName}</strong> (ERC-8004 Agent #
            {profile.agentId}). Data sourced from{' '}
            <a href="https://antseedstats.com" target="_blank" rel="noopener noreferrer">
              AntSeedStats
            </a>
            .
          </span>
          <span className="mono">
            Cache-respecting 60s poll · No live price writes
          </span>
        </div>
      </footer>
    </div>
  );
}
