import path from 'node:path';

import { isReferencedProjectAsset } from './catalog-assets';
import {
  readContentGraph,
  readSelectedTemplate,
  readTemplateVariables,
} from './content-graph/persistence';
import { buildCurrentVideoContext } from './editor-context';
import type { VideoResearchBrief } from './plugins/atoms/research';
import type { VideoPluginPromptContext } from './plugins/runtime';
import { getVideoProjectRoot } from './store';
import {
  loadTemplateGallery,
  resolveDefaultTemplateGalleryRoots,
} from './templates/gallery-loader';
import type {
  VideoEditorSelectionContext,
  VideoProject,
  VideoTranscriptSelectionContext,
} from './types';

export interface VideoHtmlTemplatePromptContext {
  selectedTemplateId?: string;
  selectedTemplate?: {
    id: string;
    name: string;
    engine: string;
    category: string;
    tags: string[];
    license: string;
  };
  variables?: Record<string, unknown>;
  contentGraph?: {
    intent: string;
    nodeCount: number;
    edgeCount: number;
    nodes: Array<{
      id: string;
      kind: string;
      durationSec?: number;
      text?: string;
    }>;
  };
  warning?: string;
}

export interface VideoSessionPromptContext {
  selectedSceneId?: string;
  projectAssetIds?: string[];
  aspectRatio?: string;
  transcriptSelection?: VideoTranscriptSelectionContext;
  editorSelection?: VideoEditorSelectionContext;
  recipe?: {
    id: string;
    version: number;
    systemPrompt: string;
    defaults: Record<string, unknown>;
  };
  researchBrief?: VideoResearchBrief;
  plugin?: VideoPluginPromptContext;
  catalogContext?: string;
  htmlTemplateContext?: VideoHtmlTemplatePromptContext;
}

export async function buildVideoHtmlTemplateContext(
  projectId: string,
): Promise<VideoHtmlTemplatePromptContext | undefined> {
  const [selectedTemplateId, variables, contentGraph] = await Promise.all([
    readSelectedTemplate(projectId),
    readTemplateVariables(projectId),
    readContentGraph(projectId),
  ]);
  if (!selectedTemplateId && !variables && !contentGraph) return undefined;

  const context: VideoHtmlTemplatePromptContext = {
    ...(selectedTemplateId ? { selectedTemplateId } : {}),
    ...(variables ? { variables } : {}),
    ...(contentGraph
      ? {
          contentGraph: {
            intent: contentGraph.intent,
            nodeCount: contentGraph.nodes.length,
            edgeCount: contentGraph.edges.length,
            nodes: contentGraph.nodes.map((node) => ({
              id: node.id,
              kind: node.kind,
              ...('durationSec' in node && node.durationSec !== undefined
                ? { durationSec: node.durationSec }
                : {}),
              ...('text' in node && typeof node.text === 'string'
                ? { text: node.text.slice(0, 240) }
                : {}),
            })),
          },
        }
      : {}),
  };

  if (!selectedTemplateId) return context;

  try {
    const roots = resolveDefaultTemplateGalleryRoots(
      getVideoProjectRoot(projectId),
    );
    const gallery = await loadTemplateGallery({ ...roots, ttlMs: 0 });
    const template = gallery.templates.find(
      (candidate) => candidate.id === selectedTemplateId,
    );
    if (template) {
      context.selectedTemplate = {
        id: template.id,
        name: template.metadata.name,
        engine: template.metadata.engine,
        category: template.metadata.category,
        tags: template.metadata.tags ?? [],
        license: template.metadata.license.spdx,
      };
    } else {
      context.warning = `Selected template "${selectedTemplateId}" was not found in the gallery.`;
    }
  } catch (error) {
    context.warning = error instanceof Error ? error.message : String(error);
  }

  return context;
}

