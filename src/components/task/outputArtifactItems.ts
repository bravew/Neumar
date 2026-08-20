import type { Artifact } from '@/components/artifacts/types';

import type { GroupedItem } from './groupMessages';
import { getPreviewableOutputArtifacts } from './outputArtifactMedia';

const REFERENCE_PREFIX = String.raw`(^|[\s([{"'\x60])`;
const REFERENCE_SUFFIX = String.raw`(?=$|[\s)\]},"'\x60.:;!?])`;

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
  const finalAnswer = getFinalAssistantAnswer(items);

  if (!finalAnswer) return artifacts;

  const referenced = artifacts.filter(
    (artifact) =>
      (artifact.path && hasExactReference(finalAnswer, artifact.path)) ||
      hasExactReference(finalAnswer, artifact.name),
  );
  return referenced.length > 0 ? referenced : artifacts;
}

function getFinalAssistantAnswer(items: GroupedItem[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type === 'message' && item.msg.role === 'assistant') {
      return item.msg.content;
    }
  }
  return undefined;
}

function hasExactReference(content: string, reference: string): boolean {
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${REFERENCE_PREFIX}${escaped}${REFERENCE_SUFFIX}`).test(
    content,
  );
}
