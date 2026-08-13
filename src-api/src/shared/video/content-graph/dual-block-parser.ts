import { type ContentGraph, ContentGraphSchema } from '@neumar/video-ir';

// Phase 2 M3 — tolerant dual-block parser.
//
// Reference: _sample/html-video/cli/src/studio-server.ts (the studio
// server's prompt-output parser, kept liberal to handle agents that
// stream prose between blocks).
//
// Used as a fallback for MCP runtimes that don't tool-call cleanly:
// the agent's free-text response is scanned for ```json#content-graph
// (or ```json#contentGraph, case-insensitive) and ```html#<nodeId>
// blocks. Validation errors surface as warnings, not throws.

export interface DualBlockFrame {
  nodeId: string;
  html: string;
}

export interface DualBlockParseResult {
  graph: ContentGraph | null;
  frames: DualBlockFrame[];
  warnings: string[];
}

const FENCE = '```';

interface RawBlock {
  language: string;
  tag?: string;
  body: string;
}

/**
 * Tolerantly parse the dual-block protocol out of a free-text agent
 * response. Returns the parsed `ContentGraph` (or null) plus any
 * per-frame HTML overrides. Validation issues surface as warnings.
 */
export function parseDualBlocks(text: string): DualBlockParseResult {
  const blocks = extractCodeBlocks(text);
  const warnings: string[] = [];
  const frames: DualBlockFrame[] = [];
  let graph: ContentGraph | null = null;
  const seenFrameIds = new Set<string>();

  for (const block of blocks) {
    if (isContentGraphBlock(block)) {
      if (graph) {
        warnings.push(
          'parseDualBlocks: multiple `json#content-graph` blocks found; using the first.',
        );
        continue;
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(block.body);
      } catch (err) {
        warnings.push(
          `parseDualBlocks: content-graph JSON parse failed: ${
            (err as Error).message
          }`,
        );
        continue;
      }
      const safe = ContentGraphSchema.safeParse(parsedJson);
      if (!safe.success) {
        warnings.push(
          `parseDualBlocks: content-graph failed validation: ${safe.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
        );
        continue;
      }
      graph = safe.data;
      continue;
    }

    if (isHtmlFrameBlock(block)) {
      const nodeId = block.tag!.trim();
      if (!nodeId) {
        warnings.push(
          'parseDualBlocks: ```html#<nodeId> block missing nodeId; skipped.',
        );
        continue;
      }
      if (seenFrameIds.has(nodeId)) {
        warnings.push(
          `parseDualBlocks: duplicate frame "${nodeId}"; later occurrence kept.`,
        );
        // Replace the prior occurrence with the later one — matches the
        // upstream studio parser's "last write wins" behaviour.
        const existingIdx = frames.findIndex((f) => f.nodeId === nodeId);
        if (existingIdx >= 0) frames.splice(existingIdx, 1);
      }
      frames.push({ nodeId, html: block.body });
      seenFrameIds.add(nodeId);
    }
  }

  return { graph, frames, warnings };
}

/** Find every triple-backtick block in `text`, capturing the info string. */
function extractCodeBlocks(text: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const openIdx = text.indexOf(FENCE, cursor);
    if (openIdx === -1) break;
    const infoEnd = text.indexOf('\n', openIdx + FENCE.length);
    if (infoEnd === -1) break;
    const infoLine = text.slice(openIdx + FENCE.length, infoEnd).trim();
    const closeIdx = text.indexOf(FENCE, infoEnd + 1);
    if (closeIdx === -1) break;
    const body = text.slice(infoEnd + 1, closeIdx).replace(/\n$/, '');
    const { language, tag } = splitInfoLine(infoLine);
    blocks.push({ language, tag, body });
    cursor = closeIdx + FENCE.length;
  }
  return blocks;
}

function splitInfoLine(info: string): { language: string; tag?: string } {
  const hashIdx = info.indexOf('#');
  if (hashIdx === -1) return { language: info.toLowerCase() };
  return {
    language: info.slice(0, hashIdx).toLowerCase(),
    tag: info.slice(hashIdx + 1),
  };
}

function isContentGraphBlock(block: RawBlock): boolean {
  if (block.language !== 'json') return false;
  if (!block.tag) return false;
  const tag = block.tag.toLowerCase().replace(/-/g, '');
  return tag === 'contentgraph';
}

function isHtmlFrameBlock(block: RawBlock): boolean {
  // tag === '' means the agent wrote ```html# with no nodeId — still treated
  // as a malformed html-frame block so the caller surfaces the warning.
  return block.language === 'html' && block.tag !== undefined;
}
