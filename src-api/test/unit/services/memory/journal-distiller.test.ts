import { describe, expect, it, vi, beforeEach } from 'vitest';

import { distillJournal } from '@/shared/services/memory/journal-distiller';

// Mock all dependencies
vi.mock('@/shared/services/memory/session-journal', () => ({
  getJournalEntries: vi.fn(),
  clearJournal: vi.fn().mockReturnValue(0),
}));

vi.mock('@/shared/services/memory/retriever', () => ({
  searchMemories: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/shared/services/memory/store', () => ({
  createMemory: vi.fn().mockReturnValue({ id: 'new-mem' }),
  storeEmbedding: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/services/memory/config', () => ({
  getMemoryConfig: vi.fn().mockReturnValue({
    embeddingProvider: 'local',
    embeddingApiKey: '',
    embeddingModel: '',
  }),
  getEmbedOptions: vi.fn().mockReturnValue({
    provider: 'local',
  }),
}));

import {
  getJournalEntries,
  clearJournal,
} from '@/shared/services/memory/session-journal';
import { createMemory } from '@/shared/services/memory/store';

const mockGetEntries = vi.mocked(getJournalEntries);
const mockClearJournal = vi.mocked(clearJournal);
const mockCreateMemory = vi.mocked(createMemory);

describe('distillJournal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips distillation when fewer than 3 entries', async () => {
    mockGetEntries.mockReturnValue([
      { id: '1', sessionId: 's1', content: 'Entry 1', createdAt: '2026-01-01' },
    ]);

    const callLLM = vi.fn();
    const result = await distillJournal('s1', callLLM);

    expect(result).toBe(0);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('extracts memories from journal entries via LLM', async () => {
    mockGetEntries.mockReturnValue([
      {
        id: '1',
        sessionId: 's1',
        content: 'User prefers dark mode',
        createdAt: '2026-01-01T10:00:00Z',
      },
      {
        id: '2',
        sessionId: 's1',
        content: 'Decided to use PostgreSQL',
        createdAt: '2026-01-01T11:00:00Z',
      },
      {
        id: '3',
        sessionId: 's1',
        content: 'Working on auth system',
        createdAt: '2026-01-01T12:00:00Z',
      },
    ]);

    const callLLM = vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          content: 'User prefers dark mode',
          category: 'preference',
          importance: 0.8,
        },
        {
          content: 'Team chose PostgreSQL for persistence',
          category: 'decision',
          importance: 0.7,
        },
      ]),
    );

    const result = await distillJournal('s1', callLLM);

    expect(result).toBe(2);
    expect(callLLM).toHaveBeenCalledOnce();
    expect(mockCreateMemory).toHaveBeenCalledTimes(2);
    expect(mockClearJournal).toHaveBeenCalledWith('s1');
  });

  it('returns 0 when LLM returns no JSON', async () => {
    mockGetEntries.mockReturnValue([
      { id: '1', sessionId: 's1', content: 'A', createdAt: '2026-01-01' },
      { id: '2', sessionId: 's1', content: 'B', createdAt: '2026-01-01' },
      { id: '3', sessionId: 's1', content: 'C', createdAt: '2026-01-01' },
    ]);

    const callLLM = vi
      .fn()
      .mockResolvedValue('I could not extract anything meaningful.');
    const result = await distillJournal('s1', callLLM);

    expect(result).toBe(0);
    expect(mockCreateMemory).not.toHaveBeenCalled();
  });

  it('returns 0 when LLM call throws', async () => {
    mockGetEntries.mockReturnValue([
      { id: '1', sessionId: 's1', content: 'A', createdAt: '2026-01-01' },
      { id: '2', sessionId: 's1', content: 'B', createdAt: '2026-01-01' },
      { id: '3', sessionId: 's1', content: 'C', createdAt: '2026-01-01' },
    ]);

    const callLLM = vi.fn().mockRejectedValue(new Error('API error'));
    const result = await distillJournal('s1', callLLM);

    expect(result).toBe(0);
  });

  it('skips extractions with short content', async () => {
    mockGetEntries.mockReturnValue([
      { id: '1', sessionId: 's1', content: 'A', createdAt: '2026-01-01' },
      { id: '2', sessionId: 's1', content: 'B', createdAt: '2026-01-01' },
      { id: '3', sessionId: 's1', content: 'C', createdAt: '2026-01-01' },
    ]);

    const callLLM = vi.fn().mockResolvedValue(
      JSON.stringify([
        { content: 'Hi', category: 'fact', importance: 0.5 }, // too short
        {
          content: 'User works on the payment system',
          category: 'fact',
          importance: 0.6,
        },
      ]),
    );

    const result = await distillJournal('s1', callLLM);

    expect(result).toBe(1);
    expect(mockCreateMemory).toHaveBeenCalledOnce();
  });

  it('does not clear journal when clearAfter=false', async () => {
    mockGetEntries.mockReturnValue([
      { id: '1', sessionId: 's1', content: 'A', createdAt: '2026-01-01' },
      { id: '2', sessionId: 's1', content: 'B', createdAt: '2026-01-01' },
      { id: '3', sessionId: 's1', content: 'C', createdAt: '2026-01-01' },
    ]);

    const callLLM = vi.fn().mockResolvedValue(
      JSON.stringify([
        {
          content: 'Valuable insight extracted',
          category: 'fact',
          importance: 0.7,
        },
      ]),
    );

    await distillJournal('s1', callLLM, false);
    expect(mockClearJournal).not.toHaveBeenCalled();
  });
});
