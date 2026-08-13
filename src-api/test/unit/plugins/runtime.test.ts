import { describe, expect, it } from 'vitest';

import {
  computeCapabilityGrants,
  createAppliedSnapshot,
  filterAllowedToolsByCapabilities,
} from '@/shared/plugins/runtime';
import { registerVideoPluginCapabilities } from '@/shared/video/plugins';

describe('plugin runtime capability gate', () => {
  it('grants trusted-tier capabilities and filters denied tools', () => {
    registerVideoPluginCapabilities();

    const grants = computeCapabilityGrants({
      requested: ['prompt:inject', 'research:web', 'network:youtube'],
      trustTier: 'bundled',
      manifestDigest: 'digest-a',
      lastReviewedDigest: null,
      signatureOk: true,
    });

    expect(grants).toMatchObject([
      { capability: 'prompt:inject', granted: true },
      { capability: 'research:web', granted: true },
      { capability: 'network:youtube', granted: false },
    ]);
    expect(
      filterAllowedToolsByCapabilities(
        ['WebSearch', 'mcp__broll__youtube', 'Read'],
        grants,
      ),
    ).toEqual(['WebSearch', 'Read']);
  });

  it('grants normal capabilities for local plugins after digest review', () => {
    registerVideoPluginCapabilities();

    const grants = computeCapabilityGrants({
      requested: ['research:web'],
      trustTier: 'local',
      manifestDigest: 'digest-a',
      lastReviewedDigest: 'digest-a',
      signatureOk: true,
    });

    expect(grants).toEqual([
      {
        capability: 'research:web',
        granted: true,
        reason: 'Manifest digest has been reviewed',
        requiresExplicitApproval: false,
      },
    ]);
  });

  it('freezes deterministic applied snapshots', () => {
    const snapshot = createAppliedSnapshot({
      domain: 'video',
      plugin: {
        id: 'social-reel',
        name: 'social-reel',
        version: '1.0.0',
        trustTier: 'bundled',
        manifestDigest: 'digest-a',
      },
      capabilities: ['research:web', 'prompt:inject'],
      payload: { stages: ['research', 'render'] },
      createdAt: '2026-06-16T00:00:00.000Z',
    });

    expect(snapshot.id).toHaveLength(64);
    expect(snapshot.capabilities).toEqual(['prompt:inject', 'research:web']);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.plugin)).toBe(true);
  });
});
