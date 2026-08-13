import * as http from 'node:http';

import { describe, expect, it } from 'vitest';

import { NetworkPolicyDenied, safeFetch } from '@/shared/network-policy/fetch';
import {
  denyAllPolicy,
  trustedLocalPolicy,
} from '@/shared/network-policy/schema';
import { createSecuritySession } from '@/shared/security/session';

describe('safeFetch policy gating', () => {
  it('throws NetworkPolicyDenied for unsupported protocols (no network I/O)', async () => {
    await expect(
      safeFetch('file:///etc/passwd', trustedLocalPolicy()),
    ).rejects.toBeInstanceOf(NetworkPolicyDenied);
  });

  it('throws NetworkPolicyDenied for IPv4-mapped IPv6 (smuggling defense)', async () => {
    await expect(
      safeFetch('http://[::ffff:127.0.0.1]/', trustedLocalPolicy()),
    ).rejects.toThrow(/IPv4-mapped/);
  });

  it('throws NetworkPolicyDenied for metadata IP literal', async () => {
    await expect(
      safeFetch(
        'http://169.254.169.254/latest/meta-data/iam/',
        trustedLocalPolicy(),
      ),
    ).rejects.toThrow(/metadata/);
  });

  it('throws NetworkPolicyDenied when default policy denies and no rules match', async () => {
    await expect(
      safeFetch('https://example.com/', denyAllPolicy()),
    ).rejects.toBeInstanceOf(NetworkPolicyDenied);
  });

  it('blocks outbound requests that contain the session canary in the body', async () => {
    const session = createSecuritySession({ sessionId: 'unit-test-1' });
    await expect(
      safeFetch('https://api.example.com/leak', trustedLocalPolicy(), {
        method: 'POST',
        body: `payload with ${session.canary.value} embedded`,
        session,
      }),
    ).rejects.toThrow(/canary/);
  });

  it('blocks outbound requests that contain the canary in headers', async () => {
    const session = createSecuritySession({ sessionId: 'unit-test-2' });
    await expect(
      safeFetch('https://api.example.com/x', trustedLocalPolicy(), {
        method: 'GET',
        headers: { 'x-leak': session.canary.value },
        session,
      }),
    ).rejects.toThrow(/canary/);
  });

  it('blocks when the canary appears in the URL', async () => {
    const session = createSecuritySession({ sessionId: 'unit-test-3' });
    await expect(
      safeFetch(
        `https://api.example.com/${session.canary.value}`,
        trustedLocalPolicy(),
        { session },
      ),
    ).rejects.toThrow(/canary/);
  });

  it('rejects buffered responses that exceed maxBytes', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('0123456789');
    });
    await listen(server);
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }

    try {
      await expect(
        safeFetch(`http://127.0.0.1:${address.port}/`, trustedLocalPolicy(), {
          maxBytes: 4,
        }),
      ).rejects.toThrow(/Response exceeded 4 bytes/);
    } finally {
      await close(server);
    }
  });

  it('revalidates redirects and blocks a private-IP target', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { location: 'http://10.0.0.1/internal' });
      res.end();
    });
    await listen(server);
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }

    try {
      await expect(
        safeFetch(
          `http://127.0.0.1:${address.port}/redirect`,
          trustedLocalPolicy(),
        ),
      ).rejects.toThrow(/private/);
    } finally {
      await close(server);
    }
  });
});

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
