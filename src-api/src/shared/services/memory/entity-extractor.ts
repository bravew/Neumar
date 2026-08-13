/**
 * Entity Extractor — Extract entities and relationships from memory content.
 *
 * Uses LLM for structured extraction of people, projects, technologies,
 * organizations, and concepts, plus their relationships.
 * Includes entity resolution to avoid duplicates.
 */

import { createLogger } from '@/shared/utils/logger';

import {
  createEntity,
  createEntityEdge,
  findEntityByName,
  updateEntityMention,
} from './store';
import type {
  EntityRelation,
  EntityType,
  LLMCallFn,
  MemoryEntity,
  MemoryEntityEdge,
} from './types';
import { ENTITY_RELATIONS, ENTITY_TYPES } from './types';

const logger = createLogger('EntityExtractor');

interface ExtractedEntity {
  name: string;
  type: EntityType;
  summary?: string;
}

interface ExtractedEdge {
  sourceName: string;
  targetName: string;
  relation: EntityRelation;
  confidence?: number;
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  edges: ExtractedEdge[];
}

const ENTITY_EXTRACTION_PROMPT = `You are an entity extraction system. Extract named entities and their relationships from the text below.

Entity types: person, project, technology, organization, concept
Relationship types: works_on, uses, manages, belongs_to, related_to, depends_on

Rules:
- Only extract clearly mentioned entities (not implied)
- Entity names should be specific (e.g., "React" not "frontend framework")
- Each relationship must reference two entities you extracted
- Rate confidence 0.0-1.0 for relationships
- Return JSON or empty object if nothing worth extracting
- Extract in the original language of the content — do not translate names

Text:
<input>__CONTENT_PLACEHOLDER__</input>

Return ONLY valid JSON:
{"entities": [{"name": "...", "type": "person|project|technology|organization|concept", "summary": "..."}], "edges": [{"source": "...", "target": "...", "relation": "works_on|uses|manages|belongs_to|related_to|depends_on", "confidence": 0.8}]}`;

/**
 * Extract entities and relationships from memory content using LLM.
 */
export async function extractEntities(
  content: string,
  callLLM: LLMCallFn,
): Promise<ExtractionResult> {
  if (content.length < 10) return { entities: [], edges: [] };

  try {
    // Use a unique placeholder to prevent template injection if content
    // happens to contain the placeholder string itself.
    const prompt = ENTITY_EXTRACTION_PROMPT.replace(
      '__CONTENT_PLACEHOLDER__',
      content.slice(0, 1000),
    );
    const response = await callLLM(prompt);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { entities: [], edges: [] };

    const parsed = JSON.parse(jsonMatch[0]) as {
      entities?: Array<{ name: string; type: string; summary?: string }>;
      edges?: Array<{
        source: string;
        target: string;
        relation: string;
        confidence?: number;
      }>;
    };

    const entities: ExtractedEntity[] = (parsed.entities ?? [])
      .filter(
        (e) =>
          e.name &&
          typeof e.name === 'string' &&
          e.name.length > 0 &&
          (ENTITY_TYPES as readonly string[]).includes(e.type),
      )
      .map((e) => ({
        name: e.name.trim(),
        type: e.type as EntityType,
        summary: e.summary?.trim(),
      }));

    const entityNames = new Set(entities.map((e) => e.name.toLowerCase()));

    const edges: ExtractedEdge[] = (parsed.edges ?? [])
      .filter(
        (e) =>
          e.source &&
          e.target &&
          entityNames.has(e.source.toLowerCase()) &&
          entityNames.has(e.target.toLowerCase()) &&
          (ENTITY_RELATIONS as readonly string[]).includes(e.relation),
      )
      .map((e) => ({
        sourceName: e.source.trim(),
        targetName: e.target.trim(),
        relation: e.relation as EntityRelation,
        confidence:
          typeof e.confidence === 'number'
            ? Math.max(0, Math.min(1, e.confidence))
            : 0.7,
      }));

    return { entities, edges };
  } catch (err) {
    logger.warn(`Entity extraction failed: ${err}`);
    return { entities: [], edges: [] };
  }
}

/**
 * Resolve an extracted entity against existing entities.
 * Returns existing entity if a match is found, or creates a new one.
 */
export function resolveEntity(extracted: ExtractedEntity): MemoryEntity {
  // Try exact name match (case-insensitive)
  const existing = findEntityByName(extracted.name);
  if (existing) {
    // Update mention count and last seen
    updateEntityMention(existing.id);
    return existing;
  }

  // Create new entity
  return createEntity({
    name: extracted.name,
    entityType: extracted.type,
    summary: extracted.summary,
  });
}

/**
 * Process extraction results: resolve entities and create edges.
 * Returns the created/resolved entities and edges.
 */
export function processExtractionResults(
  result: ExtractionResult,
  sourceMemoryId?: string,
): {
  entities: MemoryEntity[];
  edges: MemoryEntityEdge[];
} {
  if (result.entities.length === 0) {
    return { entities: [], edges: [] };
  }

  // Resolve all entities (create or find existing)
  const resolvedEntities: MemoryEntity[] = [];
  const nameToId = new Map<string, string>();

  for (const extracted of result.entities) {
    const entity = resolveEntity(extracted);
    resolvedEntities.push(entity);
    nameToId.set(extracted.name.toLowerCase(), entity.id);
  }

  // Create edges between resolved entities
  const createdEdges: MemoryEntityEdge[] = [];

  for (const edge of result.edges) {
    const sourceId = nameToId.get(edge.sourceName.toLowerCase());
    const targetId = nameToId.get(edge.targetName.toLowerCase());

    if (!sourceId || !targetId || sourceId === targetId) continue;

    try {
      const created = createEntityEdge({
        sourceEntityId: sourceId,
        targetEntityId: targetId,
        relation: edge.relation,
        confidence: edge.confidence,
        sourceMemoryId,
      });
      createdEdges.push(created);
    } catch (err) {
      logger.warn(`Failed to create edge: ${err}`);
    }
  }

  logger.info(
    `Entity extraction: ${resolvedEntities.length} entities, ${createdEdges.length} edges`,
  );

  return { entities: resolvedEntities, edges: createdEdges };
}

/**
 * Extract entities from a memory and store them in the graph.
 * Convenience function that combines extraction + resolution.
 */
export async function extractAndStoreEntities(
  memoryContent: string,
  memoryId: string,
  callLLM: LLMCallFn,
): Promise<{
  entities: MemoryEntity[];
  edges: MemoryEntityEdge[];
}> {
  const result = await extractEntities(memoryContent, callLLM);
  return processExtractionResults(result, memoryId);
}
