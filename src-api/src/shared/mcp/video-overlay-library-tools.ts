import { tool } from '@anthropic-ai/claude-agent-sdk/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { KeyframeTrackSchema } from '@neumar/video-ir';
import type { VividOverlayPresetDef } from '@neumar/video-ir';
import { z } from 'zod';

import { normalizeCssColor } from '@/shared/video/css-colors';
import {
  findVividOverlayPreset,
  VIDEO_OVERLAY_REGISTRY,
} from '@/shared/video/overlays/registry';
import {
  saveUserOverlayDocument,
  UserOverlayDocumentError,
} from '@/shared/video/overlays/user-documents';
import { saveUserOverlayPreset } from '@/shared/video/overlays/user-presets';
import {
  saveUserOverlayStyle,
  UserOverlayStyleError,
} from '@/shared/video/overlays/user-styles';

const OVERLAY_CONTROL_VALUE_SCHEMA = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

const OVERLAY_STYLE_TRANSFORM_SCHEMA = z
  .object({
    scale: z.number().finite().optional(),
    scaleX: z.number().finite().optional(),
    scaleY: z.number().finite().optional(),
    positionX: z.number().finite().optional(),
    positionY: z.number().finite().optional(),
    opacity: z.number().finite().optional(),
    rotation: z.number().finite().optional(),
  })
  .strict();

const USER_OVERLAY_DOCUMENT_CONTROL_SCHEMA = z
  .object({
    id: z.string().min(1).max(80),
    type: z.enum(['number', 'color', 'text', 'select', 'toggle']),
    label: z.string().min(1).max(120),
    defaultValue: OVERLAY_CONTROL_VALUE_SCHEMA,
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().positive().optional(),
    options: z.array(z.string().min(1).max(80)).max(40).optional(),
  })
  .strict();

/** The host supplies session resolution and mutation policy; handlers stay under its typed wrapper. */
interface OverlayLibraryToolContext {
  projectIdSchema: z.ZodOptional<z.ZodString>;
  reasoningSchema: z.ZodOptional<z.ZodString>;
  resolveProjectId: (projectId: string | undefined) => string;
  proposalOnlyServiceMutationResult: (
    projectId: string | undefined,
    toolName: string,
  ) => Promise<CallToolResult | undefined>;
  jsonResult: (value: unknown) => CallToolResult;
  errorResult: (message: string) => CallToolResult;
}

