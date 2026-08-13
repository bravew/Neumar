import { describe, expect, it } from 'vitest';

import { adaptPersistedEvent } from '@/components/task/trace/persisted-adapter';
import type { PersistedTraceEvent } from '@/shared/types/observability';

function traceEvent(attrs: Record<string, unknown>): PersistedTraceEvent {
  return {
    id: 'trace-manifest',
    task_id: 'task-1',
    session_id: null,
    message_id: null,
    parent_event_id: null,
    kind: 'artifact_write',
    agent: 'test',
    provider: 'test',
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
    attrs_json: JSON.stringify(attrs),
    error_json: null,
    created_at: new Date(0).toISOString(),
  };
}

describe('persisted trace adapter manifests', () => {
  it('summarizes trace-safe manifests instead of dumping raw attrs', () => {
    const entry = adaptPersistedEvent(
      traceEvent({
        artifact_manifest: {
          schema: 'neuma.trace.safe-manifest.v1',
          manifestType: 'artifact_manifest',
          totalEntries: 1,
          totalByteSize: 2048,
          entries: [
            {
              id: 'artifact:1',
              kind: 'html',
              status: 'available',
              redaction: 'none',
              storageRef: 'workspace://out/index.html',
              summary: 'private body should not appear',
            },
          ],
        },
      }),
    );

    expect(entry.content).toContain('artifact manifest: 1 item, 2.0 KB');
    expect(entry.content).toContain('available:1');
    expect(entry.content).not.toContain('workspace://out/index.html');
    expect(entry.content).not.toContain('private body should not appear');
  });
});
