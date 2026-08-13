import { describe, expect, it } from 'vitest';

import {
  createCompleteToolCallState,
  createExecutingToolCallState,
  createInProgressToolCallState,
  parseToolCallArgs,
} from '@/shared/lib/tool-call-state';

describe('tool-call state helpers', () => {
  it('parses complete JSON args', () => {
    expect(
      parseToolCallArgs('{"file_path":"graph.mmd","content":"A-->B"}'),
    ).toEqual({
      file_path: 'graph.mmd',
      content: 'A-->B',
    });
  });

  it('extracts useful partial string args from streaming JSON', () => {
    expect(
      parseToolCallArgs(
        '{"file_path":"graph.mmd","content":"flowchart LR\\nA-->B',
      ),
    ).toEqual({
      file_path: 'graph.mmd',
      content: 'flowchart LR\nA-->B',
    });
  });

  it('models in-progress, executing, and complete phases', () => {
    expect(createInProgressToolCallState('{"path":"a.md"}')).toMatchObject({
      phase: 'inProgress',
      partialArgs: { path: 'a.md' },
    });
    expect(createExecutingToolCallState('{"path":"a.md"}')).toMatchObject({
      phase: 'executing',
      args: { path: 'a.md' },
    });
    expect(createCompleteToolCallState('{"path":"a.md"}', 'ok')).toMatchObject({
      phase: 'complete',
      args: { path: 'a.md' },
      result: 'ok',
    });
  });
});
