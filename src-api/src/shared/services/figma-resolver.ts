/**
 * Figma Resolver
 *
 * Extracts Figma URLs from Linear tickets and fetches design data
 * via the Figma REST API for injection into pipeline prompts.
 */

import { createLogger } from '@/shared/utils/logger';

import type { LinearIssue } from './linear';
import type { TicketContext } from './pipeline/prompts';

const logger = createLogger('FigmaResolver');

// ============================================================================
// Types
// ============================================================================

export interface FigmaRef {
  url: string;
  fileKey: string;
  nodeId?: string;
}

export interface FigmaDesignData {
  name: string;
  type: string;
  children?: FigmaDesignData[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  fills?: Array<{
    type: string;
    color?: { r: number; g: number; b: number; a: number };
  }>;
  strokes?: Array<{
    type: string;
    color?: { r: number; g: number; b: number; a: number };
  }>;
  effects?: Array<{ type: string; radius?: number }>;
  layoutMode?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  style?: Record<string, unknown>;
  characters?: string;
}

// ============================================================================
// URL Parsing
// ============================================================================

/**
 * Extract Figma URLs from text.
 * Follows the same inline-regex pattern as parseGitHubUrls() in repo-resolver.ts.
 *
 * Handles:
 * - https://www.figma.com/design/{fileKey}/{fileName}?node-id={nodeId}
 * - https://www.figma.com/file/{fileKey}/{fileName}?node-id={nodeId}
 * - https://figma.com/proto/{fileKey}/{fileName}
 * - Markdown links: [text](https://www.figma.com/design/...)
 */
export function parseFigmaUrls(text: string): FigmaRef[] {
  if (!text) return [];

  const regex =
    /https?:\/\/(?:www\.)?figma\.com\/(?:design|file|proto)\/([a-zA-Z0-9]+)(?:\/[^?\s)]*)?(?:\?[^\s)]*node-id=([^&\s)]+))?/g;
  const found = new Map<string, FigmaRef>();

  let match;
  while ((match = regex.exec(text)) !== null) {
    const fileKey = match[1]!;
    const nodeId = match[2] ? decodeURIComponent(match[2]) : undefined;
    const key = `${fileKey}:${nodeId ?? ''}`;

    if (!found.has(key)) {
      found.set(key, {
        url: match[0],
        fileKey,
        nodeId,
      });
    }
  }

  return Array.from(found.values());
}

// ============================================================================
// Ticket Resolution
// ============================================================================

/**
 * Resolve Figma refs from ticket context.
 * Scans description, comments, and attachments for Figma URLs.
 */
export function resolveFigmaFromTicket(
  issue: LinearIssue,
  ticketCtx?: TicketContext,
): FigmaRef[] {
  const allText: string[] = [];

  // Source 1: Issue description
  if (issue.description) allText.push(issue.description);

  // Source 2: Comments (available via ticketCtx)
  if (ticketCtx?.comments) {
    for (const comment of ticketCtx.comments) {
      allText.push(comment.body);
    }
  }

  // Source 3: Attachments (currently empty — getIssueAttachments() not yet implemented)
  if (ticketCtx?.attachments) {
    for (const attachment of ticketCtx.attachments) {
      allText.push(attachment.url);
      allText.push(attachment.title);
    }
  }

  // Parse all text for Figma URLs, deduplicate across sources
  const allRefs = new Map<string, FigmaRef>();
  for (const text of allText) {
    for (const ref of parseFigmaUrls(text)) {
      const key = `${ref.fileKey}:${ref.nodeId ?? ''}`;
      if (!allRefs.has(key)) allRefs.set(key, ref);
    }
  }

  return Array.from(allRefs.values());
}

// ============================================================================
// Figma REST API
// ============================================================================

/**
 * Fetch design data from Figma REST API.
 * Uses X-Figma-Token header for personal access token auth.
 * Returns null on any error (does not break pipeline).
 */
