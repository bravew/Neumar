import '../setup';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AssetRegistry, composeCatalogPreamble } from '@/shared/assets';
import { setSetting } from '@/shared/db/operations';
import { buildVideoSessionPrompt } from '@/shared/video/session-prompt';
import type { VideoProject } from '@/shared/video/types';

import type { EvalCase } from '../types';

const evalCase: EvalCase = {
  id: 'assets-catalog-recall',
  name: 'Catalog-aware prompts prefer existing assets before generation',
  tier: 'gate',
  touchfiles: [
    'src-api/src/shared/assets/agent-context.ts',
    'src-api/src/shared/video/session-prompt.ts',
    'src-api/src/shared/services/design-mode/prompt-composer.ts',
    'src-api/src/shared/mcp/assets-server.ts',
  ],
  budget: { maxUsd: 0, timeoutMs: 10_000 },
  run: async () => {
    const workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'neuma-assets-recall-'),
    );
    setSetting('workDir', workDir);
    setSetting('assets.catalog_enabled', 'true');
    await fs.mkdir(path.join(workDir, 'library'), { recursive: true });
    await fs.writeFile(
      path.join(workDir, 'library', 'sunset-campaign.jpg'),
      'sunset campaign pixels',
    );

    const registry = new AssetRegistry();
    const projectId = `eval-video-${crypto.randomUUID()}`;
    const { asset } = await registry.ingest({
      source: 'local_fs',
      storagePath: 'library/sunset-campaign.jpg',
      clientRequestId: `assets-recall-${crypto.randomUUID()}`,
      hint: {
        kind: 'image',
        mime: 'image/jpeg',
        title: 'Sunset campaign hero',
      },
    });
    registry.attach(
      asset.id,
      { scope: 'video_project', scopeId: projectId },
      'reference',
    );

    const catalogContext = await composeCatalogPreamble({
      scope: 'video_project',
      scopeId: projectId,
    });
    const prompt = buildVideoSessionPrompt(videoProject(projectId), {
      catalogContext,
    });
    const checks = {
      hasCatalogBlock: prompt.includes('<!-- catalog-context-v1 -->'),
      namesAttachedAsset: prompt.includes('Sunset campaign hero'),
      instructsSearchFirst: prompt.includes(
        'Use assets_search before generating new media',
      ),
      exposesAttachedCount: prompt.includes('This project has 1 attached'),
    };
    const passed = Object.values(checks).every(Boolean);
    return {
      passed,
      score:
        Object.values(checks).filter(Boolean).length /
        Object.keys(checks).length,
      notes: passed
        ? 'catalog context names the attached asset and search-first policy'
        : 'catalog recall prompt cues missing',
      metrics: checks,
    };
  },
};

export default evalCase;

function videoProject(id: string): VideoProject {
  const now = new Date(0).toISOString();
  return {
    id,
    name: 'Catalog recall eval',
    template: 'custom',
    prompt: 'Use the existing sunset campaign hero if it fits.',
    assets: [],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    scenes: [],
    render: { status: 'idle', updatedAt: now },
    budget: { capUsd: 0, spentUsd: 0 },
    outputs: [],
    createdAt: now,
    updatedAt: now,
  };
}
