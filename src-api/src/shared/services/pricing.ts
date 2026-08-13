/**
 * Pricing Service
 *
 * Manages model pricing data stored in `model_pricing` table.
 * Seed defaults on first run; users can override per-model.
 * All costs in micro-dollars per million tokens (1 USD = 1,000,000).
 */

import { getDatabase } from '@/shared/db';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('Pricing');

// ============================================================================
// Types
// ============================================================================

export interface ModelPricing {
  model_id: string;
  provider: string;
  display_name: string;
  input_cost_per_million: number;
  output_cost_per_million: number;
  cache_read_cost_per_million: number;
  cache_creation_cost_per_million: number;
  unit_cost: number;
  unit_type: string | null;
  default_billing_type: 'api' | 'subscription' | 'free';
  is_default: number;
  updated_at: string;
}

export interface CostBreakdown {
  inputCost: number; // micro-dollars
  outputCost: number;
  cacheReadCost: number;
  cacheCreationCost: number;
  totalCost: number;
}

// ============================================================================
// Default Pricing Seed
// ============================================================================

const MICRO = 1_000_000;

const DEPRECATED_DEFAULT_MODEL_IDS = ['claude-fable-5', 'claude-mythos-5'];

const DEFAULT_PRICING: Omit<ModelPricing, 'updated_at'>[] = [
  // Anthropic — prices as of 2026-07 (https://docs.anthropic.com/en/docs/about-claude/pricing)
  // Sonnet 5 values are standard non-batch introductory API rates through
  // 2026-08-31. The schema stores one cache-creation rate, so use the
  // documented 5-minute cache write price; 1-hour cache writes should be
  // modeled separately before 2026-09-01 if billing needs that distinction.
  {
    model_id: 'claude-sonnet-5',
    provider: 'anthropic',
    display_name: 'Sonnet 5',
    input_cost_per_million: 2 * MICRO, // $2/MTok
    output_cost_per_million: 10 * MICRO, // $10/MTok
    cache_read_cost_per_million: 0.2 * MICRO, // $0.20/MTok
    cache_creation_cost_per_million: 2.5 * MICRO, // $2.50/MTok
    unit_cost: 0,
    unit_type: null,
    default_billing_type: 'subscription',
    is_default: 1,
  },
  {
    model_id: 'claude-opus-4-8',
    provider: 'anthropic',
    display_name: 'Opus 4.8',
    input_cost_per_million: 5 * MICRO, // $5/MTok
    output_cost_per_million: 25 * MICRO, // $25/MTok
    cache_read_cost_per_million: 0.5 * MICRO, // $0.50/MTok (0.1× base)
    cache_creation_cost_per_million: 6.25 * MICRO, // $6.25/MTok (1.25× base, 5-min TTL)
    unit_cost: 0,
    unit_type: null,
    default_billing_type: 'subscription',
    is_default: 1,
  },
  {
    model_id: 'claude-opus-4-7',
    provider: 'anthropic',
    display_name: 'Opus 4.7',
    input_cost_per_million: 5 * MICRO, // $5/MTok
    output_cost_per_million: 25 * MICRO, // $25/MTok
    cache_read_cost_per_million: 0.5 * MICRO, // $0.50/MTok (0.1× base)
    cache_creation_cost_per_million: 6.25 * MICRO, // $6.25/MTok (1.25× base, 5-min TTL)
    unit_cost: 0,
    unit_type: null,
    default_billing_type: 'subscription',
    is_default: 1,
  },
  {
    model_id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    display_name: 'Sonnet 4.6',
    input_cost_per_million: 3 * MICRO,
    output_cost_per_million: 15 * MICRO,
    cache_read_cost_per_million: 0.3 * MICRO,
    cache_creation_cost_per_million: 3.75 * MICRO,
    unit_cost: 0,
    unit_type: null,
    default_billing_type: 'subscription',
    is_default: 1,
  },
  {
    model_id: 'claude-haiku-4-5',
    provider: 'anthropic',
    display_name: 'Haiku 4.5',
    input_cost_per_million: 0.8 * MICRO,
    output_cost_per_million: 4 * MICRO,
    cache_read_cost_per_million: 0.08 * MICRO,
    cache_creation_cost_per_million: 1 * MICRO,
    unit_cost: 0,
    unit_type: null,
    default_billing_type: 'subscription',
    is_default: 1,
  },
  // OpenAI
  {
    model_id: 'gpt-4o',
    provider: 'openai',
    display_name: 'GPT-4o',
    input_cost_per_million: 2.5 * MICRO,
    output_cost_per_million: 10 * MICRO,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 0,
    unit_type: null,
    default_billing_type: 'api',
    is_default: 1,
  },
  {
    model_id: 'gpt-4o-mini',
    provider: 'openai',
    display_name: 'GPT-4o Mini',
    input_cost_per_million: 0.15 * MICRO,
    output_cost_per_million: 0.6 * MICRO,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 0,
    unit_type: null,
    default_billing_type: 'api',
    is_default: 1,
  },
  {
    model_id: 'dall-e-3',
    provider: 'openai',
    display_name: 'DALL-E 3',
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 40_000, // $0.04/image
    unit_type: 'image',
    default_billing_type: 'api',
    is_default: 1,
  },
  // Google
  {
    model_id: 'gemini-2.5-flash',
    provider: 'google',
    display_name: 'Gemini 2.5 Flash',
    input_cost_per_million: 0.15 * MICRO,
    output_cost_per_million: 0.6 * MICRO,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 0,
    unit_type: null,
    default_billing_type: 'api',
    is_default: 1,
  },
  {
    model_id: 'gemini-2.5-pro',
    provider: 'google',
    display_name: 'Gemini 2.5 Pro',
    input_cost_per_million: 1.25 * MICRO,
    output_cost_per_million: 10 * MICRO,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 0,
    unit_type: null,
    default_billing_type: 'api',
    is_default: 1,
  },
  // BytePlus ModelArk — Seedream image generation
  // Rates per BytePlus ModelArk pricing docs (2026) — https://docs.byteplus.com/en/docs/ModelArk/1544106
  // Images billed per image (4K/2K tiers); numbers below reflect the standard
  // 2K output. Users on 4K should override via createPricing if needed.
  {
    model_id: 'seedream-5-0-260128',
    provider: 'byteplus',
    display_name: 'Seedream 5.0',
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 35_000, // $0.035 / image (4K)
    unit_type: 'image',
    default_billing_type: 'api',
    is_default: 1,
  },
  {
    model_id: 'seedream-5-0-lite-260128',
    provider: 'byteplus',
    display_name: 'Seedream 5.0 Lite',
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 35_000, // $0.035 / image (4K)
    unit_type: 'image',
    default_billing_type: 'api',
    is_default: 1,
  },
  {
    model_id: 'seedream-4-5-251128',
    provider: 'byteplus',
    display_name: 'Seedream 4.5',
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 30_000, // $0.03 / image (2K)
    unit_type: 'image',
    default_billing_type: 'api',
    is_default: 1,
  },
  {
    model_id: 'seedream-4-0-250828',
    provider: 'byteplus',
    display_name: 'Seedream 4.0',
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 30_000, // $0.03 / image (2K)
    unit_type: 'image',
    default_billing_type: 'api',
    is_default: 1,
  },
  {
    model_id: 'seedream-3-0-t2i-250415',
    provider: 'byteplus',
    display_name: 'Seedream 3.0',
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 20_000, // $0.02 / image
    unit_type: 'image',
    default_billing_type: 'api',
    is_default: 1,
  },
  // BytePlus ModelArk — Seedance video generation
  // Videos billed per output second at 720p 16:9 (the adapter's default).
  // unit_count reports duration in seconds when logging usage.
  {
    model_id: 'dreamina-seedance-2-0-fast-260128',
    provider: 'byteplus',
    display_name: 'Seedance 2.0 Fast',
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 22_000, // $0.022 / second (720p)
    unit_type: 'video_second',
    default_billing_type: 'api',
    is_default: 1,
  },
  {
    model_id: 'dreamina-seedance-2-0-260128',
    provider: 'byteplus',
    display_name: 'Seedance 2.0',
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 60_000, // $0.06 / second (720p)
    unit_type: 'video_second',
    default_billing_type: 'api',
    is_default: 1,
  },
  {
    model_id: 'seedance-1-5-pro-251215',
    provider: 'byteplus',
    display_name: 'Seedance 1.5 Pro',
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 30_000, // $0.03 / second (720p)
    unit_type: 'video_second',
    default_billing_type: 'api',
    is_default: 1,
  },
  {
    model_id: 'seedance-1-0-pro-250626',
    provider: 'byteplus',
    display_name: 'Seedance 1.0 Pro',
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 30_000, // $0.03 / second (720p); 1080p ≈ $0.06/s
    unit_type: 'video_second',
    default_billing_type: 'api',
    is_default: 1,
  },
  {
    model_id: 'seedance-1-0-lite-250328',
    provider: 'byteplus',
    display_name: 'Seedance 1.0 Lite',
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 18_000, // $0.018 / second (720p)
    unit_type: 'video_second',
    default_billing_type: 'api',
    is_default: 1,
  },
  // Embeddings
  {
    model_id: 'text-embedding-3-small',
    provider: 'openai',
    display_name: 'Embedding Small',
    input_cost_per_million: 0.02 * MICRO,
    output_cost_per_million: 0,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 0,
    unit_type: null,
    default_billing_type: 'api',
    is_default: 1,
  },
  {
    model_id: 'text-embedding-004',
    provider: 'google',
    display_name: 'Embedding 004',
    input_cost_per_million: 0,
    output_cost_per_million: 0,
    cache_read_cost_per_million: 0,
    cache_creation_cost_per_million: 0,
    unit_cost: 0,
    unit_type: null,
    default_billing_type: 'api',
    is_default: 1,
  },
];

