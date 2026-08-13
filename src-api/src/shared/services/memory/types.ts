/**
 * Memory System — Types, Zod Schemas, and Row Mapper
 *
 * Defines all types used across the memory system:
 * - Memory categories and core record shapes
 * - Cognitive memory types, scopes, decay, lifecycle
 * - Entity graph types
 * - DB row ↔ app model mapping
 * - API input/output validation via Zod
 * - Configuration defaults
 */

import { z } from 'zod';

// ── Categories ──

export const MEMORY_CATEGORIES = [
  'preference',
  'fact',
  'decision',
  'entity',
  'other',
  // v2 cognitive categories
  'interaction',
  'tool_pattern',
  'correction',
  'workflow',
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

// ── Memory Types (v2) ──

export const MEMORY_TYPES = [
  'episodic',
  'semantic',
  'procedural',
  'pinned',
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

// ── Scope Types (v2) ──

export const SCOPE_TYPES = ['global', 'profile', 'project', 'session'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

// ── Lifecycle Status (v2) ──

export const LIFECYCLE_STATUSES = ['active', 'stale', 'archived'] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

// ── Visibility (v3) ──

export const VISIBILITY_TYPES = ['private', 'team'] as const;
export type VisibilityType = (typeof VISIBILITY_TYPES)[number];

// ── Core memory record (as read from DB) ──

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  importance: number;
  source: 'manual' | 'auto_capture' | 'mcp_tool' | 'api';
  sessionId: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  hasEmbedding: boolean;
  createdAt: string;
  updatedAt: string;
  // v2 fields
  memoryType: MemoryType;
  scopeType: ScopeType;
  scopeId: string | null;
  decayRate: number;
  lastAccessedStrength: number;
  confidence: number;
  validFrom: string | null;
  validUntil: string | null;
  parentId: string | null;
  consolidatedFrom: string[] | null;
  lifecycleStatus: LifecycleStatus;
  language: string | null;
  metadata: Record<string, unknown> | null;
  // v3 fields
  visibility: VisibilityType;
}

// ── DB row shape (snake_case — matches SQLite column names) ──

export interface MemoryRow {
  id: string;
  content: string;
  category: string;
  importance: number;
  source: string;
  session_id: string | null;
  access_count: number;
  last_accessed_at: string | null;
  has_embedding: number;
  created_at: string;
  updated_at: string;
  // v2 columns
  memory_type: string;
  scope_type: string;
  scope_id: string | null;
  decay_rate: number;
  last_accessed_strength: number;
  confidence: number;
  valid_from: string | null;
  valid_until: string | null;
  parent_id: string | null;
  consolidated_from: string | null;
  lifecycle_status: string;
  language: string | null;
  metadata: string | null;
  // v3 columns
  visibility: string;
}

// ── Input types ──

export interface CreateMemoryInput {
  content: string;
  category?: MemoryCategory;
  importance?: number;
  source?: Memory['source'];
  sessionId?: string;
  // v2 fields
  memoryType?: MemoryType;
  scopeType?: ScopeType;
  scopeId?: string;
  decayRate?: number;
  confidence?: number;
  validFrom?: string;
  validUntil?: string;
  language?: string;
  metadata?: Record<string, unknown>;
  // v3 fields
  visibility?: VisibilityType;
}

export interface UpdateMemoryInput {
  content?: string;
  category?: MemoryCategory;
  importance?: number;
  // v2 fields
  memoryType?: MemoryType;
  scopeType?: ScopeType;
  scopeId?: string;
  confidence?: number;
  validFrom?: string;
  validUntil?: string;
  lifecycleStatus?: LifecycleStatus;
  language?: string;
  metadata?: Record<string, unknown>;
  // v3 fields
  visibility?: VisibilityType;
}

export interface SearchMemoryInput {
  query: string;
  limit?: number;
  threshold?: number;
  category?: MemoryCategory;
  // v2 fields
  memoryType?: MemoryType;
  scopeType?: ScopeType;
  scopeId?: string;
  lifecycleStatus?: LifecycleStatus;
  scope?: {
    profileId?: string;
    projectId?: string;
    sessionId?: string;
  };
}

// ── Search result ──

export interface MemorySearchResult {
  memory: Memory;
  score: number;
}

// ── Stats ──

export interface MemoryStats {
  total: number;
  byCategory: Record<MemoryCategory, number>;
  withEmbeddings: number;
  oldestMemory: string | null;
  newestMemory: string | null;
  // v2 stats
  byType?: Record<MemoryType, number>;
  byScope?: Record<ScopeType, number>;
  byLifecycle?: Record<LifecycleStatus, number>;
}

// ── Entity Graph Types (v2) ──

export interface MemoryEntity {
  id: string;
  name: string;
  entityType: 'person' | 'project' | 'technology' | 'organization' | 'concept';
  summary: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  mentionCount: number;
  metadata: Record<string, unknown> | null;
}

export type EntityType = MemoryEntity['entityType'];

export const ENTITY_TYPES = [
  'person',
  'project',
  'technology',
  'organization',
  'concept',
] as const;

export interface MemoryEntityEdge {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relation: string;
  confidence: number;
  validFrom: string | null;
  validUntil: string | null;
  sourceMemoryId: string | null;
  createdAt: string;
}

export const ENTITY_RELATIONS = [
  'works_on',
  'uses',
  'manages',
  'belongs_to',
  'related_to',
  'depends_on',
] as const;

export type EntityRelation = (typeof ENTITY_RELATIONS)[number];

// ── Entity DB row shapes ──

export interface MemoryEntityRow {
  id: string;
  name: string;
  entity_type: string;
  summary: string | null;
  first_seen_at: string;
  last_seen_at: string;
  mention_count: number;
  metadata: string | null;
}

export interface MemoryEntityEdgeRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation: string;
  confidence: number;
  valid_from: string | null;
  valid_until: string | null;
  source_memory_id: string | null;
  created_at: string;
}

// ── Consolidation Log ──

export interface ConsolidationLogEntry {
  id: string;
  runAt: string;
  memoriesReviewed: number;
  memoriesMerged: number;
  memoriesArchived: number;
  memoriesPruned: number;
  entitiesCreated: number;
  edgesCreated: number;
  durationMs: number;
}

// ── Decay Configuration (v2) ──

export interface DecayConfig {
  enabled: boolean;
  episodicHalfLife: number; // days (default: 7)
  semanticHalfLife: number; // days (default: 30)
  proceduralHalfLife: number; // days (default: 90)
  pruneThreshold: number; // minimum strength to keep (default: 0.05)
  accessResetFactor: number; // how much access resets decay (default: 1.0)
}

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  enabled: true,
  episodicHalfLife: 7,
  semanticHalfLife: 30,
  proceduralHalfLife: 90,
  pruneThreshold: 0.05,
  accessResetFactor: 1.0,
};

