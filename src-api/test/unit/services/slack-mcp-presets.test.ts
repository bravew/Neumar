import { describe, expect, it } from 'vitest';

import {
  getMcpPreset,
  listMcpPresets,
} from '@/shared/channels/slack/home/mcp-presets';

describe('mcp presets', () => {
  it('lists at least github + notion + linear + atlassian', () => {
    const keys = listMcpPresets().map((p) => p.key);
    expect(keys).toEqual(
      expect.arrayContaining(['github', 'notion', 'linear', 'atlassian']),
    );
  });

  it('every preset has a verified-shape https URL and a token-mint help URL', () => {
    for (const p of listMcpPresets()) {
      expect(p.url).toMatch(/^https:\/\//);
      expect(p.tokenUrl).toMatch(/^https:\/\//);
      expect(p.iconUrl).toMatch(/^https:\/\//);
      expect(p.displayName.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(0);
    }
  });

  it('returns null for unknown keys', () => {
    expect(getMcpPreset('nope')).toBeNull();
  });

  it('round-trips a known key', () => {
    const gh = getMcpPreset('github');
    expect(gh).not.toBeNull();
    expect(gh!.url).toContain('githubcopilot');
  });

  it('preset keys are unique', () => {
    const keys = listMcpPresets().map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
