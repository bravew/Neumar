import type {
  ContentGraph,
  ContentGraphNode,
  ContentGraphValidationIssue,
  ContentGraphValidationResult,
} from './content-graph-types.js';
import { DEFAULT_CONTENT_GRAPH_FRAME_DURATION_SEC } from './content-graph-types.js';

/**
 * Validate a content-graph. Collects all structural errors in one pass so the
 * agent gets a single round-trip of feedback; stops reporting after the first
 * cycle (cycles cascade noisily). Empty graph short-circuits.
 */
export function validateContentGraph(
  graph: ContentGraph,
): ContentGraphValidationResult {
  const errors: ContentGraphValidationIssue[] = [];
  const warnings: ContentGraphValidationIssue[] = [];

  if (!graph.nodes || graph.nodes.length === 0) {
    errors.push({ code: 'empty-graph', message: 'Graph has no nodes' });
    return { ok: false, errors, warnings };
  }

  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) {
      errors.push({
        code: 'duplicate-node-id',
        message: `Duplicate node id "${n.id}"`,
        ref: n.id,
      });
    }
    ids.add(n.id);
    const kind = (n as { kind: string }).kind;
    if (kind !== 'entity' && kind !== 'data' && kind !== 'text') {
      const id = (n as { id: string }).id;
      errors.push({
        code: 'invalid-kind',
        message: `Node "${id}" has unknown kind "${kind}"`,
        ref: id,
      });
    }
  }

  for (const e of graph.edges) {
    const ref = `${e.from}->${e.to}`;
    if (e.from === e.to) {
      errors.push({
        code: 'self-edge',
        message: `Edge ${ref} is a self-edge`,
        ref,
      });
    }
    if (!ids.has(e.from)) {
      errors.push({
        code: 'edge-from-unknown-node',
        message: `Edge from unknown node "${e.from}"`,
        ref,
      });
    }
    if (!ids.has(e.to)) {
      errors.push({
        code: 'edge-to-unknown-node',
        message: `Edge to unknown node "${e.to}"`,
        ref,
      });
    }
  }

  const cycleNode = findDependencyCycle(graph);
  if (cycleNode) {
    errors.push({
      code: 'cycle',
      message: `Dependency cycle detected involving node "${cycleNode}"`,
      ref: cycleNode,
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Topologically sort the content-graph into a frame play order.
 *
 *   - `dependency` is the only hard constraint (Kahn).
 *   - `sequence` is a soft tie-break between independent ready nodes.
 *   - `contrast` is semantic-only and ignored for ordering.
 *
 * Stable by original node order for determinism. Throws on cycle; callers
 * should validate first.
 */
export function topoSortContentGraph(graph: ContentGraph): string[] {
  const indeg = new Map<string, number>();
  const deps = new Map<string, string[]>();
  const nodeOrder = new Map<string, number>();
  graph.nodes.forEach((n, i) => {
    indeg.set(n.id, 0);
    deps.set(n.id, []);
    nodeOrder.set(n.id, i);
  });
  for (const e of graph.edges) {
    if (e.kind !== 'dependency') continue;
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue;
    deps.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }

  const seqAfter = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.kind !== 'sequence') continue;
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue;
    if (!seqAfter.has(e.from)) seqAfter.set(e.from, new Set());
    seqAfter.get(e.from)!.add(e.to);
  }

  const ready: string[] = [];
  for (const [id, d] of indeg) if (d === 0) ready.push(id);
  ready.sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));

  const out: string[] = [];
  while (ready.length > 0) {
    let pickIdx = 0;
    for (let i = 0; i < ready.length; i++) {
      const cand = ready[i]!;
      const blockedBySequence = ready.some(
        (other) => other !== cand && seqAfter.get(other)?.has(cand),
      );
      if (!blockedBySequence) {
        pickIdx = i;
        break;
      }
    }
    const next = ready.splice(pickIdx, 1)[0]!;
    out.push(next);
    for (const succ of deps.get(next) ?? []) {
      indeg.set(succ, (indeg.get(succ) ?? 1) - 1);
      if (indeg.get(succ) === 0) {
        const ord = nodeOrder.get(succ) ?? 0;
        let insertAt = ready.length;
        for (let i = 0; i < ready.length; i++) {
          if ((nodeOrder.get(ready[i]!) ?? 0) > ord) {
            insertAt = i;
            break;
          }
        }
        ready.splice(insertAt, 0, succ);
      }
    }
  }

  if (out.length !== graph.nodes.length) {
    throw new Error(
      `topoSortContentGraph: cycle detected (sorted ${out.length} of ${graph.nodes.length} nodes)`,
    );
  }
  return out;
}

function findDependencyCycle(graph: ContentGraph): string | null {
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    if (e.kind !== 'dependency') continue;
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of adj.keys()) color.set(id, WHITE);
  const stack: { id: string; iter: Iterator<string> }[] = [];
  for (const start of adj.keys()) {
    if (color.get(start) !== WHITE) continue;
    color.set(start, GRAY);
    stack.push({ id: start, iter: adj.get(start)![Symbol.iterator]() });
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const next = top.iter.next();
      if (next.done) {
        color.set(top.id, BLACK);
        stack.pop();
      } else {
        const c = color.get(next.value);
        if (c === GRAY) return next.value;
        if (c === WHITE) {
          color.set(next.value, GRAY);
          stack.push({
            id: next.value,
            iter: adj.get(next.value)![Symbol.iterator](),
          });
        }
      }
    }
  }
  return null;
}

export function getContentGraphNode(
  graph: ContentGraph,
  id: string,
): ContentGraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

/**
 * Sum per-node durations along the topological play order.
 * Nodes without `durationSec` use DEFAULT_CONTENT_GRAPH_FRAME_DURATION_SEC.
 */
export function totalContentGraphDurationSec(graph: ContentGraph): number {
  const order = topoSortContentGraph(graph);
  let total = 0;
  for (const id of order) {
    const node = getContentGraphNode(graph, id);
    total += node?.durationSec ?? DEFAULT_CONTENT_GRAPH_FRAME_DURATION_SEC;
  }
  return total;
}
