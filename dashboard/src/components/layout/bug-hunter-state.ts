export type AttachedFile = {
  file: File;
  id: string;
};

export type BugHunterState = {
  title: string;
  description: string;
  attachments: AttachedFile[];
  isSending: boolean;
  isSent: boolean;
};

export const initialBugHunterState: BugHunterState = {
  title: '',
  description: '',
  attachments: [],
  isSending: false,
  isSent: false,
};

export type BugHunterAction =
  | { type: 'set_title'; title: string }
  | { type: 'set_description'; description: string }
  | { type: 'add_attachments'; attachments: AttachedFile[] }
  | { type: 'remove_attachment'; id: string }
  | { type: 'set_is_sending'; isSending: boolean }
  | { type: 'set_is_sent'; isSent: boolean }
  | { type: 'reset_form' };

export function bugHunterReducer(
  state: BugHunterState,
  action: BugHunterAction,
): BugHunterState {
  switch (action.type) {
    case 'set_title':
      return { ...state, title: action.title };
    case 'set_description':
      return { ...state, description: action.description };
    case 'add_attachments':
      return {
        ...state,
        attachments: [...state.attachments, ...action.attachments],
      };
    case 'remove_attachment':
      return {
        ...state,
        attachments: state.attachments.filter((attachment) => attachment.id !== action.id),
      };
    case 'set_is_sending':
      return { ...state, isSending: action.isSending };
    case 'set_is_sent':
      return { ...state, isSent: action.isSent };
    case 'reset_form':
      return initialBugHunterState;
    default:
      return state;
  }
}
