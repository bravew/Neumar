import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetVideoEngineRegistry,
  ensureBuiltinVideoEnginesRegistered,
} from '@/shared/video/engines';
import {
  _resetTemplateGalleryCache,
  loadTemplateGallery,
  scanTemplateRoot,
} from '@/shared/video/templates/gallery-loader';

let workDir: string;

const validYaml = (id: string, opts: { engine?: string } = {}) => `
spec_version: 1
id: ${id}
name: ${id}
description: test
engine: ${opts.engine ?? 'remotion'}
source_entry: source/index.html
category: data-viz
tags: []
output:
  formats: [mp4]
  default_format: mp4
  resolution:
    default: { width: 1920, height: 1080 }
    supported_aspects: ["16:9"]
  fps: { default: 30, supported: [30, 60] }
  duration: { type: variable, min_sec: 5, max_sec: 20 }
  alpha: false
  audio: { supported: true, expected_inputs: [bgm] }
inputs:
  schema:
    type: object
    properties:
      title: { type: string, maxLength: 100 }
license:
  spdx: Apache-2.0
  attribution_required: false
  redistribution_allowed: true
  commercial_use: true
provenance:
  origin: { kind: in-house }
  transformation: Original design.
version: 0.1.0
`;

const nativeYaml = (id: string) => `
spec_version: 1
id: ${id}
name: ${id}
description: native remotion template
engine: remotion
engine_version: ^4.0.0
source_entry: source/entry.ts
native:
  compositionId: DataRollup
category: data-viz
tags: [data, remotion]
output:
  formats: [mp4]
  default_format: mp4
  resolution:
    default: { width: 1920, height: 1080 }
    supported_aspects: ["16:9", "9:16", "1:1"]
  fps: { default: 30, supported: [30, 60] }
  duration: { type: variable, min_sec: 3, max_sec: 8 }
  alpha: true
  audio: { supported: false }
inputs:
  schema:
    type: object
    required: [data]
    properties:
      data:
        type: object
        required: [items]
        properties:
          items:
            type: array
            items:
              type: object
              required: [label, value]
              properties:
                label: { type: string }
                value: { type: number }
  examples:
    - data:
        items:
          - { label: Mon, value: 1200 }
license:
  spdx: Apache-2.0
  attribution_required: false
  redistribution_allowed: true
  commercial_use: true
provenance:
  origin: { kind: none, name: none }
  via_skill:
    name: none
    author: nexu-io
    url: https://github.com/nexu-io/html-video
    license: Apache-2.0
  transformation: Original Remotion React-tsx composition.
version: 0.1.0
preview:
  poster: preview.png
performance:
  reference_render:
    duration_sec: 5
    render_wall_clock_sec: 45
    machine: M2 MacBook Air
`;

async function writeTemplate(
  root: string,
  folder: string,
  yamlBody: string,
): Promise<void> {
  const dir = path.join(root, folder);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'template.video.yaml'), yamlBody, 'utf8');
}

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'video-gallery-'));
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});
beforeEach(() => {
  _resetTemplateGalleryCache();
  _resetVideoEngineRegistry();
  ensureBuiltinVideoEnginesRegistered();
});

