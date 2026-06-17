import type { PmProject } from '@/lib/pm-types';

export type PmProjectDetailDialogState = {
  editing: boolean;
  form: PmProject;
  folderSize: number | null | undefined;
  submitting: boolean;
  error: string | null;
};

export function buildPmProjectDetailDialogState(project: PmProject): PmProjectDetailDialogState {
  return {
    editing: false,
    form: { ...project },
    folderSize: undefined,
    submitting: false,
    error: null,
  };
}

export type PmProjectDetailDialogAction =
  | { type: 'set_editing'; editing: boolean }
  | { type: 'set_form'; form: PmProject }
  | { type: 'patch_form'; patch: Partial<PmProject> }
  | { type: 'reset_form'; project: PmProject }
  | { type: 'set_folder_size'; folderSize: number | null | undefined }
  | { type: 'set_submitting'; submitting: boolean }
  | { type: 'set_error'; error: string | null };

export function pmProjectDetailDialogReducer(
  state: PmProjectDetailDialogState,
  action: PmProjectDetailDialogAction,
): PmProjectDetailDialogState {
  switch (action.type) {
    case 'set_editing':
      return { ...state, editing: action.editing };
    case 'set_form':
      return { ...state, form: action.form };
    case 'patch_form':
      return { ...state, form: { ...state.form, ...action.patch } };
    case 'reset_form':
      return { ...state, editing: false, form: { ...action.project } };
    case 'set_folder_size':
      return { ...state, folderSize: action.folderSize };
    case 'set_submitting':
      return { ...state, submitting: action.submitting };
    case 'set_error':
      return { ...state, error: action.error };
    default:
      return state;
  }
}
