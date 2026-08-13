import {
  type DesignContextPack,
  type DesignFigmaContext,
  designContextPackSchema,
} from './types';

const MAX_CONTEXT_PACKS = 8;

export function normalizeDesignContextPacks(
  input: unknown,
): DesignContextPack[] {
  const parsed = designContextPackSchema
    .array()
    .max(MAX_CONTEXT_PACKS)
    .parse(input);
  const out: DesignContextPack[] = [];
  const seen = new Set<string>();
  for (const pack of parsed) {
    if (seen.has(pack.id)) continue;
    seen.add(pack.id);
    out.push({
      ...pack,
      figma: pack.figma ? normalizeFigmaContext(pack.figma) : undefined,
      components: pack.components.map((component) => ({
        ...component,
        tokenUsage: [...new Set(component.tokenUsage)],
      })),
      notes: [...new Set(pack.notes)],
    });
  }
  return out;
}

export function buildDesignContextPackPrompt(
  packs: DesignContextPack[],
): string | null {
  if (packs.length === 0) return null;
  return [
    'Use these bounded source context packs as implementation context. They are selected metadata and component facts, not raw MCP output.',
    'Figma references identify the source design file/node. Code Connect components describe production implementation affordances, imports, props, token usage, and source links.',
    'Prefer existing Code Connect component contracts over inventing new component APIs. Keep any file reads or generated assets inside the configured project workspace.',
    '',
    '```json',
    JSON.stringify({ packs }, null, 2),
    '```',
  ].join('\n');
}

function normalizeFigmaContext(figma: DesignFigmaContext): DesignFigmaContext {
  if (!figma.url) return figma;
  const parsed = parseFigmaUrl(figma.url);
  return {
    ...figma,
    fileKey: figma.fileKey ?? parsed.fileKey,
    fileName: figma.fileName ?? parsed.fileName,
    nodeId: figma.nodeId ?? parsed.nodeId,
  };
}

function parseFigmaUrl(urlValue: string): {
  fileKey?: string;
  fileName?: string;
  nodeId?: string;
} {
  try {
    const url = new URL(urlValue);
    const parts = url.pathname.split('/').filter(Boolean);
    return {
      fileKey: parts[1],
      fileName: parts[2] ? decodeURIComponent(parts[2]) : undefined,
      nodeId: url.searchParams.get('node-id') ?? undefined,
    };
  } catch {
    return {};
  }
}
