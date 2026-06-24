import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

vi.mock('@/lib/platform', () => ({ isMacOS: () => true }));
vi.mock('@/lib/window-drag', () => ({ tryStartWindowDrag: vi.fn() }));
vi.mock('@/hooks/useSidebarController', () => ({
  useSidebarController: () => ({
    currentPage: 'dashboard',
    isBugHunterOpen: false,
    setIsBugHunterOpen: vi.fn(),
    status: null,
  }),
}));
vi.mock('@/store/settings-store', () => ({
  useSettingsStore: (selector: (state: object) => unknown) =>
    selector({ sidebarCollapsed: false, toggleSidebarCollapsed: vi.fn() }),
}));
vi.mock('@/components/layout/SidebarNav', () => ({ SidebarNav: () => null }));
vi.mock('@/components/layout/SidebarStatusPanel', () => ({
  SidebarStatusPanel: () => null,
}));
vi.mock('@/components/layout/BugHunter', () => ({ BugHunter: () => null }));

import { Sidebar } from '@/components/layout/Sidebar';

describe('Sidebar macOS collapse toggle', () => {
  it('matches the compact Codex-style titlebar placement', () => {
    render(<Sidebar />);

    const button = screen.getByRole('button', {
      name: 'layout.aria.collapse_sidebar',
    });
    const wrapper = button.parentElement;
    const icon = button.querySelector('svg');

    expect(wrapper?.className).toContain('left-[77px]');
    expect(wrapper?.className).toContain('top-[4px]');
    expect(wrapper?.className).toContain('h-[22px]');
    expect(button.className).toContain('size-[22px]');
    expect(icon?.getAttribute('class')).toContain('size-[13px]');
  });
});