// ============================================================================
// Functions
// ============================================================================

/** Get pricing for a specific model, with fuzzy matching */
export function getModelPricing(modelId: string): ModelPricing | null {
  const db = getDatabase();

  // Exact match first
  let row = db
    .prepare('SELECT * FROM model_pricing WHERE model_id = ?')
    .get(modelId) as ModelPricing | undefined;

  if (row) return row;

  // Fuzzy match: strip date suffixes (e.g., claude-sonnet-4-5-20250514 → claude-sonnet-4-5)
  const baseModel = modelId.replace(/-\d{8}$/, '');
  if (baseModel !== modelId) {
    row = db
      .prepare('SELECT * FROM model_pricing WHERE model_id = ?')
      .get(baseModel) as ModelPricing | undefined;
    if (row) return row;
  }

  return null;
}

/** Create a pricing entry for a new model (user-defined, not a seed default) */
export function createPricing(params: {
  model_id: string;
  provider: string;
  display_name?: string;
  default_billing_type?: 'api' | 'subscription' | 'free';
}): ModelPricing {
  const db = getDatabase();
  const existing = db
    .prepare('SELECT * FROM model_pricing WHERE model_id = ?')
    .get(params.model_id) as ModelPricing | undefined;
  if (existing) return existing;

  db.prepare(
    `
    INSERT INTO model_pricing (
      model_id, provider, display_name, default_billing_type, is_default, updated_at
    ) VALUES (?, ?, ?, ?, 0, datetime('now'))
  `,
  ).run(
    params.model_id,
    params.provider,
    params.display_name ?? params.model_id,
    params.default_billing_type ?? 'api',
  );
  return db
    .prepare('SELECT * FROM model_pricing WHERE model_id = ?')
    .get(params.model_id) as ModelPricing;
}

