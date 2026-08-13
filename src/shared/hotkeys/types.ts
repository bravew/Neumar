import type { ModeId } from '@/shared/modes/types';

export type KeyChord = string;
export type ShortcutScope =
  | 'global'
  | `mode:${ModeId}`
  | 'composer'
  | 'overlay';

export interface ShortcutDefinition {
  id: string;
  chord: KeyChord;
  scope: ShortcutScope;
  descriptionKey: string;
  group: string;
  handler: (event: KeyboardEvent) => void;
  ignoreInEditable?: boolean;
}
