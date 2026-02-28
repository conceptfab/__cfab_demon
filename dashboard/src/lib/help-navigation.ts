export const HELP_TAB_IDS = [
  "quickstart",
  "dashboard",
  "sessions",
  "projects",
  "estimates",
  "apps",
  "analysis",
  "ai",
  "data",
  "daemon",
  "settings",
] as const;

export type HelpTabId = (typeof HELP_TAB_IDS)[number];

const HELP_TAB_SET = new Set<string>(HELP_TAB_IDS);

export const DEFAULT_HELP_TAB: HelpTabId = "quickstart";

const HELP_TAB_TO_PAGE: Record<HelpTabId, string> = {
  quickstart: "quickstart",
  dashboard: "dashboard",
  sessions: "sessions",
  projects: "projects",
  estimates: "estimates",
  apps: "applications",
  analysis: "analysis",
  ai: "ai",
  data: "data",
  daemon: "daemon",
  settings: "settings",
};

const PAGE_TO_HELP_TAB: Record<string, HelpTabId> = {
  quickstart: "quickstart",
  dashboard: "dashboard",
  sessions: "sessions",
  projects: "projects",
  "project-card": "projects",
  estimates: "estimates",
  applications: "apps",
  analysis: "analysis",
  ai: "ai",
  import: "data",
  data: "data",
  daemon: "daemon",
  settings: "settings",
};

export function isHelpTabId(value: string): value is HelpTabId {
  return HELP_TAB_SET.has(value);
}

export function normalizeHelpTab(
  value: string | null | undefined,
  fallback: HelpTabId = DEFAULT_HELP_TAB,
): HelpTabId {
  if (!value) return fallback;
  return isHelpTabId(value) ? value : fallback;
}

export function helpTabForPage(
  page: string,
  fallback: HelpTabId = DEFAULT_HELP_TAB,
): HelpTabId {
  return PAGE_TO_HELP_TAB[page] ?? fallback;
}

export function pageForHelpTab(tab: HelpTabId): string {
  return HELP_TAB_TO_PAGE[tab];
}
