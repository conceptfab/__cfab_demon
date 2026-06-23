/**
 * Tests for usePageError hook.
 *
 * Verifies that the hook logs the error and surfaces it as a toast.
 * Uses jsdom environment (*.test.tsx) so React rendering works.
 */
import { render, screen, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePageError } from '@/hooks/usePageError';
import { ToastProvider } from '@/components/ui/toast-notification';

// Mock react-i18next — ToastProvider uses useTranslation for the aria dismiss label.
// Use importOriginal so that i18n.ts (which imports initReactI18next) still works.
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { resolvedLanguage: 'en' },
    }),
  };
});

// Spy on console.error to verify logTauriError output without polluting test output.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function TestComponent({ trigger }: { trigger: () => void }) {
  const reportError = usePageError();
  return (
    <button
      type="button"
      onClick={() => {
        trigger();
        reportError('save record', new Error('DB write failed'), 'Fallback message');
      }}
    >
      trigger
    </button>
  );
}

describe('usePageError', () => {
  it('shows a toast with the error message when called', async () => {
    const trigger = vi.fn();

    render(
      <ToastProvider>
        <TestComponent trigger={trigger} />
      </ToastProvider>,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'trigger' }).click();
    });

    // Toast message is the actual Error.message (via getErrorMessage).
    expect(screen.getByText('DB write failed')).toBeTruthy();
  });

  it('uses fallback message when error has no message', async () => {
    function TestFallback() {
      const reportError = usePageError();
      return (
        <button
          type="button"
          onClick={() => {
            reportError('load data', null, 'Failed to load data');
          }}
        >
          go
        </button>
      );
    }

    render(
      <ToastProvider>
        <TestFallback />
      </ToastProvider>,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'go' }).click();
    });

    expect(screen.getByText('Failed to load data')).toBeTruthy();
  });

  it('calls console.error (via logTauriError)', async () => {
    render(
      <ToastProvider>
        <TestComponent trigger={vi.fn()} />
      </ToastProvider>,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'trigger' }).click();
    });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[TIMEFLOW]'),
      expect.any(Error),
    );
  });
});
