import type { ProjectStatus } from '@/lib/tauri';

export const CLIENT_PROJECT_STATUSES: ProjectStatus[] = [
  'active',
  'frozen',
  'excluded',
];

export const EMPTY_CLIENT_FORM = {
  name: '',
  contact: '',
  address: '',
  taxId: '',
  currency: '',
  defaultHourlyRate: '',
  color: '#38bdf8',
};

export type ClientFormState = typeof EMPTY_CLIENT_FORM;

export const CLIENT_FORM_INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

export const CLIENT_FORM_SELECT_CLASS =
  'rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
