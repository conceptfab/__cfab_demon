import type { ImportSummary, ImportValidation } from '@/lib/db-types';

export type ImportPanelState = {
  validation: ImportValidation | null;
  summary: ImportSummary | null;
  importing: boolean;
  validating: boolean;
  dragActive: boolean;
  error: string | null;
};

export const initialImportPanelState: ImportPanelState = {
  validation: null,
  summary: null,
  importing: false,
  validating: false,
  dragActive: false,
  error: null,
};

export type ImportPanelAction =
  | { type: 'set_validation'; validation: ImportValidation | null }
  | { type: 'set_summary'; summary: ImportSummary | null }
  | { type: 'set_importing'; importing: boolean }
  | { type: 'set_validating'; validating: boolean }
  | { type: 'set_drag_active'; dragActive: boolean }
  | { type: 'set_error'; error: string | null }
  | { type: 'reset_flow' };

export function importPanelReducer(
  state: ImportPanelState,
  action: ImportPanelAction,
): ImportPanelState {
  switch (action.type) {
    case 'set_validation':
      return { ...state, validation: action.validation };
    case 'set_summary':
      return { ...state, summary: action.summary };
    case 'set_importing':
      return { ...state, importing: action.importing };
    case 'set_validating':
      return { ...state, validating: action.validating };
    case 'set_drag_active':
      return { ...state, dragActive: action.dragActive };
    case 'set_error':
      return { ...state, error: action.error };
    case 'reset_flow':
      return {
        ...state,
        validation: null,
        summary: null,
        error: null,
        dragActive: false,
      };
    default:
      return state;
  }
}
