import type { Artifact } from '@/components/artifacts/types';

import type { GroupedItem } from './GroupedMessageList';
import { getPreviewableOutputArtifacts } from './outputArtifactMedia';

export function appendOutputArtifactsItem(
  items: GroupedItem[],
  artifacts: Artifact[] | undefined,
): GroupedItem[] {
  const outputArtifacts = getPreviewableOutputArtifacts(artifacts ?? []);
  if (outputArtifacts.length === 0) return items;
  return [
    ...items,
    {
      type: 'output-artifacts',
      key: `outputs-${outputArtifacts.map((a) => a.id).join('-')}`,
      artifacts: outputArtifacts,
    },
  ];
}
