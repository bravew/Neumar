import { appendFile, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import type { AgentRunRow } from '@/shared/db/operations';
import {
  buildSupportBundle,
  readBoundedLogTail,
  type SupportBundleSources,
} from '@/shared/observability/support-bundle';
import type { TraceEvent } from '@/shared/observability/trace';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('support bundle', () => {
  it('selects the current and newest earlier log per category across a year boundary', async () => {
    const logDirectory = await makeLogDirectory();
    const previous = join(logDirectory, 'app-12-31.log');
    const current = join(logDirectory, 'app-01-01.log');
    await writeFile(previous, 'previous\n');
    await writeFile(current, 'current\n');
    await utimes(
      previous,
      new Date('2026-12-31T23:59:00Z'),
      new Date('2026-12-31T23:59:00Z'),
    );
    await utimes(
      current,
      new Date('2027-01-01T00:01:00Z'),
      new Date('2027-01-01T00:01:00Z'),
    );

    const bundle = await buildSupportBundle(
      request(logDirectory, new Date('2027-01-01T12:00:00Z')),
      sources(),
    );
    const zip = await JSZip.loadAsync(bundle.data);

    expect(Object.keys(zip.files)).toContain('logs/app-01-01.log');
    expect(Object.keys(zip.files)).toContain('logs/app-12-31.log');
    expect(
      Object.keys(zip.files).some((name) => name.includes('gateway')),
    ).toBe(false);
  });

  it('keeps complete tail lines while a log is appended and omits oversized lines', async () => {
    const logDirectory = await makeLogDirectory();
    const file = join(logDirectory, 'app-08-08.log');
    await writeFile(
      file,
      `discarded-prefix\nkeep-one\n${'x'.repeat(100)}\nkeep-two\n`,
    );

    const reading = readBoundedLogTail(file, {
      maxBytes: 110,
      maxLineBytes: 32,
    });
    await appendFile(file, 'concurrent-complete\nconcurrent-partial');
    const tail = await reading;

    expect(tail).not.toContain('discarded-prefix');
    expect(tail).toContain('[OMITTED_OVERSIZED_LOG_LINE');
    expect(tail.endsWith('\n')).toBe(true);
    expect(tail).not.toContain('concurrent-partial');
  });

  it('redacts secrets and absolute paths from logs and exports safe event projections', async () => {
    const logDirectory = await makeLogDirectory();
    await writeFile(
      join(logDirectory, 'system-08-08.log'),
      'Bearer top-secret cwd:/opt/private/repo /Users/alice/private/project/file.ts /srv/work/repo/file.ts \\\\server\\share\\file.ts\n',
    );
    const bundle = await buildSupportBundle(
      request(logDirectory),
      sources({
        events: [
          {
            run_id: 'run/unsafe',
            seq: 0,
            event_type: 'TEXT_MESSAGE_CONTENT',
            event_json: JSON.stringify({ delta: 'never export this prompt' }),
            created_at: '2026-08-08T00:00:00.000Z',
          },
        ],
        traces: [
          trace(
            JSON.stringify({
              artifact_manifest: {
                schema: 'neuma.trace.safe-manifest.v1',
                manifestType: 'artifact_manifest',
                totalEntries: 2,
                totalByteSize: 42,
                generatedAt: '2026-08-08T00:00:00.000Z',
                entries: [
                  {
                    id: 'artifact-safe',
                    storageRef: `sha256://${'a'.repeat(64)}`,
                    summary: 'never export this manifest summary',
                  },
                  {
                    id: 'artifact-unsafe',
                    storageRef: 'workspace://secret/project/file.ts',
                  },
                ],
              },
            }),
          ),
        ],
      }),
    );
    const zip = await JSZip.loadAsync(bundle.data);
    const log = await zip.file('logs/system-08-08.log')!.async('string');
    const events = await zip.file('run/events.jsonl')!.async('string');
    const traces = await zip.file('run/traces.jsonl')!.async('string');

    expect(log).toContain('Bearer [REDACTED]');
    expect(log).toContain('[PATH_REDACTED]');
    expect(log).not.toContain('top-secret');
    expect(log).not.toContain('/opt/private/repo');
    expect(log).not.toContain('/srv/work/repo/file.ts');
    expect(log).not.toContain('server\\share');
    expect(events).toContain('TEXT_MESSAGE_CONTENT');
    expect(events).not.toContain('never export this prompt');
    expect(traces).toContain(`sha256://${'a'.repeat(64)}`);
    expect(traces).not.toContain('workspace://secret/project/file.ts');
    expect(traces).not.toContain('never export this manifest summary');
  });

  it('records unreadable optional sources and oversized trace records as omissions', async () => {
    const logDirectory = await makeLogDirectory();
    const hugeManifest = {
      schema: 'neuma.trace.safe-manifest.v1',
      manifestType: 'artifact_manifest',
      entries: Array.from({ length: 20 }, (_, index) => ({
        id: `artifact-${index}-${'x'.repeat(80)}`,
        kind: 'code',
        redaction: 'hashed',
        status: 'available',
      })),
      totalEntries: 20,
      totalByteSize: null,
      generatedAt: '2026-08-08T00:00:00.000Z',
    };
    const bundle = await buildSupportBundle(
      {
        ...request(logDirectory),
        limits: {
          maxRecordBytes: 200,
          maxEntryBytes: 2_000,
          maxTotalBytes: 5_000,
          maxArchiveBytes: 5_000,
        },
      },
      sources({
        traces: [trace(JSON.stringify({ artifact_manifest: hugeManifest }))],
        diagnosticsError: new Error(
          'database unavailable at /private/db.sqlite',
        ),
      }),
    );
    const zip = await JSZip.loadAsync(bundle.data);
    const traces = await zip.file('run/traces.jsonl')!.async('string');
    const omissions = await zip.file('omissions.json')!.async('string');

    expect(traces).toContain('OMITTED_OVERSIZED_RECORD');
    expect(omissions).toContain('diagnostics');
    expect(omissions).not.toContain('/private/db.sqlite');
  });

  it('sanitizes filenames and enforces archive entry and total caps', async () => {
    const logDirectory = await makeLogDirectory();
    await writeFile(
      join(logDirectory, 'app-08-08.log'),
      `${'line\n'.repeat(100)}`,
    );
    const bundle = await buildSupportBundle(
      {
        ...request(logDirectory),
        runId: 'run unsafe name',
        limits: {
          maxLogBytes: 300,
          maxLineBytes: 100,
          maxRecordBytes: 200,
          maxEntryBytes: 400,
          maxTotalBytes: 1_600,
          maxArchiveBytes: 2_500,
        },
      },
      sources({
        run: { ...run(), id: 'run unsafe name' },
        events: Array.from({ length: 20 }, (_, seq) => ({
          run_id: 'run unsafe name',
          seq,
          event_type: 'TEXT_MESSAGE_CONTENT',
          event_json: '{}',
          created_at: '2026-08-08T00:00:00.000Z',
        })),
      }),
    );
    const zip = await JSZip.loadAsync(bundle.data);
    const entrySizes = await Promise.all(
      Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map(async (entry) => (await entry.async('uint8array')).byteLength),
    );

    expect(bundle.filename).toMatch(/^[a-zA-Z0-9._-]+\.zip$/);
    expect(Math.max(...entrySizes)).toBeLessThanOrEqual(400);
    expect(entrySizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(
      1_600,
    );
    expect(bundle.data.byteLength).toBeLessThanOrEqual(2_500);
    const events = await zip.file('run/events.jsonl')!.async('string');
    expect(
      events
        .trim()
        .split('\n')
        .every((line) => JSON.parse(line)),
    ).toBe(true);
    const omissions = await zip.file('omissions.json')!.async('string');
    expect(omissions).toContain('run/events.jsonl');
  });
});

async function makeLogDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'neuma-support-bundle-'));
  temporaryDirectories.push(directory);
  return directory;
}