export function buildVideoSessionPrompt(
  project: VideoProject,
  context: VideoSessionPromptContext = {},
): string {
  const selectedScene = context.selectedSceneId
    ? project.storyboard?.scenes.find(
        (scene) => scene.id === context.selectedSceneId,
      )
    : undefined;
  const selectedProjectAssets =
    context.projectAssetIds && context.projectAssetIds.length > 0
      ? context.projectAssetIds.flatMap((assetId) => {
          const asset = project.assets.find(
            (candidate) => candidate.id === assetId,
          );
          return asset ? [asset] : [];
        })
      : [];
  const projectRoot = getVideoProjectRoot(project.id);
  return [
    'You are the Video Mode editing agent. Use only the scoped Video Mode MCP tools for project edits.',
    'Do not edit project files directly. Ask for approval before destructive, costly, render, or publish operations.',
    context.recipe
      ? [
          '## Active Recipe',
          `Recipe: ${context.recipe.id}@${context.recipe.version}`,
          context.recipe.systemPrompt,
          `Defaults: ${JSON.stringify(context.recipe.defaults)}`,
        ].join('\n')
      : '',
    context.plugin
      ? [
          context.plugin.promptGuide,
          formatPluginConfigPromptBlock(context.plugin),
          'Stage checklist:',
          ...context.plugin.stageChecklist.map((stage) => `- [ ] ${stage}`),
          'Respect each stage order. For repeat stages, continue until the declared condition is met or a gated tool is unavailable; explain any skipped optional stage.',
        ].join('\n')
      : '',
    '## Project Summary',
    JSON.stringify(
      {
        id: project.id,
        name: project.name,
        template: project.template,
        prompt: project.prompt,
        storyboardStatus: project.storyboard?.status,
        sceneCount: project.storyboard?.scenes.length ?? 0,
        assetCount: project.assets.length,
        timeline: project.timeline
          ? {
              durationMs: project.timeline.durationMs,
              fps: project.timeline.fps,
              tracks: project.timeline.tracks.length,
            }
          : null,
        render: project.render
          ? {
              status: project.render.status,
              outputPath: project.render.outputPath,
            }
          : null,
        projectAssets: project.assets
          .slice(0, 12)
          .map((asset) => summarizeProjectAsset(asset, projectRoot)),
        selectedSceneId: context.selectedSceneId,
        selectedProjectAssetIds: context.projectAssetIds,
        aspectRatio: context.aspectRatio,
        transcriptSelection: context.transcriptSelection
          ? {
              sceneId: context.transcriptSelection.sceneId,
              clipId: context.transcriptSelection.clipId,
              startMs: context.transcriptSelection.startMs,
              endMs: context.transcriptSelection.endMs,
              text: context.transcriptSelection.text.slice(0, 500),
            }
          : undefined,
        editorSelection: context.editorSelection
          ? {
              playheadMs: context.editorSelection.playheadMs,
              selectedClipIds: context.editorSelection.selectedClipIds,
              previewFrame: context.editorSelection.previewFrame,
              activePanel: context.editorSelection.activePanel,
            }
          : undefined,
      },
      null,
      2,
    ),
    [
      '## Timeline Editing Workflow',
      'Use compact timeline reads before edits: call video_get_timeline_window for a known time range, or video_find_clips for text/clip lookup.',
      'For timeline mutations, prefer video_apply_timeline_ops over one-off video_apply_timeline_op so related changes apply atomically and undo as one batch.',
      'For transcript-selection edits, use video_apply_timeline_ops with resolverRefs.transcriptSelection when possible, or a concrete clip.removeTimeRange op using the active transcriptSelection startMs/endMs.',
      'For pronouns like "this", "selected", "current image/video/clip", or framing/crop requests, call video_get_current_context first with include ["selection","previewFrame","timelineWindow","assets"] as needed.',
      'For visual fit/crop/reposition/scale edits, target the selected visual clip and use video_apply_timeline_ops with a clip.setTransform op. Preserve existing transform values unless the user asked to change them. For "fit", "contain", or "show the whole image/video" requests, set transform.fit to "contain" and remove transform.crop; do not crop.',
      'Vivid overlay clips (kind "effect") expose their editable surface as an `overlay` field in context and timeline reads: presetId, loop, and typed controls (id, type, current value, min/max/options). Change overlay text, colors, sizes, or loop with video_set_overlay_controls — never remove and re-insert the clip for a parameter change. When the user says "the overlay" and exactly one overlay clip is selected, pass clipId "selection".',
      'Animate numeric vivid overlay controls with video_set_overlay_control_keyframes. Do not keyframe text, color, select, or toggle controls; use video_set_overlay_controls for static values. For overlay path motion, use video_set_keyframes on transform properties such as positionX, positionY, scale, rotation, and opacity.',
      'Apply named overlay motion recipes with video_apply_overlay_motion_template. Valid templateId values are entrance.fade-up, entrance.scale-in, emphasis.pulse, emphasis.shake, attention.ping, exit.fade-out, and ambient.float; strength is subtle, normal, or strong. The tool replaces only the template affected keyframe tracks and records motionTemplate provenance on the overlay.',
      'To recreate an overlay seen in reference footage ("make an overlay like the one in this video"): sample 4-8 frames around the moment (video_analyze_image / frame extraction), identify the overlay\'s type, text, colors (as hex), placement, and rough timing from the frames, call video_list_overlay_presets and match against the preset tags (the classifier label space), then save the bounded result. Use video_save_overlay_style_from_template when you extracted transform/keyframes/tags or want a reusable style; use video_save_overlay_preset only for a simple controls-only bookmark.',
      'Only synthesize and save a custom overlay HTML document after the user explicitly opts into custom document generation. Then call video_save_user_overlay_document with userConfirmed true; lint errors are blocking and must be surfaced. Prefer closest preset + params for particle systems, 3D effects, uncertain fonts, or anything that would need timers/network/media inside an overlay document.',
      'When video_list_overlay_presets returns taste metadata, treat it as operational routing guidance: `bestFor` is positive fit, `avoidWhen` should veto or demote mismatched presets, `restraint` limits stacking attention-grabbing or ambient overlays, `reducedMotion` is the fallback choice, and `motionTokens` describe the intended timing feel. Briefly explain why you chose or avoided a taste-tagged overlay when the choice is not obvious.',
      'Set magnetic: true on primary video cuts/trims when downstream clips should ripple. Mention ripple impact in your analysis before applying.',
      'Preview or analyze the intended edit in your response before running a destructive batch, unless the user explicitly asked you to apply it immediately.',
      'For editor handoff requests, call video_get_handoff_conformance first, explain unverified targets and degradations, then queue video_export_editor_handoff only after approval. Never write raw XML/EDL/OTIO yourself.',
      'For factual or current-event videos, use WebSearch/WebFetch and video_fetch_source as needed, then call video_record_research_brief so the storyboard draft can reuse the grounded findings and citations.',
      'Do not read or edit project.json directly; the project state contract is the scoped video MCP tools.',
    ].join('\n'),
    context.researchBrief
      ? [
          '## Research Brief',
          JSON.stringify(
            {
              topic: context.researchBrief.topic,
              depth: context.researchBrief.depth,
              findings: context.researchBrief.findings.slice(0, 12),
              facts: context.researchBrief.facts,
              suggestedBeats: context.researchBrief.suggestedBeats?.slice(
                0,
                12,
              ),
              citations: context.researchBrief.citations.slice(0, 12),
              createdAt: context.researchBrief.createdAt,
            },
            null,
            2,
          ),
          'Use these findings for scene intents, captions, and b-roll queries. Preserve citation URLs in any source/provenance summary.',
        ].join('\n')
      : '',
    context.editorSelection || context.selectedSceneId
      ? [
          '## Active Editor Context',
          JSON.stringify(
            buildCurrentVideoContext(project, {
              selectedSceneId: context.selectedSceneId,
              aspectRatio: context.aspectRatio,
              editorSelection: context.editorSelection,
              include: ['scene', 'selection', 'previewFrame'],
            }),
            null,
            2,
          ),
        ].join('\n')
      : '',
    context.htmlTemplateContext
      ? [
          '## HTML / Motion Template Context',
          JSON.stringify(context.htmlTemplateContext, null, 2),
          'Use video_search_templates or video_inspect_template before changing templates. ' +
            'Use video_select_template to pick a gallery template, video_write_content_graph ' +
            'and video_write_frame_html for live HTML frame edits, and video_save_as_template ' +
            'when the user asks to reuse this HTML/Motion video later.',
        ].join('\n')
      : '',
    context.catalogContext ?? '',
    selectedScene
      ? [
          '## Selected Scene',
          JSON.stringify(
            {
              id: selectedScene.id,
              intent: selectedScene.intent,
              durationMs: selectedScene.durationMs,
              caption: selectedScene.caption?.text,
              assetPlan: selectedScene.assetPlan,
            },
            null,
            2,
          ),
        ].join('\n')
      : '',
    selectedProjectAssets.length > 0
      ? [
          '## Selected Project Assets',
          JSON.stringify(
            selectedProjectAssets.map((asset) =>
              summarizeProjectAsset(asset, projectRoot),
            ),
            null,
            2,
          ),
          'These are the project assets the user explicitly selected for this turn. Treat references like "these assets", "selected assets", or "the selected video/image/audio" as pointing here.',
          'For selected image edits like reducing reflections, glare, cleanup, retouching, enhancement, or background fixes: call mcp__media__media_generate_image once with reference_image_url set to the selected asset filePath and a short targeted edit prompt. Do not write or run Python/Pillow scripts, Read scripts, or create custom file-processing code; those paths do not return project assets reliably. The media output hook will register the returned File path as a project asset.',
          'If a selected image asset is referenced or requiresHydration, call video_attach_asset with only { assetId } first; omit sceneId so it downloads/hydrates the project asset without placing it on a scene. Then use the returned asset.filePath as mcp__media__media_generate_image reference_image_url. Do not pass catalog:, thumbnailUrl, local API proxy URLs, or cloud source URLs as reference_image_url.',
        ].join('\n')
      : '',
    context.transcriptSelection
      ? [
          '## Active Transcript Selection',
          JSON.stringify(
            {
              sceneId: context.transcriptSelection.sceneId,
              clipId: context.transcriptSelection.clipId,
              startMs: context.transcriptSelection.startMs,
              endMs: context.transcriptSelection.endMs,
              text: context.transcriptSelection.text,
            },
            null,
            2,
          ),
          'When the user says "this", "the selected part", or asks to cut/remove/tighten the selected transcript text, target this range.',
        ].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function formatPluginConfigPromptBlock(
  plugin: VideoPluginPromptContext,
): string {
  if (!plugin.config) return '';
  const hasPublicValues = Object.keys(plugin.config.publicValues).length > 0;
  const hasSensitiveKeys = plugin.config.sensitiveKeys.length > 0;
  if (!hasPublicValues && !hasSensitiveKeys) return '';
  return [
    'Plugin configuration:',
    JSON.stringify(
      {
        publicValues: plugin.config.publicValues,
        sensitiveKeys: plugin.config.sensitiveKeys,
      },
      null,
      2,
    ),
    'Sensitive configuration values are available only to backend tools and are not shown here.',
  ].join('\n');
}

function summarizeProjectAsset(
  asset: VideoProject['assets'][number],
  projectRoot: string,
) {
  const referenced = isReferencedProjectAsset(asset);
  return {
    id: asset.id,
    kind: asset.kind,
    durationMs: asset.metadata.durationMs,
    width: asset.metadata.width,
    height: asset.metadata.height,
    materializationState:
      asset.materializationState ?? (referenced ? 'referenced' : 'ready'),
    renderable: !referenced,
    requiresHydration: referenced,
    hydrateWith: referenced ? 'video_attach_asset' : undefined,
    hydrateArgs: referenced ? { assetId: asset.id } : undefined,
    catalogAssetId: asset.provenance?.catalogAssetId,
    provider: asset.provenance?.provider,
    displayName: asset.provenance?.sourceDisplayName,
    thumbnailUrl: asset.provenance?.thumbnailUrl,
    sourceUrl: asset.provenance?.sourceUrl,
    filePath: referenced
      ? undefined
      : resolveProjectAssetPath(projectRoot, asset.path),
  };
}

function resolveProjectAssetPath(
  projectRoot: string,
  assetPath: string,
): string {
  return path.isAbsolute(assetPath)
    ? path.resolve(assetPath)
    : path.resolve(projectRoot, assetPath);
}
