/**
 * Network policy DSL — version 1.
 *
 * Structural-only validation. DNS resolution and IP classification happen in
 * `validator.ts`, immediately before connect, because a Zod refine() cannot
 * synchronously call into DNS without breaking schema purity.
 */

import { z } from 'zod';

const httpMethod = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

const portSchema = z.union([
  z.number().int().min(1).max(65535),
  z.literal('*'),
]);

const egressRule = z
  .object({
    name: z.string().min(1),
    /** Hostname pattern: exact, wildcard `*.example.com`, or `*` for any. */
    host: z.string().min(1),
    ports: z.array(portSchema).default([443]),
    methods: z.array(httpMethod).default(['GET']),
    /** Path prefix patterns. `/` matches any. */
    paths: z.array(z.string()).default(['/']),
  })
  .strict();

export const networkPolicySchema = z
  .object({
    version: z.literal(1),
    /** Default action when no rule matches. */
    default: z.enum(['allow', 'deny']).default('deny'),
    egress: z.array(egressRule).default([]),
    dns: z
      .object({
        resolver: z.enum(['system', 'doh']).default('system'),
        block_private: z.boolean().default(true),
        block_metadata: z.boolean().default(true),
      })
      .strict()
      .default({
        resolver: 'system',
        block_private: true,
        block_metadata: true,
      }),
    /** Localhost development exception. Off by default. */
    allow_localhost: z.boolean().default(false),
    audit: z
      .object({
        log_path: z.string().optional(),
        max_bytes: z.number().int().positive().default(50_000_000),
      })
      .strict()
      .default({ max_bytes: 50_000_000 }),
  })
  .strict();

export type NetworkPolicy = z.infer<typeof networkPolicySchema>;
export type NetworkEgressRule = z.infer<typeof egressRule>;

/**
 * Build a strict deny-by-default policy with no egress rules. Useful as a
 * baseline for marketplace/untrusted runs and as a test fixture.
 */
export function denyAllPolicy(): NetworkPolicy {
  return networkPolicySchema.parse({ version: 1, default: 'deny' });
}

/**
 * Permissive policy for trusted local development that still blocks private
 * IPs and metadata endpoints — DNS rebinding defense stays in effect.
 */
export function trustedLocalPolicy(): NetworkPolicy {
  return networkPolicySchema.parse({
    version: 1,
    default: 'allow',
    allow_localhost: true,
  });
}

/**
 * Permissive policy for public external APIs. Unlike trustedLocalPolicy(), it
 * keeps localhost disabled and only allows ordinary HTTPS API calls.
 */
export function externalApiPolicy(): NetworkPolicy {
  return networkPolicySchema.parse({
    version: 1,
    default: 'deny',
    egress: [
      {
        name: 'external-https-api',
        host: '*',
        ports: [443],
        methods: ['GET', 'POST'],
        paths: ['/'],
      },
    ],
  });
}
