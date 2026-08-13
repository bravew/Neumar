import { readFile, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';
import { getInstalledPlugin } from '@/shared/db/plugins';
import { denyAllPolicy } from '@/shared/network-policy/schema';
import type { PluginManifest } from '@/shared/plugins';
import { createAppliedSnapshot } from '@/shared/plugins/runtime';
import {
  applyVideoPlugin,
  detectVideoPluginCandidateAfterRender,
  dismissVideoPluginCandidate,
  exportVideoPluginBundle,
  importVideoPluginBundle,
  listVideoPluginCandidates,
  loadVideoPlugins,
  parseVideoPluginManifest,
  saveVideoPluginCandidate,
  type VideoPluginSnapshotPayload,
  type VideoPluginStage,
} from '@/shared/video/plugins';
import { recordVideoIntentLog } from '@/shared/video/recipes';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'video-plugin-candidate-'));
  setSetting('workDir', workDir);
});

afterEach(async () => {
  getDatabase()
    .prepare(
      "DELETE FROM video_plugin_candidates WHERE project_id LIKE 'candidate-%'",
    )
    .run();
  getDatabase()
    .prepare("DELETE FROM video_intent_log WHERE project_id LIKE 'candidate-%'")
    .run();
  getDatabase()
    .prepare("DELETE FROM video_projects WHERE id LIKE 'candidate-%'")
    .run();
  getDatabase()
    .prepare("DELETE FROM installed_plugins WHERE id LIKE 'project/reusable-%'")
    .run();
  await rm(workDir, { recursive: true, force: true });
});

