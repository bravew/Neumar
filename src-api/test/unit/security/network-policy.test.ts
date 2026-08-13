import { describe, expect, it, vi } from 'vitest';

import {
  classifyIp,
  extractIpv4Mapped,
  isMetadataIp,
  isPrivateOrSpecialIp,
} from '@/shared/network-policy/ip';
import {
  denyAllPolicy,
  externalApiPolicy,
  networkPolicySchema,
  trustedLocalPolicy,
} from '@/shared/network-policy/schema';
import { validateRequestTarget } from '@/shared/network-policy/validator';

// ---------------------------------------------------------------------------
// IP classifier
// ---------------------------------------------------------------------------

describe('IP classifier', () => {
  it.each([
    ['10.0.0.5', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['172.32.0.1', 'public'],
    ['192.168.1.1', 'private'],
    ['127.0.0.1', 'loopback'],
    ['169.254.1.1', 'link_local'],
    ['169.254.169.254', 'metadata'],
    ['168.63.129.16', 'metadata'],
    ['100.64.0.1', 'cgnat'],
    ['100.127.255.255', 'cgnat'],
    ['100.128.0.1', 'public'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['8.8.8.8', 'public'],
    ['0.0.0.0', 'unspecified'],
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'link_local'],
    ['fc00::1', 'private'],
    ['fd00::1', 'private'],
    ['ff02::1', 'multicast'],
    ['fd00:ec2::254', 'metadata'],
    ['2606:4700:4700::1111', 'public'],
  ])('classifies %s as %s', (addr, klass) => {
    const info = classifyIp(addr);
    expect(info?.classification).toBe(klass);
  });

  it('extracts IPv4-mapped IPv6 (dotted form)', () => {
    expect(extractIpv4Mapped('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(extractIpv4Mapped('::FFFF:169.254.169.254')).toBe('169.254.169.254');
  });

  it('extracts IPv4-mapped IPv6 (hex form)', () => {
    expect(extractIpv4Mapped('::ffff:7f00:1')).toBe('127.0.0.1');
    expect(extractIpv4Mapped('::ffff:a9fe:a9fe')).toBe('169.254.169.254');
  });

  it('treats IPv4-mapped IPv6 as the underlying IPv4', () => {
    const info = classifyIp('::ffff:127.0.0.1');
    expect(info?.family).toBe('ipv4');
    expect(info?.address).toBe('127.0.0.1');
    expect(info?.classification).toBe('loopback');
    expect(info?.isPrivateOrSpecial).toBe(true);
  });

  it('treats IPv4-mapped public IPs as still special (anti-smuggling)', () => {
    // Even a public-looking v4-mapped answer should be flagged so a smuggling
    // attempt against a v4-only blocklist cannot hide a redirect target.
    const info = classifyIp('::ffff:8.8.8.8');
    expect(info?.classification).toBe('public');
    expect(info?.isPrivateOrSpecial).toBe(true);
  });

  it('strips IPv6 brackets', () => {
    expect(classifyIp('[::1]')?.classification).toBe('loopback');
  });

  it('isPrivateOrSpecialIp / isMetadataIp helpers agree', () => {
    expect(isPrivateOrSpecialIp('10.0.0.1')).toBe(true);
    expect(isPrivateOrSpecialIp('8.8.8.8')).toBe(false);
    expect(isMetadataIp('169.254.169.254')).toBe(true);
    expect(isMetadataIp('127.0.0.1')).toBe(false);
  });

  it('returns null for non-IP input', () => {
    expect(classifyIp('example.com')).toBeNull();
    expect(classifyIp('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe('networkPolicySchema', () => {
  it('parses a deny-all default', () => {
    const p = denyAllPolicy();
    expect(p.default).toBe('deny');
    expect(p.dns.block_private).toBe(true);
    expect(p.dns.block_metadata).toBe(true);
  });

  it('rejects unknown top-level fields (strict)', () => {
    const r = networkPolicySchema.safeParse({
      version: 1,
      default: 'deny',
      // @ts-expect-error testing strict
      extra: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects version other than 1', () => {
    const r = networkPolicySchema.safeParse({ version: 2 });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateRequestTarget — DNS-bound enforcement
// ---------------------------------------------------------------------------

const stubResolve =
  (answers: Array<{ address: string; family: number }>) =>
  async (_host: string) =>
    answers;

describe('validateRequestTarget', () => {
  it('rejects unsupported protocols', async () => {
    const r = await validateRequestTarget(
      { url: 'file:///etc/passwd' },
      denyAllPolicy(),
    );
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/Unsupported protocol/);
  });

  it('rejects URL with credentials', async () => {
    const r = await validateRequestTarget(
      { url: 'https://user:pass@example.com/' },
      trustedLocalPolicy(),
      { resolve: stubResolve([{ address: '8.8.8.8', family: 4 }]) },
    );
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/Credentials/);
  });

  it('rejects literal private IP under default policy', async () => {
    const r = await validateRequestTarget(
      { url: 'http://10.0.0.1/' },
      trustedLocalPolicy(),
    );
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/private/);
  });

  it('rejects metadata literal', async () => {
    const r = await validateRequestTarget(
      { url: 'http://169.254.169.254/latest/meta-data' },
      trustedLocalPolicy(),
    );
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/metadata/);
  });

  it('rejects DNS rebinding to private (single bad answer fails the set)', async () => {
    const r = await validateRequestTarget(
      { url: 'https://rebinder.example/' },
      trustedLocalPolicy(),
      {
        resolve: stubResolve([
          { address: '8.8.8.8', family: 4 },
          { address: '127.0.0.1', family: 4 }, // poisoned answer
        ]),
      },
    );
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/loopback|127/);
  });

  it('rejects metadata answer in a multi-answer DNS reply', async () => {
    const r = await validateRequestTarget(
      { url: 'https://imds-pivot.example/' },
      trustedLocalPolicy(),
      {
        resolve: stubResolve([{ address: '169.254.169.254', family: 4 }]),
      },
    );
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/metadata/);
  });

  it('rejects IPv4-mapped IPv6 pivots', async () => {
    const r = await validateRequestTarget(
      { url: 'http://[::ffff:127.0.0.1]/' },
      trustedLocalPolicy(),
    );
    expect(r.decision).toBe('deny');
  });

  it('rejects localhost when policy disallows', async () => {
    const r = await validateRequestTarget(
      { url: 'http://localhost:11434/' },
      denyAllPolicy(),
    );
    expect(r.decision).toBe('deny');
  });

  it('allows localhost when policy explicitly opts in', async () => {
    const r = await validateRequestTarget(
      { url: 'http://localhost:11434/' },
      trustedLocalPolicy(),
    );
    expect(r.decision).toBe('allow');
    expect(r.reason).toMatch(/localhost/);
  });

  it.each([
    'http://localhost.:11434/',
    'http://127.0.0.1./',
    'http://127.0.0.5./',
  ])('normalizes trailing-dot loopback host %s', async (url) => {
    const r = await validateRequestTarget({ url }, trustedLocalPolicy());
    expect(r.decision).toBe('allow');
    expect(r.reason).toMatch(/localhost/);
  });

  it.each([
    ['http://169.254.169.254./', /metadata/],
    ['http://192.168.1.5./', /private/],
    ['http://10.0.0.5./', /private/],
    ['http://0.0.0.0./', /unspecified/],
    ['http://100.64.0.5./', /cgnat/],
    ['http://172.16.0.1./', /private/],
    ['http://224.0.0.1./', /multicast/],
  ])('blocks trailing-dot private target %s', async (url, reason) => {
    const r = await validateRequestTarget({ url }, trustedLocalPolicy());
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(reason);
  });

  it('blocks trailing-dot cloud metadata hostnames before DNS', async () => {
    const resolve = vi.fn(stubResolve([{ address: '8.8.8.8', family: 4 }]));
    const r = await validateRequestTarget(
      { url: 'http://metadata.google.internal./computeMetadata/v1/' },
      trustedLocalPolicy(),
      { resolve },
    );
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/metadata endpoint/);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('normalizes trailing-dot public hosts before DNS and egress matching', async () => {
    const resolve = vi.fn(stubResolve([{ address: '8.8.8.8', family: 4 }]));
    const policy = networkPolicySchema.parse({
      version: 1,
      default: 'deny',
      egress: [
        {
          name: 'api',
          host: 'api.example.com',
          ports: [443],
          methods: ['GET'],
          paths: ['/'],
        },
      ],
    });
    const r = await validateRequestTarget(
      { url: 'https://api.example.com./v1' },
      policy,
      { resolve },
    );
    expect(r.decision).toBe('allow');
    expect(resolve).toHaveBeenCalledWith('api.example.com');
  });

  it('allows when egress rule matches', async () => {
    const policy = networkPolicySchema.parse({
      version: 1,
      default: 'deny',
      egress: [
        {
          name: 'api',
          host: 'api.example.com',
          ports: [443],
          methods: ['GET', 'POST'],
          paths: ['/v1/'],
        },
      ],
    });
    const r = await validateRequestTarget(
      { url: 'https://api.example.com/v1/users', method: 'POST' },
      policy,
      { resolve: stubResolve([{ address: '8.8.8.8', family: 4 }]) },
    );
    expect(r.decision).toBe('allow');
    expect(r.reason).toMatch(/api/);
    expect(r.resolvedIps).toEqual(['8.8.8.8']);
  });

  it('rejects when host matches but method does not', async () => {
    const policy = networkPolicySchema.parse({
      version: 1,
      default: 'deny',
      egress: [
        {
          name: 'read-only',
          host: 'api.example.com',
          ports: [443],
          methods: ['GET'],
          paths: ['/'],
        },
      ],
    });
    const r = await validateRequestTarget(
      { url: 'https://api.example.com/x', method: 'DELETE' },
      policy,
      { resolve: stubResolve([{ address: '8.8.8.8', family: 4 }]) },
    );
    expect(r.decision).toBe('deny');
  });

  it('supports wildcard host patterns', async () => {
    const policy = networkPolicySchema.parse({
      version: 1,
      default: 'deny',
      egress: [
        {
          name: 'cdn',
          host: '*.example.com',
          ports: [443],
          methods: ['GET'],
          paths: ['/'],
        },
      ],
    });
    const r = await validateRequestTarget(
      { url: 'https://cdn.example.com/static/x.js' },
      policy,
      { resolve: stubResolve([{ address: '8.8.8.8', family: 4 }]) },
    );
    expect(r.decision).toBe('allow');
  });

  it('default=allow falls through to allow when no rule matches', async () => {
    const r = await validateRequestTarget(
      { url: 'https://example.com/x' },
      trustedLocalPolicy(),
      { resolve: stubResolve([{ address: '8.8.8.8', family: 4 }]) },
    );
    expect(r.decision).toBe('allow');
  });

  it('external API policy allows public HTTPS POSTs and denies localhost', async () => {
    const allowed = await validateRequestTarget(
      { url: 'https://api.example.com/v1/music', method: 'POST' },
      externalApiPolicy(),
      { resolve: stubResolve([{ address: '8.8.8.8', family: 4 }]) },
    );
    expect(allowed.decision).toBe('allow');

    const cleartext = await validateRequestTarget(
      { url: 'http://api.example.com/v1/music', method: 'POST' },
      externalApiPolicy(),
      { resolve: stubResolve([{ address: '8.8.8.8', family: 4 }]) },
    );
    expect(cleartext.decision).toBe('deny');

    const localhost = await validateRequestTarget(
      { url: 'http://localhost:11434/v1/music', method: 'POST' },
      externalApiPolicy(),
    );
    expect(localhost.decision).toBe('deny');
    expect(localhost.reason).toMatch(/Localhost is not allowed/);
  });
});
