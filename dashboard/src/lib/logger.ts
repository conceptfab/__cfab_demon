/**
 * Centralized logger with level control.
 * In production, only warnings and errors are logged.
 * Set localStorage['TIMEFLOW_DEBUG'] = '1' to enable debug/info in production.
 */
const isDebug =
  import.meta.env.DEV ||
  (typeof localStorage !== 'undefined' && localStorage.getItem('TIMEFLOW_DEBUG') === '1');

export const logger = {
  debug: isDebug ? console.debug.bind(console) : () => {},
  info: isDebug ? console.info.bind(console) : () => {},
  log: isDebug ? console.log.bind(console) : () => {},
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
