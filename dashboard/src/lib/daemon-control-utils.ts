export function isDaemonControlDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

export function parseDaemonLogLines(logs: string) {
  if (!logs) return [];
  const seen = new Map<string, number>();
  return logs.split('\n').map((line) => {
    const count = (seen.get(line) ?? 0) + 1;
    seen.set(line, count);
    const key = `${line}\u0000${count}`;
    const className = line.includes('[ERROR]')
      ? 'text-red-400'
      : line.includes('[WARN]')
        ? 'text-yellow-400'
        : 'text-muted-foreground';
    return { key, line, className };
  });
}
