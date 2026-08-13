import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

process.env.HOME = mkdtempSync(path.join(tmpdir(), 'neumar-manifests-home-'));

import { getDatabase } from '@/shared/db';
import {
  createInputTextSnapshotManifest,
  createTraceArtifactReference,
  createTraceFileManifestEntry,
  createTraceSafeManifest,
  traceManifestAttrs,
} from '@/shared/observability/manifests';
import {
  listTraceEvents,
  recordTraceEvent,
} from '@/shared/observability/trace';

describe('trace-safe manifests', () => {
  let workspaceRoot: string;
  let taskId: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), 'neumar-manifests-'));
    mkdirSync(path.join(workspaceRoot, 'out'), { recursive: true });
    taskId = `manifest-task-${crypto.randomUUID()}`;
    getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO tasks (id, prompt, status, started_at)
         VALUES (?, 'manifest test', 'running', datetime('now'))`,
      )
      .run(taskId);
  });

  it('generates file artifact metadata without raw file bodies', async () => {
    const filePath = path.join(workspaceRoot, 'out', 'index.html');
    writeFileSync(filePath, '<html><body>private artifact body</body></html>');

    const entry = await createTraceFileManifestEntry({
      filePath,
      manifestType: 'artifact_manifest',
      taskId,
      workspaceRoot,
      summary: 'Generated HTML entrypoint',
    });
    const manifest = createTraceSafeManifest('artifact_manifest', [entry]);

    expect(entry.status).toBe('available');
    expect(entry.storageRef).toBe('workspace://out/index.html');
    expect(entry.byteSize).toBeGreaterThan(0);
    expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(manifest)).not.toContain('private artifact body');
  });

  it('marks missing and oversized files without throwing', async () => {
    const missingPath = path.join(workspaceRoot, 'out', 'missing.png');
    const missing = await createTraceFileManifestEntry({
      filePath: missingPath,
      manifestType: 'attachment_manifest',
      workspaceRoot,
    });
    const missingAgain = await createTraceFileManifestEntry({
      filePath: missingPath,
      manifestType: 'attachment_manifest',
      workspaceRoot,
    });
    expect(missing.status).toBe('missing');
    expect(missing.redaction).toBe('missing');
    expect(missing.id).toBe(missingAgain.id);

    const largePath = path.join(workspaceRoot, 'out', 'large.bin');
    writeFileSync(largePath, Buffer.alloc(16, 7));
    const oversized = await createTraceFileManifestEntry({
      filePath: largePath,
      manifestType: 'artifact_manifest',
      workspaceRoot,
      hashByteLimit: 8,
    });
    expect(oversized.status).toBe('available');
    expect(oversized.redaction).toBe('truncated');
    expect(oversized.sha256).toBeUndefined();
    expect(oversized.byteSize).toBe(16);
  });

  it('uses opaque storage refs when no workspace root is provided', async () => {
    const filePath = path.join(workspaceRoot, 'out', 'private-name.txt');
    writeFileSync(filePath, 'trace-safe content');

    const entry = await createTraceFileManifestEntry({
      filePath,
      manifestType: 'artifact_manifest',
      hashByteLimit: 1,
    });

    expect(entry.storageRef).toMatch(/^local-file:\/\/sha256\/[a-f0-9]{16}$/);
    expect(entry.storageRef).not.toContain('private-name.txt');
  });

  it('creates content-free artifact references without serializing paths', () => {
    const filePath = path.join(workspaceRoot, 'private', 'customer-name.pdf');
    const entry = createTraceArtifactReference({ filePath, taskId });
    const serialized = JSON.stringify(entry);

    expect(entry.id).toMatch(/^artifact:path:[a-f0-9]{16}$/);
    expect(entry.redaction).toBe('hashed');
    expect(serialized).not.toContain(filePath);
    expect(serialized).not.toContain('customer-name.pdf');
  });

  it('records prompt snapshots as hashes by default', () => {
    const manifest = createInputTextSnapshotManifest({
      text: 'secret prompt with sk-test-secret-value-1234567890',
      taskId,
    });

    expect(manifest.entries[0]?.redaction).toBe('hashed');
    expect(manifest.entries[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(manifest)).not.toContain('sk-test-secret');
  });

  it('persists JSON-serializable redacted manifest attrs in trace events', async () => {
    const filePath = path.join(workspaceRoot, 'out', 'artifact.txt');
    writeFileSync(filePath, 'artifact content');
    const entry = await createTraceFileManifestEntry({
      filePath,
      manifestType: 'artifact_manifest',
      taskId,
      workspaceRoot,
    });
    const promptManifest = createInputTextSnapshotManifest({
      text: 'prompt with token sk-test-secret-value-1234567890',
      taskId,
      includeRedactedSnippet: true,
    });

    recordTraceEvent({
      id: 'manifest-trace',
      taskId,
      kind: 'artifact_write',
      attrs: traceManifestAttrs(
        createTraceSafeManifest('artifact_manifest', [entry]),
        promptManifest,
      ),
    });

    const event = listTraceEvents(taskId).find(
      (item) => item.id === 'manifest-trace',
    );
    expect(event?.attrs_json).toContain('artifact_manifest');
    expect(event?.attrs_json).toContain('[REDACTED]');
    expect(event?.attrs_json).not.toContain('artifact content');
    expect(() => JSON.parse(event?.attrs_json ?? '')).not.toThrow();
  });
});