// ── Consolidation Configuration (v2) ──

export interface ConsolidationConfig {
  enabled: boolean;
  intervalDays: number; // run every N days (default: 7)
  minMemoriesForRun: number; // don't run if fewer than N memories (default: 50)
  maxMergePerRun: number; // cap merges per consolidation (default: 20)
  similarityThreshold: number; // semantic similarity for merge candidates (default: 0.85)
}

export const DEFAULT_CONSOLIDATION_CONFIG: ConsolidationConfig = {
  enabled: false,
  intervalDays: 7,
  minMemoriesForRun: 50,
  maxMergePerRun: 20,
  similarityThreshold: 0.85,
};

// ── Capture Guard Levels (v2) ──

export type CaptureGuardLevel = 'strict' | 'standard' | 'relaxed';

export const GUARD_THRESHOLDS: Record<
  CaptureGuardLevel,
  { explicit: number; implicit: number }
> = {
  strict: { explicit: 0.85, implicit: 0.8 },
  standard: { explicit: 0.65, implicit: 0.72 },
  relaxed: { explicit: 0.5, implicit: 0.62 },
};

// ── Configuration ──

export interface MemoryConfig {
  enabled: boolean;
  autoCapture: boolean;
  autoRecall: boolean;
  embeddingProvider: 'local' | 'openai' | 'gemini';
  embeddingApiKey: string;
  embeddingModel: string;
  maxMemories: number;
  captureMaxChars: number;
  recallLimit: number;
  recallThreshold: number;
  // Phase 7 additions
  embeddingDim: number; // Tracked dimension — detects provider changes (7B)
  llmCapture: boolean; // Enable LLM-based capture (7C)
  llmCaptureInterval: number; // Run LLM capture every N turns (7C)
  sessionIndexing: boolean; // Enable session transcript indexing (7D)
  // v2 additions
  decayEnabled: boolean;
  consolidationEnabled: boolean;
  entityExtractionEnabled: boolean;
  captureGuardLevel: CaptureGuardLevel;
  // v3 additions (memdir-inspired)
  llmRerankEnabled: boolean;
  llmRerankModel: string;
  maxRecallTokens: number;
  journalMode: boolean;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  autoCapture: true,
  autoRecall: true,
  embeddingProvider: 'local',
  embeddingApiKey: '',
  embeddingModel: '',
  maxMemories: 10000,
  captureMaxChars: 500,
  recallLimit: 5,
  recallThreshold: 0.3,
  // Phase 7 defaults
  embeddingDim: 768,
  llmCapture: false,
  llmCaptureInterval: 5,
  sessionIndexing: true,
  // v2 defaults — opt-in initially
  decayEnabled: false,
  consolidationEnabled: false,
  entityExtractionEnabled: false,
  captureGuardLevel: 'standard',
  // v3 defaults (memdir-inspired)
  llmRerankEnabled: false,
  llmRerankModel: 'haiku',
  maxRecallTokens: 1500,
  journalMode: false,
};

