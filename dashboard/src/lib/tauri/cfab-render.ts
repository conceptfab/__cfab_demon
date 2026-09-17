export type PeerState = 'absent' | 'stale' | 'alive' | 'incompatible' | 'unreadable';

export interface CfabMachineRow {
  machine_name: string;
  hub_instance_id: string;
  last_ended_at: number;
  total_renders: number;
}

export interface CfabHubPeerInfo {
  state: PeerState;
  version?: string | null;
  db_path?: string | null;
  contract?: number | null;
  heartbeat_at?: number | null;
  source: 'override' | 'beacon' | 'canonical';
  resolved_path: string;
  probe_status: string;
  machines: CfabMachineRow[];
}

// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';

export interface CfabRenderRow {
  hub_instance_id: string;
  ledger_id: number;
  working_path: string;
  render_seconds: number;
  rbh: number;
  value: number;
  ended_at: number;
  thumbnail_path?: string | null;
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
  include_render_in_hours_limit: boolean;
  effective_hourly_rate: number;
  days: CfabRenderDay[];
}

export const emptyCfabRenderProjectState = (): CfabRenderProjectState => ({
  coefficient: 0.2,
  include_in_billing: false,
  include_render_in_hours_limit: false,
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

export const getCfabHubPeer = () =>
  invoke<CfabHubPeerInfo>('get_cfab_hub_peer');


export interface CfabUnassignedRenderRow {
  hub_instance_id: string;
  ledger_id: number;
  working_path: string;
  render_seconds: number;
  rbh: number;
  ended_at: number;
  machine_name?: string | null;
  matched_project_id?: number | null;
  matched_project_name?: string | null;
}

export interface CfabRenderCostDetail {
  id: number;
  hub_instance_id: string;
  ledger_id: number;
  project_id: number;
  project_name: string;
  working_path: string;
  render_seconds: number;
  rbh: number;
  coefficient: number;
  value: number;
  ended_at: number;
  ingested_at: string;
  machine_name?: string | null;
  assigned_by: string;
  assigned_at?: string | null;
}

export interface CfabAllRendersResponse {
  total: number;
  total_seconds: number;
  total_rbh: number;
  total_value: number;
  items: CfabRenderCostDetail[];
}

export const getUnassignedCfabRenders = () =>
  invoke<CfabUnassignedRenderRow[]>('get_unassigned_cfab_renders');

export const getAllCfabRenders = (params: {
  projectId?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number | null;
  offset?: number | null;
}) =>
  invoke<CfabAllRendersResponse>('get_all_cfab_renders', params);

export const assignCfabRender = (
  hubInstanceId: string,
  ledgerId: number,
  projectId: number,
  rememberRule: boolean,
) =>
  invokeMutation<void>('assign_cfab_render', {
    hubInstanceId,
    ledgerId,
    projectId,
    rememberRule,
  });

export const reassignCfabRender = (
  hubInstanceId: string,
  ledgerId: number,
  newProjectId: number,
) =>
  invokeMutation<void>('reassign_cfab_render', {
    hubInstanceId,
    ledgerId,
    newProjectId,
  });

export const detachCfabRender = (hubInstanceId: string, ledgerId: number) =>
  invokeMutation<void>('detach_cfab_render', {
    hubInstanceId,
    ledgerId,
  });

export const cfabRenderApi = {
  getCfabRenderProject,
  ingestCfabRenderForProject,
  updateCfabRenderProjectSettings,
  probeCfabHubDb,
  getCfabHubPeer,
  getUnassignedCfabRenders,
  getAllCfabRenders,
  assignCfabRender,
  reassignCfabRender,
  detachCfabRender,
} as const;

