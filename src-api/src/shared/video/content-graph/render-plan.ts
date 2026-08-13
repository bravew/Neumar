import path from 'node:path';

import {
  type VideoEngineAdapter,
  getVideoEngine,
} from '@/shared/video/engines';
import type { EngineTemplateRef } from '@/shared/video/engines/types';
import type { GalleryTemplate } from '@/shared/video/templates/gallery-loader';
import type { HtmlFrameSeed } from '@/shared/video/types';

import { normalizeDataRollupVariables } from './native-data-rollup';

export interface SceneRenderPlan {
  template: GalleryTemplate;
  adapter: VideoEngineAdapter;
  templateRef: EngineTemplateRef;
  variables?: Record<string, unknown>;
  version: string;
  sourcePath: string;
}

const NATIVE_VARIABLE_NORMALIZERS: Record<
  string,
  (variables: Record<string, unknown> | undefined) => Record<string, unknown>
> = {
  'frame-data-rollup': normalizeDataRollupVariables,
};

export async function resolveSceneRenderPlan(input: {
  seed: HtmlFrameSeed;
  baseTemplate: GalleryTemplate;
  baseTemplateSourcePath: string;
  bridgeOverride: { path: string; sha256: string } | null;
  resolveTemplate?: (templateId: string) => Promise<GalleryTemplate>;
  adapter?: VideoEngineAdapter;
}): Promise<SceneRenderPlan> {
  const override = input.seed.renderOverride;
  if (override?.mode === 'native') {
    if (!input.resolveTemplate) {
      throw new Error(
        `materializeHtmlStoryboard: native render override for "${input.seed.nodeId}" requires a template resolver`,
      );
    }

    const template = await input.resolveTemplate(override.templateId);
    if (template.metadata.engine !== override.engine) {
      throw new Error(
        `materializeHtmlStoryboard: native render override for "${input.seed.nodeId}" declares engine "${override.engine}" but template "${template.id}" uses "${template.metadata.engine}"`,
      );
    }
    if (!template.metadata.native?.compositionId) {
      throw new Error(
        `materializeHtmlStoryboard: native template "${template.id}" is missing native.compositionId`,
      );
    }

    const adapter = input.adapter ?? getVideoEngine(template.metadata.engine);
    const sourcePath = resolveTemplateSourcePath(template);
    return {
      template,
      adapter,
      sourcePath,
      version: template.metadata.version,
      variables: normalizeNativeVariables(
        template.id,
        mergeVariables(input.seed.variables, override.variables),
      ),
      templateRef: {
        id: template.id,
        engineId: adapter.id,
        sourcePath,
        version: template.metadata.version,
        mode: 'native',
        nativeCompositionId: template.metadata.native.compositionId,
      },
    };
  }

  const adapter =
    input.adapter ?? getVideoEngine(input.baseTemplate.metadata.engine);
  const sourcePath = input.bridgeOverride?.path ?? input.baseTemplateSourcePath;
  const version = input.bridgeOverride
    ? `override:${input.bridgeOverride.sha256}`
    : input.baseTemplate.metadata.version;
  return {
    template: input.baseTemplate,
    adapter,
    sourcePath,
    version,
    variables: input.seed.variables,
    templateRef: {
      id: input.baseTemplate.id,
      engineId: adapter.id,
      sourcePath,
      version,
      mode: 'bridge',
    },
  };
}

export function resolveTemplateSourcePath(template: GalleryTemplate): string {
  const templateDir = path.dirname(template.metadataPath);
  const resolvedDir = path.resolve(templateDir);
  const resolved = path.resolve(templateDir, template.metadata.source_entry);
  if (
    resolved !== resolvedDir &&
    !resolved.startsWith(resolvedDir + path.sep)
  ) {
    throw new Error(
      `materializeHtmlStoryboard: source_entry for template "${template.id}" escapes its template directory`,
    );
  }
  return resolved;
}

function mergeVariables(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!base && !override) return undefined;
  return { ...(base ?? {}), ...(override ?? {}) };
}

function normalizeNativeVariables(
  templateId: string,
  variables: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return NATIVE_VARIABLE_NORMALIZERS[templateId]?.(variables) ?? variables;
}
