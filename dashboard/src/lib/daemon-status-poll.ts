import { sleep } from '@/lib/lan-sync-poll';

export async function pollDaemonStatusUntil<T>(
  fetchStatus: () => Promise<T>,
  predicate: (status: T) => boolean,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
    onStatus?: (status: T) => void;
  },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 5_000;
  const intervalMs = options?.intervalMs ?? 300;
  const deadline = Date.now() + timeoutMs;

  /* eslint-disable react-doctor/async-await-in-loop -- sequential daemon status polling */
  while (Date.now() < deadline) {
    try {
      const next = await fetchStatus();
      options?.onStatus?.(next);
      if (predicate(next)) return;
    } catch (error) {
      console.warn('Failed to poll daemon status:', error);
    }

    /* eslint-disable-next-line react-doctor/async-await-in-loop -- poll until predicate passes */
    await sleep(intervalMs);
  }
  /* eslint-enable react-doctor/async-await-in-loop */
}
