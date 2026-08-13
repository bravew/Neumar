import { describe, expect, it } from 'vitest';

import {
  type ContentGraph,
  ContentGraphSchema,
  topoSortContentGraph,
  totalContentGraphDurationSec,
  validateContentGraph,
} from '../src/index.js';

const baseGraph = (
  partial: Partial<ContentGraph> & {
    nodes: ContentGraph['nodes'];
    edges?: ContentGraph['edges'];
  },
): ContentGraph => ({
  schemaVersion: 1,
  intent: 'explainer',
  nodes: partial.nodes,
  edges: partial.edges ?? [],
  synopsis: partial.synopsis,
});

describe('content-graph IR', () => {
  it('rejects empty graphs', () => {
    const result = validateContentGraph(baseGraph({ nodes: [] }));
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('empty-graph');
  });

  it('detects duplicate node ids, self-edges, and unknown endpoints', () => {
    const graph = baseGraph({
      nodes: [
        { id: 'a', kind: 'text', text: 'hi' },
        { id: 'a', kind: 'text', text: 'dup' },
      ],
      edges: [
        { from: 'a', to: 'a', kind: 'sequence' },
        { from: 'a', to: 'missing', kind: 'dependency' },
      ],
    });
    const result = validateContentGraph(graph);
    expect(result.ok).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('duplicate-node-id');
    expect(codes).toContain('self-edge');
    expect(codes).toContain('edge-to-unknown-node');
  });

  it('detects dependency cycles but ignores contrast/sequence for ordering', () => {
    const cycleGraph = baseGraph({
      nodes: [
        { id: 'a', kind: 'text', text: '1' },
        { id: 'b', kind: 'text', text: '2' },
      ],
      edges: [
        { from: 'a', to: 'b', kind: 'dependency' },
        { from: 'b', to: 'a', kind: 'dependency' },
      ],
    });
    expect(validateContentGraph(cycleGraph).ok).toBe(false);

    const contrastOnly = baseGraph({
      nodes: [
        { id: 'a', kind: 'text', text: '1' },
        { id: 'b', kind: 'text', text: '2' },
      ],
      edges: [
        { from: 'a', to: 'b', kind: 'contrast' },
        { from: 'b', to: 'a', kind: 'contrast' },
      ],
    });
    expect(validateContentGraph(contrastOnly).ok).toBe(true);
  });

  it('topo-sorts honouring dependency edges and sequence tie-breaks', () => {
    const graph = baseGraph({
      nodes: [
        { id: 'c', kind: 'text', text: 'c' },
        { id: 'a', kind: 'text', text: 'a' },
        { id: 'b', kind: 'text', text: 'b' },
      ],
      edges: [
        { from: 'a', to: 'b', kind: 'sequence' },
        { from: 'b', to: 'c', kind: 'dependency' },
      ],
    });
    expect(topoSortContentGraph(graph)).toEqual(['a', 'b', 'c']);
  });

  it('sums durations using the default for unset nodes', () => {
    const graph = baseGraph({
      nodes: [
        { id: 'a', kind: 'text', text: '1', durationSec: 4 },
        { id: 'b', kind: 'text', text: '2' },
      ],
    });
    expect(totalContentGraphDurationSec(graph)).toBe(4 + 3);
  });

  it('Zod schema round-trips a valid graph and rejects an invalid one', () => {
    const ok = ContentGraphSchema.safeParse(
      baseGraph({ nodes: [{ id: 'a', kind: 'text', text: 'hi' }] }),
    );
    expect(ok.success).toBe(true);
    const bad = ContentGraphSchema.safeParse({
      schemaVersion: 1,
      intent: 'explainer',
      nodes: [{ id: '!!bad', kind: 'text', text: 'hi' }],
      edges: [],
    });
    expect(bad.success).toBe(false);
  });
});
