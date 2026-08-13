// Neuma port of html-video's content-graph RFC-06 narrative IR.
// Names kept verbatim (kind: entity|data|text, edge kind: sequence|dependency|contrast)
// so future syncs against _sample/html-video diff cleanly.
//
// See dev-doc/html-video/06-05/02-content-graph-and-storyboard-protocol.md.

export type ContentGraphNodeKind = 'entity' | 'data' | 'text';

export interface ContentGraphBaseNode {
  id: string;
  kind: ContentGraphNodeKind;
  label?: string;
  /** Frame intent hint: "intro" | "data-bar" | "quote" | ... */
  frameIntent?: string;
  durationSec?: number;
}

export interface ContentGraphEntityNode extends ContentGraphBaseNode {
  kind: 'entity';
  props: Record<string, unknown>;
}

export interface ContentGraphDataNode extends ContentGraphBaseNode {
  kind: 'data';
  data: unknown;
}

export interface ContentGraphTextNode extends ContentGraphBaseNode {
  kind: 'text';
  text: string;
}

export type ContentGraphNode =
  | ContentGraphEntityNode
  | ContentGraphDataNode
  | ContentGraphTextNode;

export type ContentGraphEdgeKind = 'sequence' | 'contrast' | 'dependency';

export interface ContentGraphEdge {
  from: string;
  to: string;
  kind: ContentGraphEdgeKind;
  reason?: string;
}

export type ContentGraphIntent =
  | 'single-frame'
  | 'explainer'
  | 'data-viz'
  | 'promo'
  | 'comparison'
  | 'other';

export interface ContentGraph {
  schemaVersion: 1;
  intent: ContentGraphIntent;
  synopsis?: string;
  nodes: ContentGraphNode[];
  edges: ContentGraphEdge[];
}

export type ContentGraphValidationCode =
  | 'duplicate-node-id'
  | 'edge-from-unknown-node'
  | 'edge-to-unknown-node'
  | 'self-edge'
  | 'cycle'
  | 'empty-graph'
  | 'invalid-kind';

export interface ContentGraphValidationIssue {
  code: ContentGraphValidationCode;
  message: string;
  ref?: string;
}

export interface ContentGraphValidationResult {
  ok: boolean;
  errors: ContentGraphValidationIssue[];
  warnings: ContentGraphValidationIssue[];
}

export const DEFAULT_CONTENT_GRAPH_FRAME_DURATION_SEC = 3;
