import { describe, expect, it } from 'vitest';

import { parseCursorAgentModels } from '@/shared/agent-runtimes';

// Real `cursor-agent models` output shape (2026.07 CLI, authenticated).
const REAL_OUTPUT = `Available models

auto - Auto (default)
gpt-5.3-codex-low - Codex 5.3 Low
gpt-5.3-codex - Codex 5.3
gpt-5.2 - GPT-5.2
sonnet-4-thinking - Sonnet 4 Thinking
`;

describe('parseCursorAgentModels', () => {
  it('parses `<id> - <Label>` lines and skips the header', () => {
    const models = parseCursorAgentModels(REAL_OUTPUT);
    expect(models).not.toBeNull();
    expect(models![0]).toEqual({
      id: 'default',
      label: 'Default (CLI config)',
    });
    expect(models).toContainEqual({ id: 'auto', label: 'Auto (default)' });
    expect(models).toContainEqual({ id: 'gpt-5.3-codex', label: 'Codex 5.3' });
    expect(models).toContainEqual({
      id: 'sonnet-4-thinking',
      label: 'Sonnet 4 Thinking',
    });
    // The header must never become a model id.
    expect(models!.some((m) => /available/i.test(m.id))).toBe(false);
    // Ids must be bare — no ` - Label` remnants.
    expect(models!.every((m) => !m.id.includes(' '))).toBe(true);
  });

  it('parses bare-id lines without labels', () => {
    const models = parseCursorAgentModels('auto\nsonnet-4\n');
    expect(models).toContainEqual({ id: 'auto', label: 'auto' });
    expect(models).toContainEqual({ id: 'sonnet-4', label: 'sonnet-4' });
  });

  it('returns null when nothing parseable remains', () => {
    expect(parseCursorAgentModels('')).toBeNull();
    expect(parseCursorAgentModels('Available models\n')).toBeNull();
  });
});
