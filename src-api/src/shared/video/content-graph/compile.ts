import {
  type ContentGraph,
  DEFAULT_CONTENT_GRAPH_FRAME_DURATION_SEC,
  topoSortContentGraph,
  validateContentGraph,
} from '@neumar/video-ir';

import type { GalleryTemplate } from '@/shared/video/templates/gallery-loader';
import type { Storyboard, StoryboardScene } from '@/shared/video/types';

// Phase 2 M2 — lowering compiler.
//
// Compiles a ContentGraph (narrative IR) into a Storyboard the existing
// Neuma render pipeline already knows how to concatenate. The scenes carry:
//
//   - assetPlan = { kind: 'existing', assetId: HTML_FRAME_PLACEHOLDER_ASSET_ID }
//     (the materializer overwrites assetId once it renders the frame)
//   - htmlFrameSeed = { nodeId, templateId, engine, variables }
//     (a new optional StoryboardScene field consumed only by the materializer)
//
// `AssetPlan` is *not* extended with a new discriminator (20+ existing switch
// sites would have to change). Instead, the scene's `assetPlan.kind` stays
// `'existing'` and the htmlFrameSeed carries the render metadata out-of-band.
//
// See dev-doc/html-video/06-06/01-render-path-plan.md § Phase 2 M2.

/** Placeholder assetId set on freshly-compiled scenes before materialization. */
export const HTML_FRAME_PLACEHOLDER_ASSET_ID = '__html-frame-placeholder__';

const SCENE_ID_PREFIX = 'cg-';

export interface CompileContentGraphOptions {
  /** Template the agent picked. */
  template: GalleryTemplate;
  /** Per-graph variables (forwarded to every scene). Optional. */
  variables?: Record<string, unknown>;
  /** ms offset for the first scene's startMs (informational; pipeline computes timing). */
  startMs?: number;
  /** Default per-node duration when the graph node doesn't set one. */
  defaultDurationSec?: number;
  /** Pre-computed intent for the storyboard; falls back to graph.intent. */
  storyboardIntent?: string;
}

export interface CompiledStoryboard {
  storyboard: Storyboard;
  totalDurationMs: number;
  /** content-graph nodeId → storyboard scene id. */
  nodeIdToSceneId: Record<string, string>;
}

export class ContentGraphCompileError extends Error {
  constructor(public readonly issues: Array<{ message: string }>) {
    super(
      `Content-graph compilation failed: ${issues
        .map((i) => i.message)
        .join('; ')}`,
    );
    this.name = 'ContentGraphCompileError';
  }
}

export function compileContentGraphToStoryboard(
  graph: ContentGraph,
  options: CompileContentGraphOptions,
): CompiledStoryboard {
  const validation = validateContentGraph(graph);
  if (!validation.ok) {
    throw new ContentGraphCompileError(validation.errors);
  }

  const order = topoSortContentGraph(graph);
  const defaultDurationSec =
    options.defaultDurationSec ?? DEFAULT_CONTENT_GRAPH_FRAME_DURATION_SEC;

  // Build a lookup once so the per-node access below is O(1); the previous
  // graph.nodes.find() inside the order loop was O(N²) on graph size.
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  const nodeIdToSceneId: Record<string, string> = {};
  const scenes: StoryboardScene[] = [];
  let totalDurationMs = 0;

  for (const nodeId of order) {
    const node = nodeById.get(nodeId);
    if (!node) {
      // Defensive: topoSort guarantees nodeId in graph.nodes. Skip silently
      // rather than partial-emit; validate() would have surfaced any drift.
      continue;
    }

    const durationSec = node.durationSec ?? defaultDurationSec;
    const durationMs = Math.max(1, Math.round(durationSec * 1000));
    const sceneId = `${SCENE_ID_PREFIX}${node.id}`;
    nodeIdToSceneId[node.id] = sceneId;

    scenes.push({
      id: sceneId,
      durationMs,
      intent: node.frameIntent ?? node.kind,
      assetPlan: {
        kind: 'existing',
        assetId: HTML_FRAME_PLACEHOLDER_ASSET_ID,
      },
      htmlFrameSeed: {
        nodeId: node.id,
        templateId: options.template.id,
        engine: options.template.metadata.engine,
        variables: mergeVariables(options.variables, nodeVariables(node)),
      },
    });
    totalDurationMs += durationMs;
  }

  const storyboard: Storyboard = {
    status: 'draft',
    intent: options.storyboardIntent ?? graph.intent,
    totalDurationMs,
    costEstimateUsd: { low: 0, high: 0 },
    scenes,
  };

  return { storyboard, totalDurationMs, nodeIdToSceneId };
}

function nodeVariables(
  node: ContentGraph['nodes'][number],
): Record<string, unknown> {
  switch (node.kind) {
    case 'entity':
      return node.props ?? {};
    case 'data':
      return { data: node.data };
    case 'text':
      return { text: node.text };
    default:
      return {};
  }
}

function mergeVariables(
  global: Record<string, unknown> | undefined,
  perNode: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!global && Object.keys(perNode).length === 0) return undefined;
  return { ...(global ?? {}), ...perNode };
}