export function createVideoOverlayLibraryTools({
  projectIdSchema: PROJECT_ID_SCHEMA,
  reasoningSchema: REASONING_SCHEMA,
  resolveProjectId,
  proposalOnlyServiceMutationResult,
  jsonResult,
  errorResult,
}: OverlayLibraryToolContext) {
  return [
    tool(
      'video_list_overlay_presets',
      'Return the vivid-overlay preset catalog: id, category, tags (the video-to-template classifier label space), control schema, durations, placement metadata, and optional taste metadata for routing choices. Use this to pick the closest preset when recreating an overlay seen in reference footage. This tool is read-only.',
      {
        projectId: PROJECT_ID_SCHEMA,
        category: z.string().min(1).optional(),
      },
      async ({ projectId, category }) => {
        try {
          const resolvedProjectId = resolveProjectId(projectId);
          const catalog: readonly VividOverlayPresetDef[] =
            VIDEO_OVERLAY_REGISTRY;
          const presets = catalog
            .filter((preset) => !category || preset.category === category)
            .map((preset) => ({
              id: preset.id,
              backend: preset.backend,
              category: preset.category,
              tags: preset.tags ?? [],
              controls: preset.controls.map((control) => ({
                id: control.id,
                type: control.type,
                defaultValue: control.defaultValue,
                min: control.min,
                max: control.max,
                step: control.step,
                options: control.options,
              })),
              requiresSourceAsset: preset.requiresSourceAsset ?? false,
              defaultDurationMs: preset.defaultDurationMs,
              minDurationMs: preset.minDurationMs,
              aspectAffinity: preset.aspectAffinity ?? 'any',
              anchor: preset.anchor ?? 'center',
              taste: preset.taste,
            }));
          return jsonResult({
            schema: 'neuma.video.overlay-presets.v1',
            projectId: resolvedProjectId,
            presets,
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_save_overlay_preset',
      'Save a derived overlay preset to the user\'s "My overlays" library: a built-in base preset plus control values (extracted text, colors, sizes) and loop mode. Use after matching reference footage to the closest catalog preset via video_list_overlay_presets. Color values accept CSS names and are normalized to hex.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        name: z.string().min(1).max(80),
        basePresetId: z.string().min(1),
        controls: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean()]),
        ),
        loop: z.enum(['loop', 'hold', 'none']).optional(),
      },
      async ({ projectId, name, basePresetId, controls, loop }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            'video_save_overlay_preset',
          );
          if (proposal) return proposal;
          const resolvedProjectId = resolveProjectId(projectId);
          const normalized = normalizeOverlayControlValues(
            basePresetId,
            controls,
          );
          const preset = await saveUserOverlayPreset({
            name,
            basePresetId,
            controls: normalized,
            loop,
          });
          return jsonResult({
            schema: 'neuma.video.user-overlay-preset.v1',
            projectId: resolvedProjectId,
            preset,
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_save_overlay_style_from_template',
      'Save the video-to-template v2 result as a reusable overlay style: closest built-in preset plus extracted controls, optional transform/keyframes/tags, and video-to-template provenance. Prefer this over video_save_overlay_preset when the reference overlay includes placement, scale, opacity, or motion that should remain editable.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        name: z.string().min(1).max(80),
        basePresetId: z.string().min(1),
        controls: z.record(z.string(), OVERLAY_CONTROL_VALUE_SCHEMA),
        loop: z.enum(['loop', 'hold', 'none']).optional(),
        transform: OVERLAY_STYLE_TRANSFORM_SCHEMA.optional(),
        keyframes: z.array(KeyframeTrackSchema).max(50).optional(),
        tags: z.array(z.string().min(1).max(40)).max(24).optional(),
        sourceId: z.string().min(1).optional(),
      },
      async ({
        projectId,
        name,
        basePresetId,
        controls,
        loop,
        transform,
        keyframes,
        tags,
        sourceId,
      }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            'video_save_overlay_style_from_template',
          );
          if (proposal) return proposal;
          const resolvedProjectId = resolveProjectId(projectId);
          const style = await saveUserOverlayStyle({
            name,
            basePresetId,
            controls: normalizeOverlayControlValues(basePresetId, controls),
            loop,
            transform,
            keyframes,
            tags,
            provenance: {
              kind: 'video-to-template',
              ...(sourceId ? { sourceId } : {}),
            },
          });
          return jsonResult({
            schema: 'neuma.video.user-overlay-style.v1',
            projectId: resolvedProjectId,
            style,
          });
        } catch (error) {
          return errorResult(
            error instanceof UserOverlayStyleError
              ? error.message
              : error instanceof Error
                ? error.message
                : String(error),
          );
        }
      },
    ),
    tool(
      'video_save_user_overlay_document',
      "Save an explicitly approved custom vivid-overlay HTML document after linting it with Neuma's deterministic overlay authoring contract. Only call when the user has opted into custom document synthesis; otherwise use video_save_overlay_style_from_template.",
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        userConfirmed: z.literal(true),
        name: z.string().min(1).max(80),
        html: z.string().min(1).max(200_000),
        controls: z
          .array(USER_OVERLAY_DOCUMENT_CONTROL_SCHEMA)
          .max(40)
          .optional(),
        tags: z.array(z.string().min(1).max(40)).max(24).optional(),
        provenanceKind: z
          .enum(['agent', 'video-to-template'])
          .default('video-to-template'),
        sourceId: z.string().min(1).optional(),
      },
      async ({
        projectId,
        userConfirmed,
        name,
        html,
        controls,
        tags,
        provenanceKind,
        sourceId,
      }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            'video_save_user_overlay_document',
          );
          if (proposal) return proposal;
          const resolvedProjectId = resolveProjectId(projectId);
          const document = await saveUserOverlayDocument({
            name,
            html,
            controls,
            tags,
            userConfirmed,
            provenance: {
              kind: provenanceKind ?? 'video-to-template',
              ...(sourceId ? { sourceId } : {}),
            },
          });
          return jsonResult({
            schema: 'neuma.video.user-overlay-document.v1',
            projectId: resolvedProjectId,
            document,
          });
        } catch (error) {
          if (error instanceof UserOverlayDocumentError) {
            return errorResult(
              JSON.stringify({
                error: error.message,
                code: error.code,
                issues: error.issues,
              }),
            );
          }
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
  ];
}

function normalizeOverlayControlValues(
  basePresetId: string,
  controls: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const base = findVividOverlayPreset(basePresetId);
  if (!base) return controls;
  return Object.fromEntries(
    Object.entries(controls).map(([id, value]) => [
      id,
      base.controls.find((control) => control.id === id)?.type === 'color' &&
      typeof value === 'string'
        ? normalizeCssColor(value)
        : value,
    ]),
  );
}
