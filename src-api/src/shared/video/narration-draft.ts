import {
  type ContentGraph,
  type ContentGraphNode,
  topoSortContentGraph,
} from '@neumar/video-ir';

import { createLogger } from '@/shared/utils/logger';
import { readContentGraph } from '@/shared/video/content-graph/persistence';
import { withProjectLock } from '@/shared/video/project-lock';
import { getProject, writeProject } from '@/shared/video/store';

// Phase 5 M3 — narration drafter. The content-graph is the source of frames;
// the agentic runtime (an LLM) composes the spoken lines. This module reads the
// graph to expose the frames to narrate and persists the agent-written lines
// into `project.soundtrack.narrationByFrame`, keyed by content-graph node id.
//
// No second model invocation: the caller (the agent) is the LLM. A standalone,
// non-agent background drafting job is deferred (see the slice plan).

const logger = createLogger('VideoNarrationDraft');

/** Max characters of node copy surfaced as drafting context per frame. */
const FRAME_CONTEXT_MAX_CHARS = 240;

export type NarrationDraftErrorCode =
  | 'no-content-graph'
  | 'unknown-node-id'
  | 'no-lines';

export class NarrationDraftError extends Error {
  constructor(
    public readonly code: NarrationDraftErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NarrationDraftError';
  }
}

/** A single frame the agent should narrate, in render (topo) order. */
export interface NarrationFrame {
  id: string;
  order: number;
  text: string;
  frameIntent?: string;
}

/** Only TextNode carries copy; fall back to label/id for entity/data nodes. */
function nodeNarrationText(node: ContentGraphNode): string {
  const raw = node.kind === 'text' ? node.text : (node.label ?? node.id);
  return raw.replace(/\s+/g, ' ').trim().slice(0, FRAME_CONTEXT_MAX_CHARS);
}

/** Topo-ordered frames for the graph (render order matches the frames strip). */
export function listNarrationFrames(graph: ContentGraph): NarrationFrame[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return topoSortContentGraph(graph).map((id, index) => {
    const node = byId.get(id);
    if (!node) {
      // topoSort should only return ids present in the graph; guard the
      // invariant rather than throwing an opaque TypeError on a malformed graph.
      throw new NarrationDraftError(
        'no-content-graph',
        `Content-graph node "${id}" from topoSort is not in the node set.`,
      );
    }
    return {
      id,
      order: index,
      text: nodeNarrationText(node),
      ...(node.frameIntent ? { frameIntent: node.frameIntent } : {}),
    };
  });
}

/** Read the content-graph and return the frames to narrate (discovery step). */
export async function getNarrationFrames(
  projectId: string,
): Promise<{ frames: NarrationFrame[]; synopsis?: string }> {
  const graph = await readContentGraph(projectId);
  if (!graph || graph.nodes.length === 0) {
    throw new NarrationDraftError(
      'no-content-graph',
      'No content-graph for this project — generate the video frames first.',
    );
  }
  return {
    frames: listNarrationFrames(graph),
    ...(graph.synopsis ? { synopsis: graph.synopsis } : {}),
  };
}

export interface NarrationDraftInput {
  /** Agent-written lines keyed by content-graph node id. */
  linesByFrame?: Record<string, string>;
  /** Convenience single-frame write (with `line`). */
  frameId?: string;
  line?: string;
}

/**
 * Merge agent-written narration lines into `project.soundtrack.narrationByFrame`.
 * Every key is validated against the current content-graph node ids. An empty
 * string is a valid value — it skips narration on that frame (see the
 * ProjectSoundtrack model). Returns the merged map + the keys touched.
 */
export async function applyNarrationDraft(
  projectId: string,
  input: NarrationDraftInput,
): Promise<{ narrationByFrame: Record<string, string>; updated: string[] }> {
  // Input-shape checks need no graph — fail fast before acquiring the lock.
  // Merge both forms rather than treating them as mutually exclusive, so a
  // caller that passes `linesByFrame` *and* a `frameId`/`line` pair never has
  // the single-frame write silently dropped.
  if ((input.frameId === undefined) !== (input.line === undefined)) {
    throw new NarrationDraftError(
      'no-lines',
      '`frameId` and `line` must be provided together.',
    );
  }
  const updates: Record<string, string> = { ...input.linesByFrame };
  if (input.frameId !== undefined && input.line !== undefined) {
    updates[input.frameId] = input.line;
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    throw new NarrationDraftError(
      'no-lines',
      'No narration lines provided — pass linesByFrame, or frameId + line.',
    );
  }

  // Read + validate the graph inside the lock so a concurrent
  // video_write_content_graph can't change the node set between validation and
  // persist (TOCTOU). The locked callback returns a discriminated result rather
  // than throwing — withProjectLock chains its internal bookkeeping promise
  // without a catch, so a throw inside the lock would leak an unhandled
  // rejection. We surface failures as errors after the lock releases.
  const outcome = await withProjectLock(projectId, async () => {
    const graph = await readContentGraph(projectId);
    if (!graph || graph.nodes.length === 0) {
      return { ok: false as const, code: 'no-content-graph' as const };
    }
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    const unknown = keys.filter((id) => !nodeIds.has(id));
    if (unknown.length > 0) {
      return { ok: false as const, code: 'unknown-node-id' as const, unknown };
    }

    const project = await getProject(projectId);
    const narrationByFrame = {
      ...project.soundtrack?.narrationByFrame,
      ...updates,
    };
    await writeProject({
      ...project,
      soundtrack: { ...project.soundtrack, narrationByFrame },
      updatedAt: new Date().toISOString(),
    });
    logger.info(
      `Drafted narration for ${keys.length} frame(s) in project ${projectId}`,
    );
    return { ok: true as const, narrationByFrame };
  });

  if (!outcome.ok) {
    if (outcome.code === 'no-content-graph') {
      throw new NarrationDraftError(
        'no-content-graph',
        'No content-graph for this project — generate the video frames first.',
      );
    }
    throw new NarrationDraftError(
      'unknown-node-id',
      `Not content-graph node ids: ${outcome.unknown.join(', ')}. ` +
        'Call video_draft_narration with no lines to list valid frame ids.',
    );
  }
  return { narrationByFrame: outcome.narrationByFrame, updated: keys };
}
