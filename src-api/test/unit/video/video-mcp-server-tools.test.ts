import { describe, expect, it } from 'vitest';

import { videoMcpTools } from '@/shared/mcp/video-server/tools';

describe('video MCP server tools', () => {
  it('rejects missing source range numeric inputs before store calls', async () => {
    const tool = videoMcpTools.find(
      (candidate) => candidate.name === 'inspect_source_range',
    );
    if (!tool) throw new Error('inspect_source_range tool missing');

    expect(() =>
      tool.handler({
        project_id: 'project-1',
        source_id: 'source-1',
        end_ms: 1000,
      }),
    ).toThrow('start_ms must be a finite number');
  });
});
