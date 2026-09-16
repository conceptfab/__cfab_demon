// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';

export interface CfabRenderRow {
  ledger_id: number;
  working_path: string;
  render_seconds: number;
  rbh: number;
  value: number;
  ended_at: number;
}

export interface CfabRenderDay {
  date: string;
  render_seconds: number;
  rbh: number;
  value: number;
  rows: CfabRenderRow[];
}

export interface CfabRenderIngestResult {
  ingested: number;
  updated: number;
  days: CfabRenderDay[];
}

export interface CfabRenderProjectState {
  coefficient: number;
  include_in_billing: boolean;
  effective_hourly_rate: number;
  days: CfabRenderDay[];
}

export const emptyCfabRenderProjectState = (): CfabRenderProjectState => ({
  coefficient: 0.2,
  include_in_billing: false,
  effective_hourly_rate: 0,
  days: [],
});

export const getCfabRenderProject = (projectId: number) =>
  invoke<CfabRenderProjectState>('get_cfab_render_project', { projectId });

export const ingestCfabRenderForProject = (projectId: number) =>
  invokeMutation<CfabRenderIngestResult>('ingest_cfab_render_for_project', {
    projectId,
  });

export const updateCfabRenderProjectSettings = (
  projectId: number,
  coefficient: number,
  includeInBilling: boolean,
) =>
  invokeMutation<CfabRenderProjectState>('update_cfab_render_project_settings', {
    projectId,
    coefficient,
    includeInBilling,
  });

export const probeCfabHubDb = (path?: string | null) =>
  invoke<string>('probe_cfab_hub_db', {
    path: path && path.trim() ? path.trim() : null,
  });

export const cfabRenderApi = {
  getCfabRenderProject,
  ingestCfabRenderForProject,
  updateCfabRenderProjectSettings,
  probeCfabHubDb,
} as const;
