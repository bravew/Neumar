import { describe, expect, it } from 'vitest';

import { parseDualBlocks } from '@/shared/video/content-graph/dual-block-parser';

const FENCE = '```';

const block = (lang: string, body: string) =>
  `${FENCE}${lang}\n${body}\n${FENCE}`;

const validGraph = `{
  "schemaVersion": 1,
  "intent": "explainer",
  "nodes": [
    { "id": "intro", "kind": "text", "text": "Hi", "durationSec": 1 }
  ],
  "edges": []
}`;

describe('parseDualBlocks', () => {
  it('parses a canonical pair of blocks: content-graph + one frame', () => {
    const text = [
      'Here is the plan.',
      block('json#content-graph', validGraph),
      'And the intro frame:',
      block('html#intro', '<html><body>Hi</body></html>'),
    ].join('\n\n');
    const result = parseDualBlocks(text);
    expect(result.warnings).toEqual([]);
    expect(result.graph?.nodes[0]?.id).toBe('intro');
    expect(result.frames).toEqual([
      { nodeId: 'intro', html: '<html><body>Hi</body></html>' },
    ]);
  });

  it('tolerates case-insensitive contentGraph tag variants', () => {
    const text = block('JSON#contentGraph', validGraph);
    expect(parseDualBlocks(text).graph?.nodes[0]?.id).toBe('intro');

    const text2 = block('json#content-graph', validGraph);
    expect(parseDualBlocks(text2).graph?.nodes[0]?.id).toBe('intro');
  });

  it('warns on multiple content-graph blocks and keeps the first', () => {
    const text =
      block('json#content-graph', validGraph) +
      '\n\n' +
      block(
        'json#content-graph',
        validGraph.replace('"intro"', '"second-intro"'),
      );
    const result = parseDualBlocks(text);
    expect(result.warnings.some((w) => w.includes('multiple'))).toBe(true);
    expect(result.graph?.nodes[0]?.id).toBe('intro');
  });

  it('warns on invalid JSON inside the graph block', () => {
    const text = block('json#content-graph', '{not json');
    const result = parseDualBlocks(text);
    expect(result.graph).toBeNull();
    expect(result.warnings[0]).toMatch(/JSON parse failed/);
  });

  it('warns on a graph that fails Zod validation', () => {
    const text = block('json#content-graph', '{ "schemaVersion": 99 }');
    const result = parseDualBlocks(text);
    expect(result.graph).toBeNull();
    expect(result.warnings[0]).toMatch(/failed validation/);
  });

  it('keeps multiple frame blocks in order, last-write-wins on duplicates', () => {
    const text = [
      block('html#a', '<a/>'),
      block('html#b', '<b/>'),
      block('html#a', '<a-updated/>'),
    ].join('\n\n');
    const result = parseDualBlocks(text);
    expect(result.frames).toEqual([
      { nodeId: 'b', html: '<b/>' },
      { nodeId: 'a', html: '<a-updated/>' },
    ]);
    expect(result.warnings.some((w) => w.includes('duplicate'))).toBe(true);
  });

  it('warns on a frame block with no nodeId', () => {
    const text = block('html#', '<html/>');
    const result = parseDualBlocks(text);
    expect(result.frames).toEqual([]);
    expect(result.warnings[0]).toMatch(/missing nodeId/);
  });

  it('ignores unrelated code blocks (markdown, generic ```js, etc.)', () => {
    const text = [
      block('js', "console.log('hi')"),
      block('json#content-graph', validGraph),
      block('html#intro', '<frame/>'),
      block('text', 'random'),
    ].join('\n\n');
    const result = parseDualBlocks(text);
    expect(result.graph).not.toBeNull();
    expect(result.frames).toHaveLength(1);
  });

  it('returns empty result on text with no fenced blocks', () => {
    const result = parseDualBlocks('No code fences here at all.');
    expect(result).toEqual({ graph: null, frames: [], warnings: [] });
  });
});
