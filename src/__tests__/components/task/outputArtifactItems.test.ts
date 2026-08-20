import { describe, expect, it } from 'vitest';

import type { Artifact } from '@/components/artifacts/types';
import type { GroupedItem } from '@/components/task/groupMessages';
import { appendOutputArtifactsItem } from '@/components/task/outputArtifactItems';

const ORIGINAL_PATH = '/tmp/output/agent-system-illustration.mp4';
const FINAL_PATH = '/tmp/output/agent-system-illustration_2.mp4';

function video(id: string, path: string): Artifact {
  return {
    id,
    name: path.split('/').at(-1) ?? path,
    path,
    type: 'video',
    isOutput: true,
  };
}

describe('appendOutputArtifactsItem', () => {
  it('previews only deliverables linked by the final assistant answer', () => {
    const items: GroupedItem[] = [
      {
        type: 'message',
        key: 'answer',
        msg: {
          id: 'answer',
          role: 'assistant',
          content: `Final deliverable: [agent-system-illustration_2.mp4](${FINAL_PATH})`,
        },
      },
    ];

    const result = appendOutputArtifactsItem(items, [
      video('original', ORIGINAL_PATH),
      video('final', FINAL_PATH),
    ]);

    expect(result.at(-1)).toMatchObject({
      type: 'output-artifacts',
      artifacts: [{ id: 'final' }],
    });
  });

  it('keeps all previewable outputs when the final answer names none', () => {
    const items: GroupedItem[] = [];
    const result = appendOutputArtifactsItem(items, [
      video('part-1', '/tmp/output/part-1.mp4'),
      video('part-2', '/tmp/output/part-2.mp4'),
    ]);

    expect(result.at(-1)).toMatchObject({
      type: 'output-artifacts',
      artifacts: [{ id: 'part-1' }, { id: 'part-2' }],
    });
  });
});
