export interface PmProject {
  prj_folder: string;
  prj_number: string;
  prj_year: string;
  prj_code: string;
  prj_client: string;
  prj_name: string;
  prj_desc: string;
  prj_full_name: string;
  prj_budget: string;
  prj_term: string;
  prj_status: string;
}

export interface PmNewProject {
  prj_client: string;
  prj_name: string;
  prj_desc: string;
  prj_budget: string;
  prj_term: string;
  template_id: string;
}

export interface PmFolderTemplate {
  id: string;
  name: string;
  is_default: boolean;
  folders: string[];
}

export interface PmSettings {
  work_folder: string;
  settings_folder: string;
}

export type PmSortField = 'global' | 'number' | 'year' | 'client' | 'name' | 'status';

export interface PmClientInfo {
  color: string;
  comment: string;
  contact: string;
}

/** Map of uppercase client group name → client info */
export type PmClientColors = Record<string, PmClientInfo>;
