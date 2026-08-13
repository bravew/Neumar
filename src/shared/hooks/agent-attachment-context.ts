import type { AttachmentSourceContext } from './agent-types';

interface AttachmentSourceCarrier {
  name?: string;
  sourceContext?: AttachmentSourceContext;
}

type CloudStorageSource = Extract<
  AttachmentSourceContext,
  { kind: 'cloud-storage' }
>;
type AssetCatalogSource = Extract<
  AttachmentSourceContext,
  { kind: 'asset-catalog' }
>;
type SourceCarrier<T extends AttachmentSourceContext> =
  AttachmentSourceCarrier & {
    sourceContext: T;
  };

export function formatAttachmentSourceContext(
  attachments?: readonly AttachmentSourceCarrier[],
): string | undefined {
  const sections = [
    formatCloudStorageContext(attachments),
    formatAssetCatalogContext(attachments),
  ].filter((section): section is string => Boolean(section));
  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

function formatCloudStorageContext(
  attachments?: readonly AttachmentSourceCarrier[],
): string | undefined {
  const cloudAttachments = (attachments ?? []).filter(
    (attachment): attachment is SourceCarrier<CloudStorageSource> =>
      attachment.sourceContext?.kind === 'cloud-storage',
  );
  if (cloudAttachments.length === 0) return undefined;

  const lines = cloudAttachments.map((attachment) => {
    const source = attachment.sourceContext!;
    const label = source.connectionLabel
      ? `, connectionLabel=${formatValue(source.connectionLabel)}`
      : '';
    const itemPath = source.providerItemPath
      ? `, providerItemPath=${formatValue(source.providerItemPath)}`
      : '';
    const itemName = source.providerItemName
      ? `, providerItemName=${formatValue(source.providerItemName)}`
      : '';
    return `- ${formatBareValue(attachment.name ?? 'attachment')}: provider=${formatBareValue(source.connectionProvider)}${label}, connectionId=${formatBareValue(source.connectionId)}, providerItemId=${formatBareValue(source.providerItemId)}${itemName}${itemPath}`;
  });

  return [
    '[CLOUD STORAGE ATTACHMENT CONTEXT - source of picked attachments:',
    ...lines,
    '',
    'If the user asks to publish/upload/save a generated or edited result back to the source, same album, or a label such as "home album", use publish.destinations to match this cloud storage connection. For Immich sources, call publish.start with kind="immich" and the matching connectionId. Do not use Google Photos picker tools for this publish path.]',
  ].join('\n');
}

function formatAssetCatalogContext(
  attachments?: readonly AttachmentSourceCarrier[],
): string | undefined {
  const catalogAttachments = (attachments ?? []).filter(
    (attachment): attachment is SourceCarrier<AssetCatalogSource> =>
      attachment.sourceContext?.kind === 'asset-catalog',
  );
  if (catalogAttachments.length === 0) return undefined;

  const lines = catalogAttachments.map((attachment) => {
    const source = attachment.sourceContext;
    const title = source.assetTitle
      ? `, assetTitle=${formatValue(source.assetTitle)}`
      : '';
    const assetSource = source.assetSource
      ? `, source=${formatBareValue(source.assetSource)}`
      : '';
    const sourceId = source.sourceId
      ? `, sourceId=${formatValue(source.sourceId)}`
      : '';
    const storagePath = source.storagePath
      ? `, storagePath=${formatValue(source.storagePath)}`
      : '';
    return `- ${formatBareValue(attachment.name ?? 'attachment')}: assetId=${formatBareValue(source.assetId)}${assetSource}${title}${sourceId}${storagePath}`;
  });

  return [
    '[ASSET CATALOG ATTACHMENT CONTEXT - source of picked catalog assets:',
    ...lines,
    '',
    'These files came from the workspace asset catalog. Preserve attribution and use the assetId when referring to the catalog source.]',
  ].join('\n');
}

export function prependAttachmentSourceContext(
  prompt: string,
  attachments?: readonly AttachmentSourceCarrier[],
): string {
  const context = formatAttachmentSourceContext(attachments);
  return context ? `${context}\n\n${prompt}` : prompt;
}

function formatValue(value: string): string {
  return JSON.stringify(cleanPromptValue(value));
}

function formatBareValue(value: string): string {
  return cleanPromptValue(value);
}

function cleanPromptValue(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\[|\]/g, '')
    .slice(0, 240);
}
