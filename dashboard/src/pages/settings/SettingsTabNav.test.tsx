import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsTabNav } from '@/pages/settings/SettingsTabNav';
import { SETTINGS_TAB_IDS, type SettingsTab } from '@/pages/settings/settings-page-constants';

const labels = {
  general: 'General',
  sessions: 'Sessions',
  algorithm: 'Time algorithm',
  rounding: 'Rounding',
  sync: 'Sync',
  pm: 'PM',
  webserver: 'Web Server',
  mcp: 'MCP',
  advanced: 'Advanced',
} satisfies Record<SettingsTab, string>;

const tabMeta = Object.fromEntries(
  SETTINGS_TAB_IDS.map((id) => [
    id,
    {
      label: labels[id],
      active: 'border-primary text-primary',
    },
  ]),
) as Record<SettingsTab, { label: string; active: string }>;

describe('SettingsTabNav', () => {
  it('renders every settings tab in a single-line tablist', () => {
    render(
      <SettingsTabNav
        activeTab="general"
        setActiveTab={vi.fn()}
        tabMeta={tabMeta}
      />,
    );

    const tablist = screen.getByRole('tablist');
    expect(tablist.className).toContain('sm:flex-nowrap');
    expect(tablist.className).not.toContain('sm:flex-wrap');
    expect(tablist.className).not.toContain('sm:overflow-x-auto');

    for (const id of SETTINGS_TAB_IDS) {
      expect(screen.getByRole('tab', { name: labels[id] })).toBeTruthy();
    }
  });
});
