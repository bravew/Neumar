import { describe, expect, it, vi } from 'vitest';

import { jsonReq } from '../../helpers/request-factory';

// ── Mock data ──

const mockMemory = {
  id: 'mem-00000000-0000-0000-0000-000000000001',
  content: 'TypeScript is preferred for this project',
  category: 'preference',
  importance: 0.8,
  source: 'api',
  sessionId: null,
  accessCount: 0,
  lastAccessedAt: null,
  hasEmbedding: false,
  createdAt: '2026-04-06T00:00:00Z',
  updatedAt: '2026-04-06T00:00:00Z',
  memoryType: 'semantic',
  scopeType: 'global',
  scopeId: null,
  decayRate: 0.023,
  lastAccessedStrength: 1.0,
  confidence: 0.7,
  validFrom: null,
  validUntil: null,
  parentId: null,
  consolidatedFrom: null,
  lifecycleStatus: 'active',
  language: null,
  metadata: null,
  visibility: 'private',
};

const mockConfig = {
  enabled: true,
  autoCapture: true,
  autoRecall: true,
  embeddingProvider: 'local',
  embeddingApiKey: '',
  embeddingModel: '',
  maxMemories: 10000,
  captureMaxChars: 500,
  recallLimit: 5,
  recallThreshold: 0.3,
  embeddingDim: 768,
  llmCapture: false,
  llmCaptureInterval: 5,
  sessionIndexing: true,
  decayEnabled: false,
  consolidationEnabled: false,
  entityExtractionEnabled: false,
  captureGuardLevel: 'standard',
  llmRerankEnabled: false,
  llmRerankModel: 'haiku',
  maxRecallTokens: 1500,
  journalMode: false,
};

const mockStats = {
  total: 42,
  byCategory: { preference: 10, fact: 20, other: 12 },
  withEmbeddings: 30,
  oldestMemory: '2025-01-01T00:00:00Z',
  newestMemory: '2026-04-06T00:00:00Z',
  byType: { semantic: 30, episodic: 12 },
  byScope: { global: 42 },
  byLifecycle: { active: 40, stale: 2 },
};

const mockEntity = {
  id: 'ent-1',
  name: 'TypeScript',
  entityType: 'technology',
  summary: null,
  firstSeenAt: '2026-04-06T00:00:00Z',
  lastSeenAt: '2026-04-06T00:00:00Z',
  mentionCount: 5,
  metadata: null,
};

// ── Mocks ──

const mockListMemories = vi.fn().mockReturnValue([mockMemory]);
const mockGetMemoryCount = vi.fn().mockReturnValue(42);
const mockGetMemoryStats = vi.fn().mockReturnValue(mockStats);
const mockGetMemoryConfig = vi.fn().mockReturnValue(mockConfig);
const mockSaveMemoryConfig = vi.fn();
const mockCreateMemory = vi.fn().mockReturnValue(mockMemory);
const mockGetMemory = vi
  .fn()
  .mockImplementation((id: string) =>
    id === mockMemory.id ? mockMemory : null,
  );
const mockUpdateMemory = vi
  .fn()
  .mockImplementation((id: string) =>
    id === mockMemory.id ? { ...mockMemory, content: 'updated' } : null,
  );
const mockDeleteMemory = vi
  .fn()
  .mockImplementation((id: string) => id === mockMemory.id);
const mockSearchMemories = vi
  .fn()
  .mockResolvedValue([{ memory: mockMemory, score: 0.95 }]);
const mockPinMemory = vi
  .fn()
  .mockImplementation((id: string) =>
    id === mockMemory.id ? { ...mockMemory, memoryType: 'pinned' } : null,
  );
const mockUnpinMemory = vi
  .fn()
  .mockImplementation((id: string) =>
    id === mockMemory.id ? { ...mockMemory, memoryType: 'semantic' } : null,
  );
const mockStoreEmbedding = vi.fn().mockResolvedValue(undefined);
const mockDeleteEmbedding = vi.fn().mockResolvedValue(undefined);
const mockGetEmbedOptions = vi
  .fn()
  .mockReturnValue({ provider: 'local', apiKey: undefined, model: undefined });
const mockGetLocalModelStatus = vi
  .fn()
  .mockReturnValue({ loaded: false, modelName: 'all-MiniLM-L6-v2' });
