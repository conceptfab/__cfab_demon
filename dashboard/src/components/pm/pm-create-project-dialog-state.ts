import type { PmFolderTemplate } from '@/lib/pm-types';

export type PmCreateProjectFormState = {
  client: string;
  name: string;
  desc: string;
  budget: string;
  term: string;
  templateId: string;
  templates: PmFolderTemplate[];
  submitting: boolean;
  error: string | null;
  projectNumber: string;
  numberLoading: boolean;
  numberError: boolean;
};

export const initialPmCreateProjectFormState: PmCreateProjectFormState = {
  client: '',
  name: '',
  desc: '',
  budget: '',
  term: '',
  templateId: '',
  templates: [],
  submitting: false,
  error: null,
  projectNumber: '',
  numberLoading: true,
  numberError: false,
};

export type PmCreateProjectFormAction =
  | { type: 'set_client'; client: string }
  | { type: 'set_name'; name: string }
  | { type: 'set_desc'; desc: string }
  | { type: 'set_budget'; budget: string }
  | { type: 'set_term'; term: string }
  | { type: 'set_template_id'; templateId: string }
  | { type: 'set_templates'; templates: PmFolderTemplate[] }
  | { type: 'set_submitting'; submitting: boolean }
  | { type: 'set_error'; error: string | null }
  | { type: 'set_project_number'; projectNumber: string }
  | { type: 'set_number_loading'; numberLoading: boolean }
  | { type: 'set_number_error'; numberError: boolean };

export function pmCreateProjectFormReducer(
  state: PmCreateProjectFormState,
  action: PmCreateProjectFormAction,
): PmCreateProjectFormState {
  switch (action.type) {
    case 'set_client':
      return { ...state, client: action.client };
    case 'set_name':
      return { ...state, name: action.name };
    case 'set_desc':
      return { ...state, desc: action.desc };
    case 'set_budget':
      return { ...state, budget: action.budget };
    case 'set_term':
      return { ...state, term: action.term };
    case 'set_template_id':
      return { ...state, templateId: action.templateId };
    case 'set_templates':
      return { ...state, templates: action.templates };
    case 'set_submitting':
      return { ...state, submitting: action.submitting };
    case 'set_error':
      return { ...state, error: action.error };
    case 'set_project_number':
      return { ...state, projectNumber: action.projectNumber };
    case 'set_number_loading':
      return { ...state, numberLoading: action.numberLoading };
    case 'set_number_error':
      return { ...state, numberError: action.numberError };
    default:
      return state;
  }
}