function request(logDirectory: string, now = new Date('2026-08-08T12:00:00Z')) {
  return {
    runId: 'run/unsafe',
    mode: 'design' as const,
    ownerKey: 'owner-1',
    logDirectory,
    now,
  };
}

function sources(
  overrides: {
    events?: ReturnType<SupportBundleSources['getEvents']>;
    traces?: TraceEvent[];
    diagnosticsError?: Error;
    run?: AgentRunRow;
  } = {},
): SupportBundleSources {
  return {
    getRun: () => overrides.run ?? run(),
    getEvents: () => overrides.events ?? [],
    getTraces: () => overrides.traces ?? [],
    getDiagnostics: () => {
      if (overrides.diagnosticsError) throw overrides.diagnosticsError;
      return { schema: 'safe-diagnostics' };
    },
  };
}

function run(): AgentRunRow {
  return {
    id: 'run/unsafe',
    task_id: 'owner-1',
    parent_run_id: null,
    provider: 'codex',
    status: 'completed',
    started_at: '2026-08-08T00:00:00.000Z',
    finished_at: '2026-08-08T00:01:00.000Z',
    cost_usd: 0,
    tokens_in: 0,
    tokens_out: 0,
    model: null,
    error: null,
    completeness: 'complete',
    delivery: 'not_expected',
    retry: 'not_safe',
    failure_cause: null,
    runtime_version: null,
    attempt: 0,
    session_handle_kind: null,
    invalidation_reason: null,
    mode: 'design',
    owner_key: 'owner-1',
    project_id: 'owner-1',
    conversation_id: null,
    client_request_id: null,
    request_message_id: null,
    execution_id: 'execution-1',
    initial_run_id: 'run/unsafe',
    source_run_id: null,
    run_index: 0,
    recovery_action: null,
    delivery_reconciliation_deadline: null,
  };
}

function trace(attrsJson: string): TraceEvent {
  return {
    id: 'trace-1',
    task_id: 'owner-1',
    session_id: 'run/unsafe',
    message_id: null,
    parent_event_id: null,
    kind: 'artifact_write',
    agent: 'codex',
    provider: 'codex',
    model: null,
    profile: null,
    tool: null,
    status: 'ok',
    started_at: 1,
    ended_at: 2,
    duration_ms: 1,
    input_tokens: null,
    output_tokens: null,
    cache_read: null,
    cache_creation: null,
    cost_usd: null,
    attrs_json: attrsJson,
    error_json: null,
    created_at: '2026-08-08T00:00:00.000Z',
  };
}