/** Rename a pricing record's model_id (when user renames a model) */
export function renamePricing(
  oldModelId: string,
  newModelId: string,
): ModelPricing | null {
  const db = getDatabase();
  const existing = db
    .prepare('SELECT * FROM model_pricing WHERE model_id = ?')
    .get(oldModelId) as ModelPricing | undefined;
  if (!existing) return null;
  db.prepare(
    "UPDATE model_pricing SET model_id = ?, updated_at = datetime('now') WHERE model_id = ?",
  ).run(newModelId, oldModelId);
  return db
    .prepare('SELECT * FROM model_pricing WHERE model_id = ?')
    .get(newModelId) as ModelPricing;
}

/** Get all pricing entries */
export function getAllPricing(): ModelPricing[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM model_pricing ORDER BY provider, display_name')
    .all() as ModelPricing[];
}

/** Update pricing for a model (user override) */
export function updatePricing(
  modelId: string,
  pricing: Partial<
    Pick<
      ModelPricing,
      | 'input_cost_per_million'
      | 'output_cost_per_million'
      | 'cache_read_cost_per_million'
      | 'cache_creation_cost_per_million'
      | 'unit_cost'
      | 'unit_type'
      | 'default_billing_type'
    >
  >,
): ModelPricing | null {
  const db = getDatabase();

  const existing = db
    .prepare('SELECT * FROM model_pricing WHERE model_id = ?')
    .get(modelId) as ModelPricing | undefined;

  if (!existing) return null;

  const ALLOWED_COLUMNS = new Set([
    'input_cost_per_million',
    'output_cost_per_million',
    'cache_read_cost_per_million',
    'cache_creation_cost_per_million',
    'unit_cost',
    'unit_type',
    'default_billing_type',
  ]);

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(pricing)) {
    if (value !== undefined && ALLOWED_COLUMNS.has(key)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) return existing;

  setClauses.push('is_default = 0'); // Mark as user override
  setClauses.push("updated_at = datetime('now')");

  values.push(modelId);

  db.prepare(
    `UPDATE model_pricing SET ${setClauses.join(', ')} WHERE model_id = ?`,
  ).run(...values);

  return db
    .prepare('SELECT * FROM model_pricing WHERE model_id = ?')
    .get(modelId) as ModelPricing;
}

