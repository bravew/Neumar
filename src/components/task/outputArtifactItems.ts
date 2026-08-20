import type { Artifact } from '@/components/artifacts/types';

import type { GroupedItem } from './GroupedMessageList';
import { getPreviewableOutputArtifacts } from './outputArtifactMedia';

export function appendOutputArtifactsItem(
  items: GroupedItem[],
  artifacts: Artifact[] | undefined,
): GroupedItem[] {
  const previewableArtifacts = getPreviewableOutputArtifacts(artifacts ?? []);
  const outputArtifacts = selectReferencedDeliverables(
    items,
    previewableArtifacts,
  );
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

function selectReferencedDeliverables(
  items: GroupedItem[],
  artifacts: Artifact[],
): Artifact[] {
  const finalAnswer = items
    .filter((item) => item.type === 'message' && item.msg.role === 'assistant')
    .map((item) => (item.type === 'message' ? item.msg.content : ''))
    .join('\n');

  if (!finalAnswer) return artifacts;

  const referenced = artifacts.filter(
    (artifact) =>
      (artifact.path && finalAnswer.includes(artifact.path)) ||
      finalAnswer.includes(artifact.name),
  );
  return referenced.length > 0 ? referenced : artifacts;
}
