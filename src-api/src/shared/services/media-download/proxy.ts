/**
 * The only network the downloader may use.
 *
 * yt-dlp runs under a sandbox that permits outbound connections to this
 * loopback proxy and nothing else. The proxy authenticates with a per-run
 * token, validates every HTTP target and every CONNECT tunnel against the
 * media network policy (resolved addresses, no private ranges), connects to
 * the address it validated rather than re-resolving, and stops forwarding when
 * the batch byte budget is spent. Bodies are streamed, never buffered.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';

import { networkPolicySchema } from '@/shared/network-policy/schema';
import { validateRequestTarget } from '@/shared/network-policy/validator';

const policy = networkPolicySchema.parse({
  version: 1,
  egress: [
    {
      name: 'public-media',
      host: '*',
      ports: [80, 443],
      methods: ['GET', 'POST', 'HEAD'],
    },
  ],
});

const DEFAULT_MAX_BYTES = 4 * 1024 ** 3;
const MAX_HEADER_BYTES = 16_384;
const MAX_CONNECTIONS = 24;
const MAX_REQUESTS = 4096;
const IDLE_TIMEOUT_MS = 30_000;

const forwardedHeaders = [
  'user-agent',
  'range',
  'accept',
  'content-type',
  'content-length',
  'referer',
  'cookie',
  'accept-encoding',
] as const;

export interface DownloadProxy {
  /** `http://media:<token>@127.0.0.1:<port>`, passed to yt-dlp as `--proxy`. */
  url: string;
  port: number;
  /** Bytes received from the network so far. */
  received(): number;
  close(): void;
}

function sameToken(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Where the proxy listens. TCP mode takes an OS-assigned loopback port. Unix
 * socket mode has no TCP port of its own: the downloader reaches it through a
 * bridge on `sandboxPort` inside the sandbox, so that is the port in the URL.
 */
export type DownloadProxyOptions = { maxBytes?: number } & (
  | { socketPath?: undefined; sandboxPort?: undefined }
  | { socketPath: string; sandboxPort: number }
);

export async function openDownloadProxy(
  options: DownloadProxyOptions = {},
): Promise<DownloadProxy> {
  const token = randomBytes(24).toString('hex');
  const expected = `Basic ${Buffer.from(`media:${token}`).toString('base64')}`;
  const budget = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const sockets = new Set<Duplex>();
  let received = 0;
  let requests = 0;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    server.close();
    for (const socket of sockets) socket.destroy();
  };
  const spend = (bytes: number) => {
    received += bytes;
    if (received > budget) close();
    return !closed;
  };
  const track = (socket: Duplex) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
  };

  const server = createServer(
    { maxHeaderSize: MAX_HEADER_BYTES, requestTimeout: IDLE_TIMEOUT_MS },
    async (req, res) => {
      try {
        if (
          closed ||
          !sameToken(req.headers['proxy-authorization'], expected) ||
          ++requests > MAX_REQUESTS
        ) {
          throw new Error('refused');
        }
        const target = new URL(req.url ?? '');
        if (
          target.protocol !== 'http:' ||
          (target.port && target.port !== '80')
        ) {
          throw new Error('refused');
        }
        const validated = await validateRequestTarget(
          { url: target.href, method: req.method },
          policy,
        );
        const address = validated.resolvedIps[0];
        if (
          closed ||
          req.destroyed ||
          validated.decision !== 'allow' ||
          !address
        ) {
          throw new Error('refused');
        }
        const headers: Record<string, string> = { host: target.host };
        for (const key of forwardedHeaders) {
          const value = req.headers[key];
          if (typeof value === 'string') headers[key] = value;
        }
        const upstream = request(
          {
            host: address,
            port: 80,
            path: target.pathname + target.search,
            method: req.method,
            headers,
            agent: false,
          },
          (response) => {
            res.writeHead(response.statusCode ?? 502, response.headers);
            response.on('data', (chunk: Buffer) => {
              // Count the body once, on the way to the client.
              if (!spend(chunk.byteLength)) response.destroy();
            });
            response.pipe(res);
          },
        );
        upstream.once('socket', track);
        upstream.on('error', () => res.destroy());
        res.on('close', () => upstream.destroy());
        req.pipe(upstream);
      } catch {
        if (!res.headersSent) res.writeHead(403).end();
        else res.destroy();
      }
    },
  );
  server.maxConnections = MAX_CONNECTIONS;
  server.setTimeout(IDLE_TIMEOUT_MS, (socket) => socket.destroy());
  server.on('connection', track);

  server.on('connect', async (req, client, head) => {
    try {
      const target = req.url ?? '';
      if (
        closed ||
        !sameToken(req.headers['proxy-authorization'], expected) ||
        ++requests > MAX_REQUESTS ||
        !/^(?:[\w.-]+|\[[0-9a-f:]+\]):443$/i.test(target)
      ) {
        throw new Error('refused');
      }
      const validated = await validateRequestTarget(
        { url: `https://${target}/`, method: 'GET' },
        policy,
      );
      const address = validated.resolvedIps[0];
      if (
        closed ||
        client.destroyed ||
        validated.decision !== 'allow' ||
        !address
      ) {
        throw new Error('refused');
      }
      const upstream = connect(443, address, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.byteLength > 0) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      track(upstream);
      // A tunnel is opaque; the byte budget still applies to what it carries.
      upstream.on('data', (chunk: Buffer) => {
        if (!spend(chunk.byteLength)) upstream.destroy();
      });
      upstream.on('close', () => client.destroy());
      client.on('close', () => upstream.destroy());
    } catch {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    if (options.socketPath) server.listen(options.socketPath, resolve);
    else server.listen(0, '127.0.0.1', resolve);
  });
  let port = 0;
  if (options.socketPath) {
    port = options.sandboxPort;
  } else {
    const address = server.address();
    port = address && typeof address !== 'string' ? address.port : 0;
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    // The listener is already open; do not leave it behind.
    close();
    throw new Error('The download proxy did not start.');
  }
  return {
    port,
    url: `http://media:${token}@127.0.0.1:${port}`,
    received: () => received,
    close,
  };
}
