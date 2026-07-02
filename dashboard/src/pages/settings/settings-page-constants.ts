export const SETTINGS_HOURS = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, '0'),
);
export const SETTINGS_MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, '0'),
);

export type SettingsTab =
  | 'general'
  | 'sessions'
  | 'algorithm'
  | 'rounding'
  | 'sync'
  | 'pm'
  | 'webserver'
  | 'mcp'
  | 'advanced';

export const SETTINGS_TAB_IDS: SettingsTab[] = [
  'general',
  'sessions',
  'algorithm',
  'rounding',
  'sync',
  'pm',
  'webserver',
  'mcp',
  'advanced',
];
