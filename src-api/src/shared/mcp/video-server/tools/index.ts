import { searchBroll, downloadBrollHit } from '@/shared/video/broll';
import { transcribeAsset, syncCaptions } from '@/shared/video/captions';
import { drainVideoJobs } from '@/shared/video/jobs';
import {
  attachLinkedAsset,
  enqueueLinkedSourceSync,
  listLinkedFolderChildren,
  listLinkedSources,
  previewLinkedAsset,
  searchLinkedAssets,
} from '@/shared/video/linked-sources';
import { renderProject } from '@/shared/video/pipeline';
import { runBoundedVideoQaLoop } from '@/shared/video/qa-loop';
import { reframeProject } from '@/shared/video/reframe/pipeline';
import {
  analyzeSource,
  applyCutPlan,
  approveStoryboard,
  createCutPlan,
  generateStoryboardDraft,
  getPackedTranscript,
  importSource,
  inspectSourceRange,
} from '@/shared/video/store';
import { synthesizeTtsPreview } from '@/shared/video/tts';

export interface VideoMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: 'object',
  properties,
  required,
});

export const videoMcpTools: VideoMcpTool[] = [
  {
    name: 'import_source',
    description: 'Import a local source video path into a video project.',
    inputSchema: objectSchema(
      {
        project_id: { type: 'string' },
        path: { type: 'string' },
        userConfirmedRights: { type: 'boolean' },
      },
      ['project_id', 'path', 'userConfirmedRights'],
    ),
    handler: async (args) => {
      if (args.userConfirmedRights !== true) {
        throw new Error('userConfirmedRights must be true');
      }
      return importSource(String(args.project_id), {
        path: String(args.path),
        origin: 'workspace-path',
        rights: { userConfirmed: true },
      });
    },
  },
  {
    name: 'analyze_source',
    description: 'Analyze an imported source video and return cut candidates.',
    inputSchema: objectSchema(
      { project_id: { type: 'string' }, source_id: { type: 'string' } },
      ['project_id', 'source_id'],
    ),
    handler: (args) =>
      analyzeSource(String(args.project_id), String(args.source_id)),
  },
  {
    name: 'suggest_cuts',
    description: 'Return a draft cut plan from existing source analysis.',
    inputSchema: objectSchema(
      { project_id: { type: 'string' }, source_id: { type: 'string' } },
      ['project_id', 'source_id'],
    ),
    handler: (args) =>
      createCutPlan(String(args.project_id), String(args.source_id), {
        approved: false,
        mode: 'review-only',
      }),
  },
  {
    name: 'get_packed_transcript',
    description:
      'Read packed word-level transcript context for an analyzed source.',
    inputSchema: objectSchema(
      { project_id: { type: 'string' }, source_id: { type: 'string' } },
      ['project_id'],
    ),
    handler: (args) =>
      getPackedTranscript(
        String(args.project_id),
        typeof args.source_id === 'string' ? args.source_id : undefined,
      ),
  },
  {
    name: 'inspect_source_range',
    description:
      'Generate compact source-range evidence with filmstrip, waveform, and word labels.',
    inputSchema: objectSchema(
      {
        project_id: { type: 'string' },
        source_id: { type: 'string' },
        start_ms: { type: 'number' },
        end_ms: { type: 'number' },
        frame_count: { type: 'number' },
        waveform_bins: { type: 'number' },
      },
      ['project_id', 'source_id', 'start_ms', 'end_ms'],
    ),
    handler: (args) =>
      inspectSourceRange(String(args.project_id), String(args.source_id), {
        startMs: requiredNumber(args.start_ms, 'start_ms'),
        endMs: requiredNumber(args.end_ms, 'end_ms'),
        frameCount:
          typeof args.frame_count === 'number' ? args.frame_count : undefined,
        waveformBins:
          typeof args.waveform_bins === 'number'
            ? args.waveform_bins
            : undefined,
      }),
  },
  {
    name: 'apply_cut_plan',
    description: 'Apply an approved source cut plan.',
    inputSchema: objectSchema(
      { project_id: { type: 'string' }, cut_plan_id: { type: 'string' } },
      ['project_id', 'cut_plan_id'],
    ),
    handler: (args) =>
      applyCutPlan(String(args.project_id), String(args.cut_plan_id)),
  },
  {
    name: 'run_bounded_qa',
    description:
      'Render a preview and run core QA with a host-enforced retry cap.',
    inputSchema: objectSchema(
      {
        project_id: { type: 'string' },
        max_iterations: { type: 'number' },
        aspect_ratio: { type: 'string' },
      },
      ['project_id'],
    ),
    handler: (args) =>
      runBoundedVideoQaLoop({
        projectId: String(args.project_id),
        maxIterations:
          typeof args.max_iterations === 'number'
            ? args.max_iterations
            : undefined,
        aspectRatio:
          args.aspect_ratio === '16:9' ||
          args.aspect_ratio === '9:16' ||
          args.aspect_ratio === '1:1' ||
          args.aspect_ratio === '4:5'
            ? args.aspect_ratio
            : undefined,
      }),
  },
  {
    name: 'plan_storyboard',
    description: 'Generate a draft storyboard for a project.',
    inputSchema: objectSchema({ project_id: { type: 'string' } }, [
      'project_id',
    ]),
    handler: (args) => generateStoryboardDraft(String(args.project_id)),
  },
  {
    name: 'approve_storyboard',
    description: 'Approve the current storyboard and queue generation jobs.',
    inputSchema: objectSchema({ project_id: { type: 'string' } }, [
      'project_id',
    ]),
    handler: (args) => approveStoryboard(String(args.project_id)),
  },
  {
    name: 'generate_clip',
    description: 'Run queued generation work for approved AI clip scenes.',
    inputSchema: objectSchema({ project_id: { type: 'string' } }, [
      'project_id',
    ]),
    handler: async (args) => ({
      project_id: String(args.project_id),
      processed: await drainVideoJobs(),
    }),
  },
  {
    name: 'tts',
    description: 'Synthesize narration preview audio.',
    inputSchema: objectSchema(
      { project_id: { type: 'string' }, text: { type: 'string' } },
      ['project_id', 'text'],
    ),
    handler: (args) =>
      synthesizeTtsPreview(String(args.project_id), {
        text: String(args.text),
      }),
  },
  {
    name: 'transcribe',
    description: 'Transcribe an asset into Subtitle[] timing data.',
    inputSchema: objectSchema(
      { project_id: { type: 'string' }, asset_id: { type: 'string' } },
      ['project_id', 'asset_id'],
    ),
    handler: (args) =>
      transcribeAsset(String(args.project_id), String(args.asset_id)),
  },
  {
    name: 'sync_captions',
    description: 'Project captions through the current scene timeline.',
    inputSchema: objectSchema({ project_id: { type: 'string' } }, [
      'project_id',
    ]),
    handler: (args) => syncCaptions(String(args.project_id), {}),
  },
  {
    name: 'render_remotion',
    description: 'Prepare caption overlay data for the render pipeline.',
    inputSchema: objectSchema({ project_id: { type: 'string' } }, [
      'project_id',
    ]),
    handler: (_args) => {
      throw new Error(
        'render_remotion is not yet implemented — call sync_captions to project ' +
          'captions through scene timing, then encode_ffmpeg to render. ' +
          'Remotion overlay rendering will land in a later phase.',
      );
    },
  },
  {
    name: 'encode_ffmpeg',
    description: 'Render an approved storyboard to MP4.',
    inputSchema: objectSchema({ project_id: { type: 'string' } }, [
      'project_id',
    ]),
    handler: (args) => renderProject(String(args.project_id)),
  },
  {
    name: 'reframe',
    description:
      'Create a vertical or square reframe plan from the 16:9 master.',
    inputSchema: objectSchema(
      {
        project_id: { type: 'string' },
        aspect_ratio: { enum: ['9:16', '1:1'] },
      },
      ['project_id', 'aspect_ratio'],
    ),
    handler: (args) =>
      reframeProject(
        String(args.project_id),
        args.aspect_ratio === '1:1' ? '1:1' : '9:16',
      ),
  },
  {
    name: 'pick_broll',
    description: 'Search and optionally download a B-roll hit.',
    inputSchema: objectSchema(
      {
        project_id: { type: 'string' },
        query: { type: 'string' },
        download: { type: 'boolean' },
      },
      ['project_id', 'query'],
    ),
    handler: async (args) => {
      const hits = await searchBroll({ query: String(args.query), limit: 4 });
      if (args.download === true && hits[0]) {
        return downloadBrollHit(String(args.project_id), hits[0]);
      }
      return { hits };
    },
  },
  {
    name: 'list_linked_sources',
    description:
      'List linked folders/sources available to the video agent for context, B-roll, or references.',
    inputSchema: objectSchema({ project_id: { type: 'string' } }, [
      'project_id',
    ]),
    handler: async (args) => {
      const sources = await listLinkedSources(String(args.project_id));
      return sources.map((source) => ({
        id: source.id,
        displayName: source.displayName,
        provider: source.provider,
        role: source.role,
        indexState: source.index.state,
        fileCount: source.index.fileCount ?? 0,
      }));
    },
  },
  {
    name: 'search_linked_assets',
    description:
      'Read-only semantic and filename search across linked video asset sources.',
    inputSchema: objectSchema(
      {
        project_id: { type: 'string' },
        query: { type: 'string' },
        kind: { enum: ['image', 'video', 'audio'] },
        role: { enum: ['context', 'b-roll', 'reference'] },
        source_ids: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number' },
      },
      ['project_id', 'query'],
    ),
    handler: async (args) => {
      const data = await searchLinkedAssets(String(args.project_id), {
        query: String(args.query ?? ''),
        kind:
          args.kind === 'image' ||
          args.kind === 'video' ||
          args.kind === 'audio'
            ? args.kind
            : undefined,
        role:
          args.role === 'context' ||
          args.role === 'b-roll' ||
          args.role === 'reference'
            ? args.role
            : undefined,
        sourceIds: Array.isArray(args.source_ids)
          ? args.source_ids.map(String)
          : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      });
      return data.results.map((hit) => ({
        assetId: hit.asset.id,
        name: hit.asset.name,
        kind: hit.asset.kind,
        durationMs: hit.asset.durationMs,
        score: hit.score,
        matchedOn: hit.matchedOn,
        thumbnailUrl: hit.thumbnailUrl,
        sourceDisplayName: hit.sourceDisplayName,
      }));
    },
  },
  {
    name: 'list_folder_children',
    description:
      'List one page of children under a linked folder source without attaching files.',
    inputSchema: objectSchema(
      {
        project_id: { type: 'string' },
        source_id: { type: 'string' },
        path: { type: 'string' },
        page: { type: 'string' },
      },
      ['project_id', 'source_id'],
    ),
    handler: (args) =>
      listLinkedFolderChildren(String(args.project_id), {
        sourceId: String(args.source_id),
        path: typeof args.path === 'string' ? args.path : undefined,
        page: typeof args.page === 'string' ? args.page : undefined,
      }),
  },
  {
    name: 'preview_asset',
    description:
      'Preview metadata and thumbnail information for a linked asset before attaching it.',
    inputSchema: objectSchema(
      { project_id: { type: 'string' }, asset_id: { type: 'string' } },
      ['project_id', 'asset_id'],
    ),
    handler: (args) =>
      previewLinkedAsset(String(args.project_id), String(args.asset_id)),
  },
  {
    name: 'attach_asset',
    description:
      'Attach a linked asset to the project or a scene after user approval.',
    inputSchema: objectSchema(
      {
        project_id: { type: 'string' },
        asset_id: { type: 'string' },
        scene_id: { type: 'string' },
        role: { enum: ['asset', 'reference'] },
      },
      ['project_id', 'asset_id'],
    ),
    handler: (args) =>
      attachLinkedAsset(String(args.project_id), String(args.asset_id), {
        sceneId: typeof args.scene_id === 'string' ? args.scene_id : undefined,
        role: args.role === 'reference' ? 'reference' : 'asset',
      }),
  },
  {
    name: 'sync_source',
    description: 'Queue a linked source sync job.',
    inputSchema: objectSchema(
      {
        project_id: { type: 'string' },
        source_id: { type: 'string' },
        depth: { type: 'number' },
      },
      ['project_id', 'source_id'],
    ),
    handler: (args) =>
      enqueueLinkedSourceSync(
        String(args.project_id),
        String(args.source_id),
        typeof args.depth === 'number' ? args.depth : undefined,
      ),
  },
  {
    name: 'compose',
    description:
      'Convenience tool: approve the storyboard and render the project.',
    inputSchema: objectSchema({ project_id: { type: 'string' } }, [
      'project_id',
    ]),
    handler: async (args) => {
      await approveStoryboard(String(args.project_id));
      return renderProject(String(args.project_id));
    },
  },
];

function requiredNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  return value;
}
