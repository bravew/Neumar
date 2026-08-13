import { describe, expect, it, vi } from 'vitest';

import { jsonReq } from '../../helpers/request-factory';

// ---- Mock heavy dependencies ----

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockGetAgentProfile = vi.fn();
const mockGetAgentSoul = vi.fn();
const mockUpdateAgentProfileSoul = vi.fn();
const mockGetSoulCorrections = vi.fn().mockReturnValue([]);
const mockGetSoulLearnings = vi.fn().mockReturnValue([]);
const mockClearSoulCorrections = vi.fn();
const mockUpdateAgentProfile = vi.fn();

vi.mock('@/shared/db/operations', () => ({
  getAgentProfile: (...args: unknown[]) => mockGetAgentProfile(...args),
  getAgentSoul: (...args: unknown[]) => mockGetAgentSoul(...args),
  updateAgentProfileSoul: (...args: unknown[]) =>
    mockUpdateAgentProfileSoul(...args),
  getSoulCorrections: (...args: unknown[]) => mockGetSoulCorrections(...args),
  getSoulLearnings: (...args: unknown[]) => mockGetSoulLearnings(...args),
  clearSoulCorrections: (...args: unknown[]) =>
    mockClearSoulCorrections(...args),
  updateAgentProfile: (...args: unknown[]) => mockUpdateAgentProfile(...args),
}));

const mockGetAllTemplates = vi.fn().mockReturnValue([
  {
    id: 'default',
    name: { 'en-US': 'Default Agent' },
    description: { 'en-US': 'A general-purpose assistant' },
    icon: '🤖',
    quickstart: true,
    default_skills: [],
    souls: {
      'en-US': {
        schema_version: '1.0',
        identity: {
          role: 'general assistant',
          core_values: ['helpfulness'],
        },
        voice: { tone: 'friendly', style_rules: ['be clear'] },
        cognition: { reasoning_style: 'analytical' },
        boundaries: { red_lines: ['no harm'] },
      },
    },
  },
]);

const mockGetTemplate = vi.fn();

vi.mock('@/core/agent/soul-templates', () => ({
  getAllTemplates: (...args: unknown[]) => mockGetAllTemplates(...args),
  getTemplate: (...args: unknown[]) => mockGetTemplate(...args),
}));

const mockRenderSoul = vi.fn().mockReturnValue('Rendered system prompt');

vi.mock('@/core/agent/soul-renderer', () => ({
  renderSoul: (...args: unknown[]) => mockRenderSoul(...args),
}));

vi.mock('@/shared/services/memory/store', () => ({
  listMemories: vi.fn().mockReturnValue([]),
}));

vi.mock('@/shared/utils/llm-caller', () => ({
  buildLightweightLLMCaller: vi.fn().mockReturnValue(vi.fn()),
}));

// ============================================================================
// GET /templates
// ============================================================================

