import {
  getDocMediaEntries,
  type NormalizedDocMediaVideoEntry,
  parseDocsMediaCliArgs,
} from './lib/docs-media-config';
import { renderWithHyperframes } from './lib/renderers/hyperframes';
import {
  renderWithRemotion,
  type DocsRenderQuality,
} from './lib/renderers/remotion';

type DocsVideoRenderer = 'remotion' | 'hyperframes' | 'both';

interface RenderCliOptions {
  only?: string;
  dryRun: boolean;
  ci: boolean;
  renderer: DocsVideoRenderer;
  quality: DocsRenderQuality;
}

function parseRenderArgs(): RenderCliOptions {
  const base = parseDocsMediaCliArgs();
  let renderer =
    (process.env.DOCS_VIDEO_RENDERER as DocsVideoRenderer | undefined) ??
    'remotion';
  let quality: DocsRenderQuality = 'standard';

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--renderer=')) {
      renderer = arg.slice('--renderer='.length) as DocsVideoRenderer;
    } else if (arg.startsWith('--quality=')) {
      quality = arg.slice('--quality='.length) as DocsRenderQuality;
    }
  }

  if (!['remotion', 'hyperframes', 'both'].includes(renderer)) {
    throw new Error(`Invalid renderer: ${renderer}`);
  }
  if (!['draft', 'standard', 'high'].includes(quality)) {
    throw new Error(`Invalid quality: ${quality}`);
  }

  return {
    ...base,
    renderer,
    quality,
  };
}

function rendererList(
  renderer: DocsVideoRenderer,
): Array<'remotion' | 'hyperframes'> {
  return renderer === 'both' ? ['remotion', 'hyperframes'] : [renderer];
}

async function renderEntry(
  entry: NormalizedDocMediaVideoEntry,
  renderer: 'remotion' | 'hyperframes',
  options: RenderCliOptions,
) {
  if (renderer === 'remotion') {
    return renderWithRemotion(entry, options);
  }
  return renderWithHyperframes(entry, options);
}

async function main() {
  const options = parseRenderArgs();
  const entries = getDocMediaEntries({ only: options.only }).filter(
    (entry): entry is NormalizedDocMediaVideoEntry => entry.kind === 'video',
  );

  if (options.only && entries.length === 0) {
    throw new Error(`No video docs media entries match --only=${options.only}`);
  }

  const renderers = rendererList(options.renderer);
  console.log(
    `Docs render plan: ${entries.length} entrie(s), renderer=${options.renderer}, quality=${options.quality}`,
  );

  for (const entry of entries) {
    const results = await Promise.all(
      renderers.map((renderer) => renderEntry(entry, renderer, options)),
    );
    for (const result of results) {
      if (!options.dryRun) {
        console.log(
          `  ${result.renderer} ${result.entryId}: ${result.outputPath}`,
        );
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
