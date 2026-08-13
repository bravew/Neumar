import { createMemory, deleteMemory, getMemory, listMemories } from './store';
import type { Memory, MemoryCategory } from './types';

export interface PromoteMemoryInput {
  title: string;
  memoryIds?: string[];
  category?: MemoryCategory;
  limit?: number;
}

export function promoteMemories(input: PromoteMemoryInput): Memory {
  const selected =
    input.memoryIds && input.memoryIds.length > 0
      ? input.memoryIds
          .map((id) => getMemory(id))
          .filter((memory): memory is Memory => Boolean(memory))
      : listMemories({
          category: input.category,
          limit: input.limit ?? 10,
          sortBy: 'importance',
          sortOrder: 'desc',
        });

  if (selected.length === 0) {
    throw new Error('No memories matched the promotion request');
  }

  const content = [
    `# ${input.title}`,
    '',
    ...selected.map((memory) => `- ${memory.content.trim()}`),
  ].join('\n');

  const promoted = createMemory({
    content,
    category: input.category ?? selected[0]!.category,
    importance: Math.max(...selected.map((memory) => memory.importance), 0.7),
    source: 'api',
    memoryType: 'semantic',
    scopeType: selected[0]!.scopeType,
    scopeId: selected[0]!.scopeId ?? undefined,
    metadata: {
      promoted: true,
      promotedTitle: input.title,
      promotedFrom: selected.map((memory) => memory.id),
    },
  });

  for (const memory of selected) {
    if (memory.id !== promoted.id) deleteMemory(memory.id);
  }

  return promoted;
}