/** Compute cost breakdown for a token-based call */
export function computeCost(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}): CostBreakdown {
  const pricing = getModelPricing(input.model);

  if (!pricing) {
    return {
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheCreationCost: 0,
      totalCost: 0,
    };
  }

  const MILLION = 1_000_000;

  const inputCost = Math.round(
    (input.inputTokens * pricing.input_cost_per_million) / MILLION,
  );
  const outputCost = Math.round(
    (input.outputTokens * pricing.output_cost_per_million) / MILLION,
  );
  const cacheReadCost = Math.round(
    ((input.cacheReadTokens ?? 0) * pricing.cache_read_cost_per_million) /
      MILLION,
  );
  const cacheCreationCost = Math.round(
    ((input.cacheCreationTokens ?? 0) *
      pricing.cache_creation_cost_per_million) /
      MILLION,
  );

  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheCreationCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheCreationCost,
  };
}

/**
 * Seed / refresh default pricing.
 *
 * - INSERT new models that don't exist yet.
 * - UPDATE existing default rows (is_default = 1) so price corrections in
 *   code propagate to live databases without requiring a manual migration.
 * - User-customised rows (is_default = 0) are never touched.
 */
export function seedDefaultPricing(): void {
  const db = getDatabase();

  // Upsert every default model: insert if missing, update costs if it's still
  // a default row (not user-overridden).
  const upsertStmt = db.prepare(`
    INSERT INTO model_pricing (
      model_id, provider, display_name,
      input_cost_per_million, output_cost_per_million,
      cache_read_cost_per_million, cache_creation_cost_per_million,
      unit_cost, unit_type, default_billing_type, is_default,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(model_id) DO UPDATE SET
      provider                    = excluded.provider,
      display_name                = excluded.display_name,
      input_cost_per_million      = excluded.input_cost_per_million,
      output_cost_per_million     = excluded.output_cost_per_million,
      cache_read_cost_per_million = excluded.cache_read_cost_per_million,
      cache_creation_cost_per_million = excluded.cache_creation_cost_per_million,
      unit_cost                   = excluded.unit_cost,
      unit_type                   = excluded.unit_type,
      default_billing_type        = excluded.default_billing_type,
      updated_at                  = datetime('now')
    WHERE model_pricing.is_default = 1
  `);

  const upsertAll = db.transaction(() => {
    for (const modelId of DEPRECATED_DEFAULT_MODEL_IDS) {
      db.prepare(
        'DELETE FROM model_pricing WHERE model_id = ? AND is_default = 1',
      ).run(modelId);
    }

    for (const p of DEFAULT_PRICING) {
      upsertStmt.run(
        p.model_id,
        p.provider,
        p.display_name,
        p.input_cost_per_million,
        p.output_cost_per_million,
        p.cache_read_cost_per_million,
        p.cache_creation_cost_per_million,
        p.unit_cost,
        p.unit_type,
        p.default_billing_type,
        p.is_default,
      );
    }
  });

  upsertAll();
  logger.info(`Refreshed default pricing for ${DEFAULT_PRICING.length} models`);
}
