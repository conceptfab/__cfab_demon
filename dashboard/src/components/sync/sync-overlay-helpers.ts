/**
 * The local DB is frozen only from the "freezing" step (step 5) until the
 * session completes/unfreezes. Before that — creating_session / awaiting_peer /
 * negotiating (steps 1–4) — recording is still running, so the "Recording is
 * paused" notice must NOT be shown. Mirrors src/online_sync.rs (freeze at step 5)
 * and the LAN orchestrator (freeze at step 5).
 */
export function shouldShowFrozenNotice(phase: string, step: number): boolean {
  if (phase === 'completed' || phase === 'not_needed') return false;
  if (phase.startsWith('error')) return false;
  return step >= 5;
}
