import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const probeCfabHubDb = vi.fn();

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@/lib/tauri', () => ({
  databaseApi: { openDbFolder: vi.fn() },
  settingsApi: {
    getDemoModeStatus: vi.fn().mockResolvedValue({ primaryDbPath: '/tmp/tf.db' }),
  },
  cfabRenderApi: { probeCfabHubDb: (...args: unknown[]) => probeCfabHubDb(...args) },
}));

import { SettingsIntegrationTab } from './SettingsIntegrationTab';

const t = (key: string) => key;

function renderTab(enabled: boolean) {
  return render(
    <SettingsIntegrationTab
      cfabHubIntegration={{ enabled, hubDbPath: '/tmp/missing.db' }}
      labelClassName=""
      savedSettings={false}
      t={t}
      updateCfabHubIntegration={vi.fn()}
    /> as never,
  );
}

describe('SettingsIntegrationTab probe status', () => {
  beforeEach(() => {
    probeCfabHubDb.mockReset();
    probeCfabHubDb.mockResolvedValue('missing');
  });

  it('shows missing-file icon and data-state after probe', async () => {
    renderTab(true);
    const status = await screen.findByText('settings_page.integration_status_missing');
    expect(status.getAttribute('data-state')).toBe('missing');
    expect(status.querySelector('svg.lucide-circle-x')).not.toBeNull();
    expect(probeCfabHubDb).toHaveBeenCalled();
  });

  it('shows disabled icon without probing the Hub database', async () => {
    renderTab(false);
    const status = await screen.findByText(
      'settings_page.integration_status_disabled',
    );
    expect(status.getAttribute('data-state')).toBe('disabled');
    expect(status.querySelector('svg.lucide-circle-off')).not.toBeNull();
    await waitFor(() => {
      expect(probeCfabHubDb).not.toHaveBeenCalled();
    });
  });
});
