/**
 * Centralized logger with level control.
 * In production, only warnings and errors are logged.
 * Set localStorage['TIMEFLOW_DEBUG'] = '1' to enable debug/info in production.
 */
const isDebug =
  import.meta.env.DEV ||
  (typeof localStorage !== 'undefined' && localStorage.getItem('TIMEFLOW_DEBUG') === '1');

function forward(level: string, args: unknown[]) {
  void import('@/lib/tauri/log-management')
    .then((m) => m.appendFrontendLog(level, args.map(String).join(' ')))
    .catch(() => {});
}

export const logger = {
  debug: isDebug ? console.debug.bind(console) : () => {},
  info: isDebug ? console.info.bind(console) : () => {},
  log: isDebug ? console.log.bind(console) : () => {},
  warn: (...a: unknown[]) => { console.warn(...a); forward('warn', a); },
  error: (...a: unknown[]) => { console.error(...a); forward('error', a); },
};