const mockTriggerLocalModelDownload = vi.fn();
const mockListEntities = vi.fn().mockReturnValue([mockEntity]);
const mockGetEntityGraph = vi
  .fn()
  .mockReturnValue({ entities: [mockEntity], edges: [] });
const mockFindEntityByName = vi.fn().mockReturnValue(null);

vi.mock('@/shared/services/memory', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listMemories: (...args: unknown[]) => mockListMemories(...args),
    getMemoryCount: (...args: unknown[]) => mockGetMemoryCount(...args),
    getMemoryStats: (...args: unknown[]) => mockGetMemoryStats(...args),
    getMemoryConfig: (...args: unknown[]) => mockGetMemoryConfig(...args),
    saveMemoryConfig: (...args: unknown[]) => mockSaveMemoryConfig(...args),
    createMemory: (...args: unknown[]) => mockCreateMemory(...args),
    getMemory: (...args: unknown[]) => mockGetMemory(...args),
    updateMemory: (...args: unknown[]) => mockUpdateMemory(...args),
    deleteMemory: (...args: unknown[]) => mockDeleteMemory(...args),
    searchMemories: (...args: unknown[]) => mockSearchMemories(...args),
    pinMemory: (...args: unknown[]) => mockPinMemory(...args),
    unpinMemory: (...args: unknown[]) => mockUnpinMemory(...args),
    storeEmbedding: (...args: unknown[]) => mockStoreEmbedding(...args),
    deleteEmbedding: (...args: unknown[]) => mockDeleteEmbedding(...args),
    getEmbedOptions: (...args: unknown[]) => mockGetEmbedOptions(...args),
    getLocalModelStatus: (...args: unknown[]) =>
      mockGetLocalModelStatus(...args),
    triggerLocalModelDownload: (...args: unknown[]) =>
      mockTriggerLocalModelDownload(...args),
    listEntities: (...args: unknown[]) => mockListEntities(...args),
    getEntityGraph: (...args: unknown[]) => mockGetEntityGraph(...args),
    findEntityByName: (...args: unknown[]) => mockFindEntityByName(...args),
  };
});

// Mock the dynamic imports used inside the route handlers
vi.mock('@/shared/services/memory/store', () => ({
  getReindexProgress: vi.fn().mockReturnValue(null),
  getCacheStats: vi
    .fn()
    .mockReturnValue({ total: 100, models: { 'all-MiniLM-L6-v2': 100 } }),
  reindexMemories: vi.fn().mockResolvedValue({
    total: 10,
    processed: 10,
    cached: 5,
    errors: 0,
    status: 'completed',
  }),
}));

vi.mock('@/shared/db', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue({ count: 0 }),
      run: vi.fn().mockReturnValue({ changes: 1 }),
    }),
    transaction: vi.fn().mockImplementation((fn: () => unknown) => fn),
    exec: vi.fn(),
  };
  return { getDatabase: () => mockDb };
});

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Tests ──

