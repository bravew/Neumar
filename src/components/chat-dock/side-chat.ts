export type SideChatKind = 'library' | 'artifact' | 'automation';

export interface SideChatItem {
  kind: SideChatKind;
  name: string;
}

export interface SideChatDraft {
  title: string;
  payload: string;
}

export function sideChatDraft(item: SideChatItem): SideChatDraft {
  return {
    title: item.name,
    payload: `Looking at: ${item.kind} › ${item.name}`,
  };
}

export function isSideChatPrompt(prompt: string | null | undefined): boolean {
  return (prompt ?? '').startsWith('Looking at:');
}
