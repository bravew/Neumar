import { describe, expect, it } from 'vitest';

import { shouldUsePtcExecution } from '@/extensions/agent/claude';

import { MEDIA_DOWNLOAD_SERVER_NAME } from '@/shared/mcp/media-download-server';

const batch = { ptcEnabled: true, executionMode: 'batch', hasApiKey: true };

describe('shouldUsePtcExecution', () => {
  it('uses batch mode for an approved plan with an API key', () => {
    expect(shouldUsePtcExecution(batch)).toBe(true);
  });

  it('stays on the SDK path when the run carries the managed download tool', () => {
    // PTC builds its own tool set and mounts no in-process MCP server, so the
    // download tool would silently vanish from the run.
    expect(
      shouldUsePtcExecution({
        ...batch,
        inProcessMcpServers: { [MEDIA_DOWNLOAD_SERVER_NAME]: {} },
      }),
    ).toBe(false);
  });

  it('is not affected by unrelated in-process servers', () => {
    expect(
      shouldUsePtcExecution({
        ...batch,
        inProcessMcpServers: { other: {} },
      }),
    ).toBe(true);
  });

  it.each([
    { ...batch, ptcEnabled: false },
    { ...batch, executionMode: 'stream' },
    { ...batch, hasApiKey: false },
  ])('requires every PTC precondition (%j)', (input) => {
    expect(shouldUsePtcExecution(input)).toBe(false);
  });
});
