// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';
import type { DateRange } from '@/lib/db-types';

// Mirrors the PM project status (single source of truth).
export type ProjectStatus = 'active' | 'frozen' | 'excluded' | 'archived';

export interface Client {
  id: number;
  name: string;
  contact: string | null;
  address: string | null;
  tax_id: string | null;
  currency: string | null;
  default_hourly_rate: number | null;
  color: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientProjectSummary {
  project_id: number;
  project_name: string;
  project_color: string;
  status: ProjectStatus;
  seconds: number;
  value: number;
  /** Sekundy per kalendarzowy dzień — do zaokrąglania `per_day`. */
  daily_seconds: number[];
}

export interface ClientSummary {
  client_name: string;
  color: string;
  projects: ClientProjectSummary[];
  project_count: number;
  total_seconds: number;
  total_value: number;
  active_value: number;
  done_value: number;
  paid_value: number;
  paid_seconds: number;
  /** Łączny czas per kalendarzowy dzień — do zaokrąglania `per_day`. */
  daily_seconds: number[];
}

export interface ClientInput {
  name: string;
  contact?: string | null;
  address?: string | null;
  taxId?: string | null;
  currency?: string | null;
  defaultHourlyRate?: number | null;
  color?: string | null;
}

export interface ProjectClientRow {
  id: number;
  name: string;
  color: string;
  client_name: string | null;
  status: ProjectStatus;
}

export const clientsList = () => invoke<Client[]>('clients_list');

export const projectsWithClient = () =>
  invoke<ProjectClientRow[]>('projects_with_client');

export interface ClientAutofillResult {
  clients_created: number;
  projects_assigned: number;
}

export const clientsSyncFromPm = () =>
  invokeMutation<ClientAutofillResult>('clients_sync_from_pm');

export const clientsCreate = (input: ClientInput) =>
  invokeMutation<Client>('clients_create', { ...input });

export const clientsUpdate = (id: number, input: ClientInput) =>
  invokeMutation<Client>('clients_update', { id, ...input });

export const clientsArchive = (id: number, archived: boolean) =>
  invokeMutation<Client>('clients_archive', { id, archived });

export const clientsDelete = (id: number, name: string) =>
  invokeMutation<void>('clients_delete', { id, name });

export const projectSetClient = (projectId: number, clientName: string | null) =>
  invokeMutation<void>('project_set_client', { projectId, clientName });

export const projectSetStatus = (projectId: number, status: ProjectStatus) =>
  invokeMutation<void>('project_set_status', { projectId, status });

export const getClientsSummary = (dateRange: DateRange) =>
  invoke<ClientSummary[]>('get_clients_summary', { dateRange });
