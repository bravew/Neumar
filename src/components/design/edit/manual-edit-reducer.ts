import type {
  InspectStyleProp,
  NeumaTargetPayload,
} from '@/components/artifacts/live/iframe-sandbox';
import type {
  AppliedManualEditPatch,
  ManualEditPatchJournalEntry,
} from '@/shared/types/design-mode';

export const MANUAL_EDIT_STYLE_PROPS: InspectStyleProp[] = [
  'color',
  'backgroundColor',
  'fontSize',
  'padding',
  'margin',
  'borderRadius',
  'border',
];

export interface ManualEditDraft {
  property: InspectStyleProp;
  value: string;
}

export interface ManualEditState {
  selectedElementId: string | null;
  draft: ManualEditDraft;
  historyOpen: boolean;
  entries: ManualEditPatchJournalEntry[];
}

export type ManualEditAction =
  | { type: 'pointerSelected'; target: NeumaTargetPayload }
  | { type: 'propertyChanged'; property: InspectStyleProp; value: string }
  | { type: 'editApplied'; entry: ManualEditPatchJournalEntry }
  | { type: 'editReverted'; entry: ManualEditPatchJournalEntry }
  | { type: 'editReapplied'; entry: ManualEditPatchJournalEntry }
  | { type: 'historyOpened' }
  | { type: 'historyClosed' }
  | { type: 'historyLoaded'; entries: ManualEditPatchJournalEntry[] };

export const initialManualEditState: ManualEditState = {
  selectedElementId: null,
  draft: { property: 'color', value: '' },
  historyOpen: false,
  entries: [],
};

export function manualEditReducer(
  state: ManualEditState,
  action: ManualEditAction,
): ManualEditState {
  switch (action.type) {
    case 'pointerSelected': {
      const property = state.draft.property;
      return {
        ...state,
        selectedElementId: action.target.id,
        draft: {
          property,
          value: action.target.styles?.[property] ?? '',
        },
      };
    }
    case 'propertyChanged':
      return {
        ...state,
        draft: { property: action.property, value: action.value },
      };
    case 'historyLoaded':
      return { ...state, entries: action.entries };
    case 'editApplied':
    case 'editReapplied':
    case 'editReverted':
      return { ...state, entries: [action.entry, ...state.entries] };
    case 'historyOpened':
      return { ...state, historyOpen: true };
    case 'historyClosed':
      return { ...state, historyOpen: false };
    default:
      action satisfies never;
      return state;
  }
}

export function isAppliedManualEditPatch(
  entry: ManualEditPatchJournalEntry,
): entry is AppliedManualEditPatch {
  return 'appliedAt' in entry && 'patch' in entry;
}
