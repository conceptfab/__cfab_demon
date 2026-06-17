export const MOBILE_SHELL_BREAKPOINT_PX = 768;

export function isMobileShellViewport(width: number): boolean {
  return width < MOBILE_SHELL_BREAKPOINT_PX;
}

export function prefersCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(hover: none), (pointer: coarse)').matches;
}
