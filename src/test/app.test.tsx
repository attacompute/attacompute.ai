import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DashboardRoutes } from '../App';
import { getAppConfig } from '../config';
import { SellerDataProvider } from '../hooks/useSellerData';
import { ThemeProvider } from '../hooks/useTheme';

function renderAt(route: string) {
  const config = { ...getAppConfig(), useFixtures: true };
  return render(
    <ThemeProvider>
      <SellerDataProvider configOverride={config}>
        <MemoryRouter initialEntries={[route]}>
          <DashboardRoutes />
        </MemoryRouter>
      </SellerDataProvider>
    </ThemeProvider>,
  );
}

describe('Dashboard pages smoke & accessibility', () => {
  it('renders Overview with headline KPIs, trust gate, and alerts', async () => {
    renderAt('/dashboard');
    expect(await screen.findByRole('heading', { level: 1, name: /attacompute\.ai/i })).toBeInTheDocument();
    expect(await screen.findByText(/Trust score vs 60 buyer gate/i)).toBeInTheDocument();
    expect(await screen.findByText(/Top models by settled revenue/i)).toBeInTheDocument();
    expect(await screen.findByText(/Listing not announcing on DHT/i)).toBeInTheDocument();
  });

  it('renders Pricing workbench, supports Include peer & opens review drawer', async () => {
    renderAt('/dashboard/pricing');
    expect(
      await screen.findByRole('heading', { level: 1, name: /Prices, Market Rank & Fallback Peers/i }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText(/Extra headroom percentage/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/^Input slider for Claude Sonnet 5\.5$/i)).toBeInTheDocument();

    // Click Include on the first price-blocked peer (RedPill) to unlock it
    const includeBtns = await screen.findAllByRole('button', { name: /^Include$/i });
    expect(includeBtns.length).toBeGreaterThan(0);
    fireEvent.click(includeBtns[0]!);

    expect(await screen.findByText(/Become available \(1\)/i)).toBeInTheDocument();
    const submitBtn = await screen.findByRole('button', { name: /Submit for change/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Preview only — live prices are never changed here/i)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Open GitHub issue/i })).toBeInTheDocument();
  });

  it('renders Live page gracefully with 2D fallback in jsdom (no WebGL)', async () => {
    renderAt('/dashboard/live');
    expect(
      await screen.findByRole('heading', { level: 1, name: /Buyers → attacompute\.ai/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/2D fallback active/i)).toBeInTheDocument();
    expect(await screen.findByText(/Recent public activity/i)).toBeInTheDocument();
  });
});