// ── Zod schemas for API validation ──

export const createMemorySchema = z.object({
  content: z.string().min(1).max(10000),
  category: z.enum(MEMORY_CATEGORIES).optional(),
  importance: z.number().min(0).max(1).optional(),
  // v2 fields
  memoryType: z.enum(MEMORY_TYPES).optional(),
  scopeType: z.enum(SCOPE_TYPES).optional(),
  scopeId: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  language: z.string().max(10).optional(),
  // v3 fields
  visibility: z.enum(VISIBILITY_TYPES).optional(),
});

export const updateMemorySchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  category: z.enum(MEMORY_CATEGORIES).optional(),
  importance: z.number().min(0).max(1).optional(),
  // v2 fields
  memoryType: z.enum(MEMORY_TYPES).optional(),
  scopeType: z.enum(SCOPE_TYPES).optional(),
  scopeId: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  lifecycleStatus: z.enum(LIFECYCLE_STATUSES).optional(),
  language: z.string().max(10).optional(),
  // v3 fields
  visibility: z.enum(VISIBILITY_TYPES).optional(),
});

export const searchMemorySchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  threshold: z.number().min(0).max(1).optional(),
  category: z.enum(MEMORY_CATEGORIES).optional(),
  // v2 fields
  memoryType: z.enum(MEMORY_TYPES).optional(),
  scopeType: z.enum(SCOPE_TYPES).optional(),
  scopeId: z.string().optional(),
  lifecycleStatus: z.enum(LIFECYCLE_STATUSES).optional(),
});

// ── Row → Memory mapper ──

/** Convert a snake_case DB row into a camelCase Memory object. */
export function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    category: row.category as MemoryCategory,
    importance: row.importance,
    source: row.source as Memory['source'],
    sessionId: row.session_id,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at,
    hasEmbedding: row.has_embedding === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // v2 fields
    memoryType: (row.memory_type as MemoryType) ?? 'semantic',
    scopeType: (row.scope_type as ScopeType) ?? 'global',
    scopeId: row.scope_id ?? null,
    decayRate: row.decay_rate ?? 0.023,
    lastAccessedStrength: row.last_accessed_strength ?? 1.0,
    confidence: row.confidence ?? 0.7,
    validFrom: row.valid_from ?? null,
    validUntil: row.valid_until ?? null,
    parentId: row.parent_id ?? null,
    consolidatedFrom: row.consolidated_from
      ? (JSON.parse(row.consolidated_from) as string[])
      : null,
    lifecycleStatus: (row.lifecycle_status as LifecycleStatus) ?? 'active',
    language: row.language ?? null,
    metadata: row.metadata
      ? (JSON.parse(row.metadata) as Record<string, unknown>)
      : null,
    // v3 fields
    visibility: (row.visibility as VisibilityType) ?? 'private',
  };
}

// ── Entity row mappers ──

export function rowToEntity(row: MemoryEntityRow): MemoryEntity {
  return {
    id: row.id,
    name: row.name,
    entityType: row.entity_type as MemoryEntity['entityType'],
    summary: row.summary,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    mentionCount: row.mention_count,
    metadata: row.metadata
      ? (JSON.parse(row.metadata) as Record<string, unknown>)
      : null,
  };
}

export function rowToEntityEdge(row: MemoryEntityEdgeRow): MemoryEntityEdge {
  return {
    id: row.id,
    sourceEntityId: row.source_entity_id,
    targetEntityId: row.target_entity_id,
    relation: row.relation,
    confidence: row.confidence,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    sourceMemoryId: row.source_memory_id,
    createdAt: row.created_at,
  };
}

// ── LLM callback type (used across multiple modules) ──

export type LLMCallFn = (prompt: string) => Promise<string>;

// ── Shared helpers ──

const MS_PER_DAY = 86_400_000;

/** Calculate the number of full days since a given ISO date string. */
export function daysSince(dateString: string): number {
  return Math.floor((Date.now() - Date.parse(dateString)) / MS_PER_DAY);
}