describe('Soul API', () => {
  describe('GET /templates', () => {
    it('returns template summaries', async () => {
      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request('/templates');
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // GET /templates/:id
  // ============================================================================

  describe('GET /templates/:id', () => {
    it('returns a template by id', async () => {
      mockGetTemplate.mockReturnValueOnce({
        id: 'default',
        name: { 'en-US': 'Default Agent' },
        description: { 'en-US': 'A general-purpose assistant' },
        souls: { 'en-US': {} },
      });

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request('/templates/default');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('id', 'default');
    });

    it('returns 404 for unknown template', async () => {
      mockGetTemplate.mockReturnValueOnce(null);

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request('/templates/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  // ============================================================================
  // GET /agent-profiles/:id
  // ============================================================================

  describe('GET /agent-profiles/:id', () => {
    it('returns soul data for an existing profile', async () => {
      mockGetAgentProfile.mockReturnValueOnce({
        id: 'prof-1',
        name: 'Test Agent',
        soul_version: 1,
        soul_origin: 'user',
        soul: JSON.stringify({ identity: { role: 'tester' } }),
      });
      mockGetAgentSoul.mockReturnValueOnce({
        identity: { role: 'tester' },
      });

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request('/agent-profiles/prof-1');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('soul');
      expect(body).toHaveProperty('soul_version');
      expect(body).toHaveProperty('soul_origin');
    });

    it('returns 404 for unknown profile', async () => {
      mockGetAgentProfile.mockReturnValueOnce(null);

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request('/agent-profiles/no-such');
      expect(res.status).toBe(404);
    });
  });

  // ============================================================================
  // PUT /agent-profiles/:id
  // ============================================================================

  describe('PUT /agent-profiles/:id', () => {
    it('updates soul for a profile', async () => {
      const soulPayload = {
        schema_version: '1.0' as const,
        identity: { role: 'new role', core_values: ['honesty'] },
        voice: { tone: 'calm', style_rules: ['be concise'] },
        cognition: { reasoning_style: 'deductive' },
        boundaries: { red_lines: ['no harm'] },
      };
      const updatedProfile = {
        id: 'prof-1',
        soul: JSON.stringify(soulPayload),
        soul_version: 2,
        soul_origin: 'user',
      };
      mockUpdateAgentProfileSoul.mockReturnValueOnce(updatedProfile);

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request(
        jsonReq('/agent-profiles/prof-1', { soul: soulPayload }, 'PUT'),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('soul_version', 2);
    });
  });

  // ============================================================================
  // POST /agent-profiles/:id/apply
  // ============================================================================

  describe('POST /agent-profiles/:id/apply', () => {
    it('applies a template to a profile', async () => {
      mockGetAgentProfile.mockReturnValueOnce({
        id: 'prof-1',
        name: 'My Agent',
      });
      mockGetTemplate.mockReturnValueOnce({
        id: 'default',
        name: { 'en-US': 'Default' },
        description: { 'en-US': 'Default agent' },
        default_skills: ['web-search'],
        souls: {
          'en-US': {
            schema_version: '1.0',
            identity: { role: 'assistant', core_values: ['helpful'] },
            voice: { tone: 'warm', style_rules: ['clear'] },
          },
        },
      });
      mockUpdateAgentProfileSoul.mockReturnValueOnce({
        id: 'prof-1',
        soul: JSON.stringify({
          schema_version: '1.0',
          identity: { role: 'assistant', core_values: ['helpful'] },
          voice: { tone: 'warm', style_rules: ['clear'] },
        }),
        soul_version: 1,
        soul_origin: 'predefined',
      });

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request(
        jsonReq('/agent-profiles/prof-1/apply', {
          template_id: 'default',
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('soul_origin', 'predefined');
    });

    it('returns 404 when profile does not exist', async () => {
      mockGetAgentProfile.mockReturnValueOnce(null);

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request(
        jsonReq('/agent-profiles/no-such/apply', {
          template_id: 'default',
        }),
      );
      expect(res.status).toBe(404);
    });

    it('returns 404 when template does not exist', async () => {
      mockGetAgentProfile.mockReturnValueOnce({ id: 'prof-1', name: 'X' });
      mockGetTemplate.mockReturnValueOnce(null);

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request(
        jsonReq('/agent-profiles/prof-1/apply', {
          template_id: 'nonexistent',
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  // ============================================================================
  // GET /agent-profiles/:id/corrections
  // ============================================================================

  describe('GET /agent-profiles/:id/corrections', () => {
    it('returns corrections for a profile', async () => {
      mockGetAgentProfile.mockReturnValueOnce({ id: 'prof-1' });
      mockGetSoulCorrections.mockReturnValueOnce([
        { id: 'c1', correction: 'be nicer' },
      ]);

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request(
        '/agent-profiles/prof-1/corrections',
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(1);
    });

    it('returns 404 when profile not found', async () => {
      mockGetAgentProfile.mockReturnValueOnce(null);

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request(
        '/agent-profiles/no-such/corrections',
      );
      expect(res.status).toBe(404);
    });
  });

  // ============================================================================
  // GET /agent-profiles/:id/learnings
  // ============================================================================

  describe('GET /agent-profiles/:id/learnings', () => {
    it('returns learnings for a profile', async () => {
      mockGetAgentProfile.mockReturnValueOnce({ id: 'prof-1' });
      mockGetSoulLearnings.mockReturnValueOnce([
        { id: 'l1', learning: 'user prefers short answers' },
      ]);

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request('/agent-profiles/prof-1/learnings');
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(1);
    });

    it('returns 404 when profile not found', async () => {
      mockGetAgentProfile.mockReturnValueOnce(null);

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request('/agent-profiles/no-such/learnings');
      expect(res.status).toBe(404);
    });
  });

  // ============================================================================
  // GET /agent-profiles/:id/export
  // ============================================================================

  describe('GET /agent-profiles/:id/export', () => {
    it('exports soul data for a profile', async () => {
      mockGetAgentProfile.mockReturnValueOnce({
        id: 'prof-1',
        name: 'My Agent',
        soul: JSON.stringify({
          schema_version: '1.0',
          soul_language: 'en-US',
          identity: { role: 'tester' },
        }),
        soul_version: 3,
        soul_origin: 'user',
      });
      mockGetSoulCorrections.mockReturnValueOnce([]);
      mockGetSoulLearnings.mockReturnValueOnce([]);

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request('/agent-profiles/prof-1/export');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('soul_spec_version', '1.0');
      expect(body).toHaveProperty('soul');
      expect(body).toHaveProperty('exported_at');
    });

    it('returns 404 when profile not found', async () => {
      mockGetAgentProfile.mockReturnValueOnce(null);

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request('/agent-profiles/no-such/export');
      expect(res.status).toBe(404);
    });

    it('returns 400 when profile has no soul', async () => {
      mockGetAgentProfile.mockReturnValueOnce({
        id: 'prof-1',
        name: 'Empty',
        soul: null,
        soul_version: 0,
      });

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request('/agent-profiles/prof-1/export');
      expect(res.status).toBe(400);
    });
  });

  // ============================================================================
  // GET /agent-profiles/:id/preview
  // ============================================================================

  describe('GET /agent-profiles/:id/preview', () => {
    it('returns rendered prompt for a profile', async () => {
      mockGetAgentSoul.mockReturnValueOnce({
        identity: { role: 'tester' },
      });
      mockGetSoulCorrections.mockReturnValueOnce([]);
      mockGetSoulLearnings.mockReturnValueOnce([]);
      mockRenderSoul.mockReturnValueOnce('You are a tester.');

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request('/agent-profiles/prof-1/preview');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('rendered_prompt');
      expect(body).toHaveProperty('char_count');
      expect(typeof body.char_count).toBe('number');
    });

    it('returns empty prompt when profile has no soul', async () => {
      mockGetAgentSoul.mockReturnValueOnce(null);

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request(
        '/agent-profiles/prof-empty/preview',
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('rendered_prompt', '');
      expect(body).toHaveProperty('char_count', 0);
    });
  });

  // ============================================================================
  // DELETE /agent-profiles/:id/corrections
  // ============================================================================

  describe('DELETE /agent-profiles/:id/corrections', () => {
    it('clears corrections for a profile', async () => {
      mockGetAgentProfile.mockReturnValueOnce({ id: 'prof-1' });

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request(
        jsonReq('/agent-profiles/prof-1/corrections', null, 'DELETE'),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
    });

    it('returns 404 when profile not found', async () => {
      mockGetAgentProfile.mockReturnValueOnce(null);

      const { soulRoutes } = await import('@/app/api/soul');
      const res = await soulRoutes.request(
        jsonReq('/agent-profiles/no-such/corrections', null, 'DELETE'),
      );
      expect(res.status).toBe(404);
    });
  });
});
