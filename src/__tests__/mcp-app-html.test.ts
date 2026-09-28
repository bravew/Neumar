import { describe, expect, it } from 'vitest';

import {
  mcpAppDocument,
  parseMcpToolName,
} from '@/components/task/mcp-app-html';

describe('MCP App documents', () => {
  it('parses mcp__server__tool names', () => {
    expect(parseMcpToolName('mcp__widgets__chart')).toEqual({
      serverName: 'widgets',
      toolName: 'chart',
    });
    expect(parseMcpToolName('Bash')).toBeNull();
  });

  it('escapes non-html text and renders image blobs inside the sandbox', () => {
    expect(
      mcpAppDocument([
        { mimeType: 'text/plain', text: '<script>alert(1)</script>' },
      ])?.html,
    ).toBe('<pre>&lt;script&gt;alert(1)&lt;/script&gt;</pre>');

    const png = 'cG5n';
    expect(
      mcpAppDocument([{ mimeType: 'image/png', blob: png }])?.html,
    ).toContain(`data:image/png;base64,${png}`);
  });

  it('rejects a blob that is not base64', () => {
    expect(
      mcpAppDocument([{ mimeType: 'image/png', blob: 'not base64!!!' }]),
    ).toBeNull();
  });
});
