import { describe, expect, it } from 'vitest';
import {
  MOBILE_SHELL_BREAKPOINT_PX,
  isMobileShellViewport,
} from './mobile-shell';

describe('mobile shell helpers', () => {
  it('uses the Tailwind md breakpoint as the mobile shell boundary', () => {
    expect(MOBILE_SHELL_BREAKPOINT_PX).toBe(768);
  });

  it('enables the mobile shell below the desktop navigation breakpoint', () => {
    expect(isMobileShellViewport(360)).toBe(true);
    expect(isMobileShellViewport(767)).toBe(true);
    expect(isMobileShellViewport(768)).toBe(false);
    expect(isMobileShellViewport(1024)).toBe(false);
  });
});
