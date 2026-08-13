/**
 * Marketplace schema
 *
 * Wire-compatible with Anthropic's `marketplace.json` (see
 * https://code.claude.com/docs/en/plugin-marketplaces). A marketplace is a
 * JSON document hosted at a stable URL (e.g. GitHub Pages, GitHub raw,
 * a team's own CDN) that advertises a list of plugins. Each plugin entry
 * points to its install source (relative path, URL, or `github:owner/repo`).
 *
 * Unknown fields are stripped (Zod default) rather than passed through: we
 * declare every field the app actually reads — including the `source` object's
 * install-target keys and adapter-derived `metadata.neuma` hints — so a
 * third-party catalog can't smuggle arbitrary JSON into the parsed result.
 */

import { z } from 'zod';

import { SEMVER_RE } from './manifest';

const OwnerField = z.union([
  z.string().min(1).max(200),
  z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().optional(),
    url: z.string().url().optional(),
  }),
]);

const RepositoryField = z.union([
  z.string().url(),
  z.object({ type: z.string().min(1), url: z.string().url() }),
]);

/** A single plugin listing inside a marketplace document. */
export const MarketplacePluginSchema = z.object({
  name: z.string().min(1).max(128),
  /**
   * `./` relative path, absolute URL (https only), `github:owner/repo[@ref]`,
   * or the upstream object form. The object keys are exactly what
   * `resolvePluginFetchTarget` reads for each install kind.
   */
  source: z.union([
    z.string().min(1).max(500),
    z.object({
      source: z.string().min(1).max(50),
      repo: z.string().min(1).max(200).optional(),
      ref: z.string().min(1).max(200).optional(),
      sha: z.string().min(1).max(200).optional(),
      path: z.string().min(1).max(400).optional(),
      url: z.string().min(1).max(1000).optional(),
    }),
  ]),
  description: z.string().min(1).max(2000),
  version: z.string().regex(SEMVER_RE).optional(),
  displayName: z.string().min(1).max(200).optional(),
  author: OwnerField.optional(),
  homepage: z.string().url().optional(),
  repository: RepositoryField.optional(),
  license: z.string().min(1).max(100).optional(),
  keywords: z.array(z.string().min(1).max(50)).max(40).optional(),
  category: z.string().min(1).max(100).optional(),
  tags: z.array(z.string().min(1).max(50)).max(40).optional(),
  strict: z.boolean().optional(),
  /**
   * Neuma hints the Open Design adapter derives from a catalog entry
   * (surface routing, capability summary). Declared explicitly so the values
   * the marketplace UI reads survive parsing without a blanket passthrough.
   */
  metadata: z
    .object({
      neuma: z
        .object({
          surfaces: z.array(z.string().min(1).max(50)).max(4).optional(),
          capabilitiesSummary: z
            .array(z.string().min(1).max(100))
            .max(50)
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

export const MarketplaceSchema = z.object({
  name: z.string().min(1).max(200),
  owner: OwnerField.optional(),
  metadata: z
    .object({
      description: z.string().max(2000).optional(),
      version: z.string().max(50).optional(),
    })
    .optional(),
  plugins: z.array(MarketplacePluginSchema).max(1000),
});

export type Marketplace = z.infer<typeof MarketplaceSchema>;
export type MarketplacePlugin = z.infer<typeof MarketplacePluginSchema>;

export interface MarketplaceParseResult {
  ok: boolean;
  marketplace?: Marketplace;
  issues: string[];
}

/** Never throws. Returns a flat issue list on parse / schema failure. */
export function parseMarketplace(jsonText: string): MarketplaceParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, issues: [`Invalid JSON: ${(err as Error).message}`] };
  }
  const result = MarketplaceSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map(
        (i) => `${i.path.join('.') || '<root>'}: ${i.message}`,
      ),
    };
  }
  return { ok: true, marketplace: result.data, issues: [] };
}
