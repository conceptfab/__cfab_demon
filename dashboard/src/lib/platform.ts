export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  const source = uaData?.platform || navigator.platform || navigator.userAgent || "";
  return /mac/i.test(source);
}
