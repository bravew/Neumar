import {
  type ContentGraph,
  DEFAULT_CONTENT_GRAPH_FRAME_DURATION_SEC,
  topoSortContentGraph,
  totalContentGraphDurationSec,
} from '@neumar/video-ir';

import type { EvalCase } from '../types';

// Phase 7 gate — a multi-frame content-graph resolves to the expected scene
// count (one frame per node, topo-ordered) and total duration. Deterministic:
// no render, no LLM — guards the IR → frames contract the materializer relies on.

function graph(): ContentGraph {
  return {
    schemaVersion: 1,
    intent: 'explainer',
    nodes: [
      { id: 'a', kind: 'text', text: 'one', durationSec: 4 },
      { id: 'b', kind: 'text', text: 'two', durationSec: 6 },
      { id: 'c', kind: 'text', text: 'three' }, // no duration → default
    ],
    edges: [
      { from: 'a', to: 'b', kind: 'sequence' },
      { from: 'b', to: 'c', kind: 'sequence' },
    ],
  };
}

const evalCase: EvalCase = {
  id: 'video-content-graph-shape',
  name: 'Multi-frame content-graph resolves to expected scene count + duration',
  tier: 'gate',
  touchfiles: ['packages/video-ir/src/content-graph.ts'],
  budget: { maxUsd: 0, timeoutMs: 10_000 },
  run: () => {
    const g = graph();
    const order = topoSortContentGraph(g);
    const duration = totalContentGraphDurationSec(g);
    const expectedDuration = 4 + 6 + DEFAULT_CONTENT_GRAPH_FRAME_DURATION_SEC;

    const sceneCountOk =
      order.length === 3 &&
      order[0] === 'a' &&
      order[1] === 'b' &&
      order[2] === 'c';
    const durationOk = duration === expectedDuration;
    const passed = sceneCountOk && durationOk;

    return {
      passed,
      score: passed ? 1 : 0,
      notes: passed
        ? `${order.length} frames, ${duration}s`
        : `order=${order.join(',')} duration=${duration} expected=${expectedDuration}`,
      metrics: { sceneCount: order.length, durationSec: duration },
    };
  },
};

export default evalCase;