describe('video plugin candidates', () => {
  it('detects candidates only for qualifying successful plugin runs', async () => {
    const trivialProjectId = 'candidate-trivial';
    insertProject(trivialProjectId);
    recordVideoIntentLog({
      projectId: trivialProjectId,
      userIntentText: '@plugin:simple\nStoryboard this.',
      appliedPluginSnapshot: createSnapshot('simple', [
        stage('storyboard', ['storyboard-draft']),
      ]),
    });

    expect(
      await detectVideoPluginCandidateAfterRender(trivialProjectId),
    ).toBeNull();
    expect(listVideoPluginCandidates(trivialProjectId)).toEqual([]);

    const projectId = 'candidate-detect';
    insertProject(projectId);
    recordVideoIntentLog({
      projectId,
      userIntentText: '@plugin:reusable-ai\nGenerate launch images.',
      appliedPluginSnapshot: createSnapshot('reusable-ai', [
        stage('images', ['ai-image']),
      ]),
    });

    const candidate = await detectVideoPluginCandidateAfterRender(projectId);

    expect(candidate).toMatchObject({
      projectId,
      status: 'active',
      manifestDigest: 'source-digest-reusable-ai',
    });
    expect(listVideoPluginCandidates(projectId, 'active')).toHaveLength(1);
  });

  it('does not re-offer dismissed candidates for the same snapshot digest', async () => {
    const projectId = 'candidate-dismissed';
    insertProject(projectId);
    recordVideoIntentLog({
      projectId,
      userIntentText: '@plugin:reusable-dismiss\nGenerate launch images.',
      appliedPluginSnapshot: createSnapshot('reusable-dismiss', [
        stage('images', ['ai-image']),
      ]),
    });
    const candidate = await detectVideoPluginCandidateAfterRender(projectId);
    expect(candidate).not.toBeNull();
    dismissVideoPluginCandidate(candidate!.id);

    const detectedAgain =
      await detectVideoPluginCandidateAfterRender(projectId);

    expect(detectedAgain?.id).toBe(candidate!.id);
    expect(detectedAgain?.status).toBe('dismissed');
    expect(listVideoPluginCandidates(projectId, 'active')).toEqual([]);
    expect(listVideoPluginCandidates(projectId)).toHaveLength(1);
  });

  it('scaffolds a saved plugin, re-applies it, and restricts it after external edits', async () => {
    const projectId = 'candidate-save';
    insertProject(projectId);
    const snapshot = createSnapshot('reusable-save', [
      stage('images', ['ai-image']),
    ]);
    recordVideoIntentLog({
      projectId,
      userIntentText: '@plugin:reusable-save\nGenerate launch images.',
      appliedPluginSnapshot: snapshot,
    });
    const candidate = await detectVideoPluginCandidateAfterRender(projectId);
    expect(candidate).not.toBeNull();

    const saved = await saveVideoPluginCandidate(candidate!.id, {
      title: 'Reusable Launch Flow',
      description: 'Generate reusable launch visuals.',
      scope: 'project',
    });

    const videoRaw = await readFile(saved.videoManifestPath, 'utf-8');
    const parsed = parseVideoPluginManifest(videoRaw, {
      genericManifest: saved.plugin.manifest as PluginManifest,
      folderName: saved.plugin.name,
      validateEngineTemplate: false,
    });
    expect(parsed.ok).toBe(true);
    expect(saved.candidate.manifestDigest).toBe(snapshot.plugin.manifestDigest);

    const loaded = await loadVideoPlugins({
      projectPluginRoot: join(workDir, '.plugins'),
      builtinPluginRoot: null,
      watch: false,
      register: false,
    });
    const plugin = loaded.plugins.find(
      (entry) => entry.id === saved.plugin.name,
    );
    expect(plugin).toMatchObject({
      id: saved.plugin.name,
      trustTier: 'saved',
    });
    expect(plugin?.stages).toEqual(snapshot.payload.stages);

    const applied = applyVideoPlugin(plugin!, {
      inputs: { topic: 'launch' },
      signatureOk: true,
    });
    expect(applied.gate.restricted).toBe(false);
    expect(applied.context.pluginId).toBe(saved.plugin.name);

    const editedManifest = JSON.parse(videoRaw) as { description: string };
    editedManifest.description = 'Edited outside Neuma.';
    await writeFile(
      saved.videoManifestPath,
      JSON.stringify(editedManifest, null, 2),
    );

    const reloaded = await loadVideoPlugins({
      projectPluginRoot: join(workDir, '.plugins'),
      builtinPluginRoot: null,
      watch: false,
      register: false,
    });
    const edited = reloaded.plugins.find(
      (entry) => entry.id === saved.plugin.name,
    );
    expect(edited?.trustTier).toBe('local');
    expect(applyVideoPlugin(edited!).gate.restricted).toBe(true);
  });

  it('exports and imports a saved plugin bundle as restricted imported content', async () => {
    const projectId = 'candidate-export';
    insertProject(projectId);
    recordVideoIntentLog({
      projectId,
      userIntentText: '@plugin:reusable-export\nGenerate launch images.',
      appliedPluginSnapshot: createSnapshot('reusable-export', [
        stage('images', ['ai-image']),
      ]),
    });
    const candidate = await detectVideoPluginCandidateAfterRender(projectId);
    const saved = await saveVideoPluginCandidate(candidate!.id, {
      title: 'Reusable Export Flow',
      description: 'Generate reusable export visuals.',
      scope: 'project',
    });

    const bundle = await exportVideoPluginBundle(saved.plugin.name);
    const imported = await importVideoPluginBundle(bundle, {
      scope: 'project',
    });

    expect(imported.name).toBe('reusable-export-flow-2');
    expect(imported.trustTier).toBe('imported');
    expect(imported.lastReviewedDigest).toBeNull();
    expect(getInstalledPlugin(imported.id)).toMatchObject({
      id: imported.id,
      trustTier: 'imported',
    });

    const loaded = await loadVideoPlugins({
      projectPluginRoot: join(workDir, '.plugins'),
      builtinPluginRoot: null,
      watch: false,
      register: false,
    });
    const importedPlugin = loaded.plugins.find(
      (plugin) => plugin.id === imported.name,
    );
    expect(importedPlugin?.trustTier).toBe('imported');
    expect(applyVideoPlugin(importedPlugin!).gate.restricted).toBe(true);
  });
});

function createSnapshot(name: string, stages: VideoPluginStage[]) {
  const payload: VideoPluginSnapshotPayload = {
    engine: { id: 'html' },
    stages,
    inputs: { topic: 'launch' },
    output: { preset: 'saved-flow' },
    templates: [],
    networkPolicy: denyAllPolicy(),
  };

  return createAppliedSnapshot({
    domain: 'video',
    plugin: {
      id: name,
      name,
      version: '1.0.0',
      source: 'bundled',
      trustTier: 'bundled',
      manifestDigest: `source-digest-${name}`,
    },
    capabilities: ['media:generate'],
    payload,
  });
}

function stage(id: string, atoms: VideoPluginStage['atoms']): VideoPluginStage {
  return {
    id,
    atoms,
    optional: false,
    repeat: false,
  };
}

function insertProject(projectId: string): void {
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO video_projects
        (id, name, template, updated_at, render_status, workspace_root)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      projectId,
      projectId,
      'custom',
      '2026-06-16T00:00:00.000Z',
      'done',
      workDir,
    );
}