export async function fetchFigmaDesignData(
  ref: FigmaRef,
  figmaToken: string,
): Promise<FigmaDesignData | null> {
  try {
    const nodeParam = ref.nodeId
      ? `?ids=${encodeURIComponent(ref.nodeId)}`
      : '';
    const endpoint = ref.nodeId
      ? `https://api.figma.com/v1/files/${ref.fileKey}/nodes${nodeParam}`
      : `https://api.figma.com/v1/files/${ref.fileKey}`;

    const response = await fetch(endpoint, {
      headers: { 'X-Figma-Token': figmaToken },
    });

    if (!response.ok) {
      logger.warn(`Figma API returned ${response.status} for ${ref.url}`);
      return null;
    }

    const data = await response.json();

    if (ref.nodeId && data.nodes) {
      const node = data.nodes[ref.nodeId];
      return node?.document ?? null;
    }

    return data.document ?? null;
  } catch (err) {
    logger.warn(`Failed to fetch Figma design data for ${ref.url}:`, err);
    return null;
  }
}

// ============================================================================
// Formatting
// ============================================================================

const MAX_SPEC_LENGTH = 2000;

function formatColor(color: {
  r: number;
  g: number;
  b: number;
  a: number;
}): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  if (color.a < 1) {
    return `rgba(${r}, ${g}, ${b}, ${color.a.toFixed(2)})`;
  }
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function formatNode(node: FigmaDesignData, depth: number = 0): string {
  const indent = '  '.repeat(depth);
  const parts: string[] = [];

  parts.push(`${indent}- ${node.name} (${node.type})`);

  // Layout
  if (node.absoluteBoundingBox) {
    const { width, height } = node.absoluteBoundingBox;
    parts.push(`${indent}  Size: ${width}×${height}`);
  }
  if (node.layoutMode) {
    parts.push(
      `${indent}  Layout: ${node.layoutMode}, gap: ${node.itemSpacing ?? 0}`,
    );
  }
  if (node.paddingTop !== undefined || node.paddingLeft !== undefined) {
    parts.push(
      `${indent}  Padding: ${node.paddingTop ?? 0} ${node.paddingRight ?? 0} ${node.paddingBottom ?? 0} ${node.paddingLeft ?? 0}`,
    );
  }

  // Fills
  if (node.fills?.length) {
    const solidFills = node.fills.filter((f) => f.type === 'SOLID' && f.color);
    if (solidFills.length > 0) {
      parts.push(
        `${indent}  Fill: ${solidFills.map((f) => formatColor(f.color!)).join(', ')}`,
      );
    }
  }

  // Strokes
  if (node.strokes?.length) {
    const solidStrokes = node.strokes.filter(
      (f) => f.type === 'SOLID' && f.color,
    );
    if (solidStrokes.length > 0) {
      parts.push(
        `${indent}  Stroke: ${solidStrokes.map((f) => formatColor(f.color!)).join(', ')}`,
      );
    }
  }

  // Effects
  if (node.effects?.length) {
    for (const effect of node.effects) {
      if (effect.radius !== undefined) {
        parts.push(
          `${indent}  Effect: ${effect.type}, radius: ${effect.radius}`,
        );
      }
    }
  }

  // Text content
  if (node.characters) {
    const text =
      node.characters.length > 100
        ? node.characters.slice(0, 100) + '...'
        : node.characters;
    parts.push(`${indent}  Text: "${text}"`);
  }

  // Children (only one level deep to limit size)
  if (node.children && depth < 2) {
    for (const child of node.children) {
      parts.push(formatNode(child, depth + 1));
    }
  }

  return parts.join('\n');
}

/**
 * Convert raw Figma API response into a readable design spec.
 * Truncates to MAX_SPEC_LENGTH to prevent prompt bloat.
 */
export function formatDesignData(data: FigmaDesignData): string {
  const formatted = formatNode(data);
  if (formatted.length > MAX_SPEC_LENGTH) {
    return formatted.slice(0, MAX_SPEC_LENGTH) + '\n... [truncated]';
  }
  return formatted;
}