describe('Memory API', () => {
  // ── List & Stats ──

  describe('GET / — list memories', () => {
    it('returns memories array and total', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request('/');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('memories');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.memories)).toBe(true);
    });

    it('passes query params to listMemories', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      await memoryRoutes.request(
        '/?limit=10&offset=5&search=foo&category=fact',
      );
      expect(mockListMemories).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          offset: 5,
          search: 'foo',
          category: 'fact',
        }),
      );
    });
  });

  describe('GET /stats', () => {
    it('returns memory stats', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request('/stats');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('total', 42);
      expect(body).toHaveProperty('withEmbeddings');
    });
  });

  // ── Config ──

  describe('GET /config', () => {
    it('returns config with redacted API key', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request('/config');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('enabled');
      // API key should be redacted (empty string when empty)
      expect(body.embeddingApiKey).toBe('');
    });
  });

  describe('POST /config', () => {
    it('saves config and returns success', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(
        jsonReq('/config', { enabled: false, autoCapture: false }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(mockSaveMemoryConfig).toHaveBeenCalled();
    });

    it('rejects invalid config fields', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(
        jsonReq('/config', { embeddingProvider: 'invalid-provider' }),
      );
      expect(res.status).toBe(400);
    });
  });

  // ── Create ──

  describe('POST / — create memory', () => {
    it('creates a memory and returns 201', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(
        jsonReq('/', {
          content: 'Remember this fact',
          category: 'fact',
          importance: 0.9,
        }),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('id');
      expect(mockCreateMemory).toHaveBeenCalled();
    });

    it('rejects empty content', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(jsonReq('/', { content: '' }));
      expect(res.status).toBe(400);
    });
  });

  // ── Search ──

  describe('POST /search', () => {
    it('returns search results', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(
        jsonReq('/search', { query: 'TypeScript' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('results');
      expect(Array.isArray(body.results)).toBe(true);
    });

    it('rejects empty query', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(jsonReq('/search', { query: '' }));
      expect(res.status).toBe(400);
    });
  });

  // ── Single memory CRUD ──

  describe('GET /:id', () => {
    it('returns a memory by id', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(`/${mockMemory.id}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('id', mockMemory.id);
    });

    it('returns 404 for unknown id', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request('/nonexistent-id');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /:id', () => {
    it('updates a memory', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(
        jsonReq(`/${mockMemory.id}`, { content: 'updated content' }, 'PUT'),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('content', 'updated');
    });

    it('returns 404 for unknown id', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(
        jsonReq('/nonexistent-id', { content: 'nope' }, 'PUT'),
      );
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:id', () => {
    it('deletes a memory', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(
        new Request(`http://localhost/${mockMemory.id}`, { method: 'DELETE' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
    });

    it('returns 404 for unknown id', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(
        new Request('http://localhost/nonexistent-id', { method: 'DELETE' }),
      );
      expect(res.status).toBe(404);
    });
  });

  // ── Pin / Unpin ──

  describe('POST /:id/pin', () => {
    it('pins a memory', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(
        jsonReq(`/${mockMemory.id}/pin`, null),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('memoryType', 'pinned');
    });

    it('returns 404 for unknown id', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(
        jsonReq('/nonexistent-id/pin', null),
      );
      expect(res.status).toBe(404);
    });
  });

  describe('POST /:id/unpin', () => {
    it('unpins a memory', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(
        jsonReq(`/${mockMemory.id}/unpin`, null),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('memoryType', 'semantic');
    });
  });

  // ── Batch delete ──

  describe('POST /batch-delete', () => {
    it('deletes multiple memories', async () => {
      mockDeleteMemory.mockReturnValueOnce(true);
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(
        jsonReq('/batch-delete', {
          ids: ['a0000000-0000-4000-8000-000000000001'],
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('deleted');
      expect(body).toHaveProperty('total');
    });

    it('rejects empty ids array', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(
        jsonReq('/batch-delete', { ids: [] }),
      );
      expect(res.status).toBe(400);
    });
  });

  // ── Export / Import ──

  describe('GET /export', () => {
    it('returns export payload', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request('/export');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('version', 1);
      expect(body).toHaveProperty('memories');
      expect(body).toHaveProperty('memoryCount');
    });
  });

  describe('POST /import', () => {
    it('imports memories and returns count', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(
        jsonReq('/import', {
          memories: [{ content: 'imported fact', category: 'fact' }],
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('imported');
      expect(body).toHaveProperty('success', true);
    });
  });

  // ── Reindex ──

  describe('POST /reindex', () => {
    it('starts reindex and returns 202', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request(jsonReq('/reindex', null));
      expect(res.status).toBe(202);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('status', 'started');
    });
  });

  describe('GET /reindex/status', () => {
    it('returns idle when no reindex running', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request('/reindex/status');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('status', 'idle');
    });
  });

  // ── Cache & Model ──

  describe('GET /cache/stats', () => {
    it('returns cache statistics', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request('/cache/stats');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('models');
    });
  });

  describe('GET /model/status', () => {
    it('returns local model status', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request('/model/status');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('loaded');
    });
  });

  // ── Entities ──

  describe('GET /entities', () => {
    it('returns entities list', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request('/entities');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('entities');
      expect(Array.isArray(body.entities)).toBe(true);
    });
  });

  // ── Analytics ──

  describe('GET /analytics', () => {
    it('returns analytics with entity and consolidation info', async () => {
      const { memoryRoutes } = await import('@/app/api/memory');
      const res = await memoryRoutes.request('/analytics');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('entities');
      expect(body).toHaveProperty('consolidation');
    });
  });
});