describe('scanTemplateRoot', () => {
  it('returns empty + no error for a missing root', async () => {
    const result = await scanTemplateRoot(
      path.join(workDir, 'no-such-root'),
      'branding',
      { ttlMs: 0 },
    );
    expect(result.templates).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('loads a valid template and surfaces no issues', async () => {
    const root = path.join(workDir, 'valid');
    await writeTemplate(root, 'frame-clean', validYaml('frame-clean'));
    const result = await scanTemplateRoot(root, 'branding', { ttlMs: 0 });
    expect(result.issues).toEqual([]);
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0]?.id).toBe('frame-clean');
    expect(result.templates[0]?.metadata.license.spdx).toBe('Apache-2.0');
  });

  it('loads a native Remotion template and preserves its composition id', async () => {
    const root = path.join(workDir, 'native');
    await writeTemplate(
      root,
      'frame-data-rollup',
      nativeYaml('frame-data-rollup'),
    );
    const result = await scanTemplateRoot(root, 'branding', { ttlMs: 0 });
    expect(result.issues).toEqual([]);
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0]?.metadata.native?.compositionId).toBe(
      'DataRollup',
    );
  });

  it('rejects an unknown engine without a silent fallback', async () => {
    const root = path.join(workDir, 'unknown-engine');
    await writeTemplate(
      root,
      'frame-mc',
      validYaml('frame-mc', { engine: 'motion-canvas' }),
    );
    const result = await scanTemplateRoot(root, 'branding', { ttlMs: 0 });
    expect(result.templates).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe('unknown-engine');
  });

  it('flags malformed YAML and schema failures per template, not for the whole gallery', async () => {
    const root = path.join(workDir, 'mixed');
    await writeTemplate(root, 'frame-good', validYaml('frame-good'));
    await writeTemplate(root, 'frame-bad-yaml', ': this : is : not yaml :\n');
    await writeTemplate(
      root,
      'frame-bad-schema',
      'spec_version: 1\nid: frame-bad-schema\n', // missing required fields
    );
    const result = await scanTemplateRoot(root, 'branding', { ttlMs: 0 });
    expect(result.templates.map((t) => t.id)).toEqual(['frame-good']);
    const codes = result.issues.map((i) => i.code).sort();
    expect(codes).toEqual(['schema-validation-failed', 'yaml-parse-failed']);
  });

  it('rejects unsafe folder names + folder/id mismatches', async () => {
    const root = path.join(workDir, 'unsafe');
    await writeTemplate(root, 'a.dotted-ok', validYaml('a.dotted-ok'));
    await writeTemplate(root, 'frame-x', validYaml('frame-y')); // id mismatch
    const result = await scanTemplateRoot(root, 'branding', { ttlMs: 0 });
    expect(result.templates.map((t) => t.id)).toEqual(['a.dotted-ok']);
    expect(
      result.issues.some((i) => i.code === 'schema-validation-failed'),
    ).toBe(true);
  });

  it('rejects symlinked template folders (use lstat, not stat)', async () => {
    const root = path.join(workDir, 'symlinks');
    const targetRoot = path.join(workDir, 'symlink-target');
    await writeTemplate(targetRoot, 'frame-target', validYaml('frame-target'));
    await fs.mkdir(root, { recursive: true });
    await fs.symlink(
      path.join(targetRoot, 'frame-target'),
      path.join(root, 'frame-target'),
    );

    const result = await scanTemplateRoot(root, 'branding', { ttlMs: 0 });
    expect(result.templates).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe('symlinked-template');
  });

  it('samples the root mtime BEFORE readdir so a concurrent write busts on the next call', async () => {
    // Regression for the post-scan mtime race: a template added between
    // readdir and the mtime sample must not be hidden behind the TTL.
    // We simulate the race by writing a new template *after* the first
    // scan completes but rely on the loader having sampled mtime BEFORE
    // its own readdir: on the next call, live mtime > cached pre-scan
    // mtime, so the new template appears immediately even within TTL.
    const root = path.join(workDir, 'mtime-race');
    await writeTemplate(root, 'frame-a', validYaml('frame-a'));
    const first = await scanTemplateRoot(root, 'branding', { ttlMs: 5_000 });
    expect(first.templates.map((t) => t.id)).toEqual(['frame-a']);

    // Concurrent write between scans. Quantised mtime resolution (1s on some
    // filesystems) makes a sleep necessary to ensure mtime advances.
    await new Promise((r) => setTimeout(r, 20));
    await writeTemplate(root, 'frame-b', validYaml('frame-b'));

    const second = await scanTemplateRoot(root, 'branding', { ttlMs: 5_000 });
    expect(second.templates.map((t) => t.id).sort()).toEqual([
      'frame-a',
      'frame-b',
    ]);
  });

  it('caches within the TTL and busts when the root mtime changes', async () => {
    const root = path.join(workDir, 'cache');
    await writeTemplate(root, 'frame-a', validYaml('frame-a'));
    const first = await scanTemplateRoot(root, 'branding', { ttlMs: 5_000 });
    expect(first.templates).toHaveLength(1);

    // A re-scan within the TTL with no mtime change returns the cached set.
    const cached = await scanTemplateRoot(root, 'branding', { ttlMs: 5_000 });
    expect(cached).toBe(first);

    // Touch the root so its mtime advances. Some filesystems quantise mtime
    // to 1s, so write a real entry rather than relying on a touch.
    await new Promise((r) => setTimeout(r, 20));
    await writeTemplate(root, 'frame-b', validYaml('frame-b'));
    const busted = await scanTemplateRoot(root, 'branding', { ttlMs: 5_000 });
    expect(busted).not.toBe(first);
    expect(busted.templates.map((t) => t.id).sort()).toEqual([
      'frame-a',
      'frame-b',
    ]);
  });
});

describe('loadTemplateGallery', () => {
  it('user templates win on id collision with branded defaults', async () => {
    const userRoot = path.join(workDir, 'user-precedence');
    const brandingRoot = path.join(workDir, 'brand-precedence');
    await writeTemplate(brandingRoot, 'frame-x', validYaml('frame-x'));
    await writeTemplate(userRoot, 'frame-x', validYaml('frame-x'));
    await writeTemplate(
      brandingRoot,
      'frame-only-brand',
      validYaml('frame-only-brand'),
    );

    const result = await loadTemplateGallery({
      userRoot,
      brandingRoot,
      ttlMs: 0,
    });
    expect(result.templates.map((t) => t.id)).toEqual([
      'frame-only-brand',
      'frame-x',
    ]);
    const xWinner = result.templates.find((t) => t.id === 'frame-x');
    expect(xWinner?.rootKind).toBe('user');
  });
});
