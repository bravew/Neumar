import * as http from 'node:http';
import os from 'node:os';

import { describe, expect, it } from 'vitest';

import { ChannelManager } from '@/shared/channels/channel-manager';

/**
 * Boundary test for the tool-result image download in `toTextStreamWithFiles`.
 *
 * The URL is taken from MCP tool output, so it is untrusted. The download must
 * go through `safeFetch` with a policy that resolves and classifies the
 * destination address instead of a plain `fetch()`.
 *
 * `http://localhost:<port>/...` passes the synchronous `validateBaseUrl` hint
 * (localhost is explicitly allowed there for local servers), so it reaches the
 * fetch and exercises the real call site rather than the pre-check.
 */

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

interface ToolImageStream {
  toTextStreamWithFiles(
    agentGen: AsyncGenerator<{ type: string; output?: string }>,
    createdFiles: string[],
    workDir: string,
    collectedImageUrls?: string[],
    sessionStartMs?: number,
  ): AsyncIterable<string>;
}

interface ToolImageResult {
  createdFiles: string[];
  collectedImageUrls: string[];
}

async function collectToolImage(output: string): Promise<ToolImageResult> {
  const manager = new ChannelManager() as unknown as ToolImageStream;
  const createdFiles: string[] = [];
  const collectedImageUrls: string[] = [];

  async function* agentGen(): AsyncGenerator<{
    type: string;
    output?: string;
  }> {
    yield { type: 'tool_result', output };
  }

  for await (const _text of manager.toTextStreamWithFiles(
    agentGen(),
    createdFiles,
    os.tmpdir(),
    collectedImageUrls,
  )) {
    // Drain the stream; the assertions are on the side effects.
  }

  return { createdFiles, collectedImageUrls };
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected a TCP server address'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('tool-result image download network policy', () => {
  it('refuses a tool-result image served from loopback', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits += 1;
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG_1X1);
    });
    const port = await listen(server);

    let result: ToolImageResult;
    try {
      result = await collectToolImage(
        `Generated image.\nURL: http://localhost:${port}/image.png`,
      );
    } finally {
      await close(server);
    }

    // The loopback destination is denied by the policy before a connection is
    // made, so the local server never sees the request.
    expect(hits).toBe(0);
    expect(result.createdFiles).toEqual([]);
    // A denied URL is not re-advertised to the channel as a remote link.
    expect(result.collectedImageUrls).toEqual([]);
  });

  it('refuses a tool-result image at a cloud metadata address', async () => {
    const result = await collectToolImage(
      'URL: http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    );

    expect(result.createdFiles).toEqual([]);
    expect(result.collectedImageUrls).toEqual([]);
  });

  it('refuses a tool-result image at a private IPv4 literal', async () => {
    const result = await collectToolImage(
      'URL: https://10.1.2.3/internal/secret.png',
    );

    expect(result.createdFiles).toEqual([]);
    expect(result.collectedImageUrls).toEqual([]);
  });
});
