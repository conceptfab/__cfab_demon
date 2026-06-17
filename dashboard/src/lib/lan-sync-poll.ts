import { lanSyncApi } from '@/lib/tauri';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll daemon LAN sync progress until completed or timeout. */
export async function pollLanSyncUntilComplete(options?: {
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<void> {
  const intervalMs = options?.intervalMs ?? 800;
  const deadline = Date.now() + (options?.timeoutMs ?? 300_000);
  let lastPhase = '';

  /* eslint-disable react-doctor/async-await-in-loop -- sequential LAN sync progress polling */
  while (Date.now() < deadline) {
    /* eslint-disable-next-line react-doctor/async-await-in-loop -- poll until daemon reports completion */
    await sleep(intervalMs);
    try {
      const progress = await lanSyncApi.getLanSyncProgress();
      if (progress.phase !== lastPhase) {
        lastPhase = progress.phase;
      }
      if (
        progress.phase === 'completed' ||
        (progress.phase === 'idle' && progress.step === 0 && lastPhase !== '')
      ) {
        return;
      }
    } catch {
      // daemon unreachable
    }
  }
  /* eslint-enable react-doctor/async-await-in-loop */
}
