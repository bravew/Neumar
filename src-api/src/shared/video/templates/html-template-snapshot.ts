import fs from 'node:fs/promises';
import path from 'node:path';

import { ContentGraphSchema, type ContentGraph } from '@neumar/video-ir';
import { stringify as stringifyYaml } from 'yaml';

import { validatePath } from '@/shared/services/ffmpeg';
import {
  readContentGraph,
  readFrameHtml,
} from '@/shared/video/content-graph/persistence';
import { getVideoWorkspaceRoot } from '@/shared/video/store';

import type { VideoProject } from '../types';
import { createCustomTemplateId } from './custom-loader';
import { resolveDefaultTemplateGalleryRoots } from './gallery-loader';
import type { GalleryTemplate } from './gallery-loader';
import { TemplateMetadataSchema, type TemplateLicense } from './gallery-schema';
import type {
  VideoTemplate,
  VideoTemplateCategory,
  VideoTemplateInput,
} from './types';
import { VideoTemplateSchema } from './validator';

interface BuildHtmlTemplateFolderInput {
  displayName: string;
  category: VideoTemplateCategory;
  license: VideoTemplate['license'];
}

export interface BuildHtmlTemplateFolderResult {
  templateId: string;
  templateDir: string;
  template: VideoTemplate;
}

export interface HtmlGalleryTemplateSnapshot {
  template: VideoTemplate;
  galleryTemplate: GalleryTemplate;
  contentGraph: ContentGraph;
  frameHtml: Record<string, string>;
}

const DEFAULT_FPS = 30;
const PREVIEW_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lm2bWQAAAABJRU5ErkJggg==';

export async function buildHtmlTemplateFolder(
  project: VideoProject,
  input: BuildHtmlTemplateFolderInput,
): Promise<BuildHtmlTemplateFolderResult> {
  const graph = await readContentGraph(project.id);
  if (!graph || graph.nodes.length === 0) {
    throw new Error(
      'A content graph is required before saving an HTML template',
    );
  }

  const workspaceRoot = getVideoWorkspaceRoot();
  const roots = resolveDefaultTemplateGalleryRoots(workspaceRoot);
  const templateId = createCustomTemplateId(input.displayName);
  const templateDir = validatePath(
    path.join(roots.userRoot, templateId),
    workspaceRoot,
    'write',
  );
  const sourceDir = validatePath(
    path.join(templateDir, 'source'),
    workspaceRoot,
    'write',
  );
  await fs.mkdir(sourceDir, { recursive: true });

  const frameHtml: Record<string, string> = {};
  for (const node of graph.nodes) {
    const html =
      (await readFrameHtml(project.id, node.id)) ?? fallbackFrameHtml(node.id);
    frameHtml[node.id] = html;
    await fs.writeFile(
      validatePath(
        path.join(sourceDir, `${node.id}.html`),
        workspaceRoot,
        'write',
      ),
      html,
      'utf8',
    );
  }

  await fs.writeFile(
    validatePath(
      path.join(templateDir, 'content-graph.json'),
      workspaceRoot,
      'write',
    ),
    `${JSON.stringify(graph, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    validatePath(path.join(templateDir, 'preview.png'), workspaceRoot, 'write'),
    Buffer.from(PREVIEW_PNG_BASE64, 'base64'),
  );

  const durationSec = graph.nodes.reduce(
    (total, node) => total + (node.durationSec ?? 3),
    0,
  );
  const metadata = TemplateMetadataSchema.parse({
    spec_version: 1,
    id: templateId,
    name: input.displayName,
    description:
      graph.synopsis ??
      `Reusable HTML video template saved from ${project.name}`,
    engine: 'html',
    engine_version: '^1.60.0',
    source_entry: `source/${graph.nodes[0]!.id}.html`,
    category: input.category,
    tags: ['custom', 'saved', 'html-video'],
    output: {
      formats: ['mp4'],
      default_format: 'mp4',
      resolution: {
        default: resolutionForAspect(
          project.settings?.defaultAspectRatios?.[0],
        ),
        supported_aspects: project.settings?.defaultAspectRatios?.length
          ? project.settings.defaultAspectRatios
          : ['16:9'],
      },
      fps: { default: DEFAULT_FPS, supported: [DEFAULT_FPS, 60] },
      duration: {
        type: 'variable',
        min_sec: Math.max(1, Math.min(durationSec, 3)),
        max_sec: Math.max(1, durationSec),
      },
      alpha: false,
      audio: {
        supported: Boolean(
          project.soundtrack?.musicAssetId ||
          project.soundtrack?.narrationAssetId ||
          project.soundtrack?.narrationText ||
          project.soundtrack?.narrationByFrame,
        ),
      },
    },
    inputs: { schema: buildInputsSchema(frameHtml) },
    license: templateLicense(input.license),
    provenance: {
      origin: { kind: 'in-house' },
      transformation:
        'Saved from a Neuma HTML-video content graph draft with per-frame HTML source.',
    },
    author: { name: 'Neuma' },
    version: '0.1.0',
    preview: { poster: 'preview.png' },
  });

  await fs.writeFile(
    validatePath(
      path.join(templateDir, 'template.video.yaml'),
      workspaceRoot,
      'write',
    ),
    stringifyYaml(metadata),
    'utf8',
  );

  return {
    templateId,
    templateDir,
    template: createHtmlVideoTemplateSummary({
      metadata,
      contentGraph: graph,
      frameHtml,
      license: input.license,
      thumbnailUrl: 'preview.png',
    }),
  };
}

export async function loadHtmlGalleryTemplateSnapshot(
  templateId: string,
): Promise<HtmlGalleryTemplateSnapshot> {
  const workspaceRoot = getVideoWorkspaceRoot();
  const roots = resolveDefaultTemplateGalleryRoots(workspaceRoot);
  const { loadTemplateGallery } = await import('./gallery-loader');
  const gallery = await loadTemplateGallery({ ...roots, ttlMs: 0 });
  const galleryTemplate = gallery.templates.find(
    (candidate) => candidate.id === templateId,
  );
  if (!galleryTemplate) {
    throw new Error(
      `HTML template "${templateId}" not found in the gallery. Issues: ${JSON.stringify(
        gallery.issues,
      )}`,
    );
  }
  if (
    galleryTemplate.metadata.engine !== 'html' &&
    galleryTemplate.metadata.engine !== 'remotion'
  ) {
    throw new Error(
      `Template "${templateId}" uses engine "${galleryTemplate.metadata.engine}", not an HTML-compatible engine`,
    );
  }

  const templateDir = path.dirname(galleryTemplate.metadataPath);
  const contentGraphPath = assertInsideTemplateDir(
    templateDir,
    'content-graph.json',
  );
  const contentGraph = ContentGraphSchema.parse(
    JSON.parse(await fs.readFile(contentGraphPath, 'utf8')),
  );
  const frameHtml: Record<string, string> = {};
  for (const node of contentGraph.nodes) {
    const framePath = assertInsideTemplateDir(
      templateDir,
      path.join('source', `${node.id}.html`),
    );
    try {
      frameHtml[node.id] = await fs.readFile(framePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      frameHtml[node.id] = fallbackFrameHtml(node.id);
    }
  }

  return {
    galleryTemplate,
    contentGraph,
    frameHtml,
    template: createHtmlVideoTemplateSummary({
      metadata: galleryTemplate.metadata,
      contentGraph,
      frameHtml,
      license: licenseFromTemplateMetadata(galleryTemplate.metadata.license),
      thumbnailUrl: previewThumbnail(galleryTemplate),
    }),
  };
}

function buildInputsSchema(frameHtml: Record<string, string>) {
  const keys = new Set<string>();
  for (const html of Object.values(frameHtml)) {
    for (const match of html.matchAll(/data-hv-text=["']([^"']+)["']/g)) {
      const key = match[1];
      if (key) keys.add(key);
    }
  }
  const properties: Record<string, unknown> = {};
  for (const key of [...keys].sort()) {
    properties[key] = {
      type: 'string',
      title: titleFromKey(key),
      maxLength: 240,
    };
  }
  return {
    type: 'object',
    properties,
  };
}

function createHtmlVideoTemplateSummary(input: {
  metadata: ReturnType<typeof TemplateMetadataSchema.parse>;
  contentGraph: ContentGraph;
  frameHtml: Record<string, string>;
  license: VideoTemplate['license'];
  thumbnailUrl: string;
}): VideoTemplate {
  const durationSec = durationSecFromGraph(input.contentGraph);
  const aspectRatio = normalizeAspectRatio(
    input.metadata.output.resolution.supported_aspects[0],
  );
  return VideoTemplateSchema.parse({
    id: input.metadata.id,
    displayName: input.metadata.name,
    category: normalizeCategory(input.metadata.category),
    thumbnailUrl: input.thumbnailUrl,
    durationSec: {
      typical: durationSec,
      min: Math.max(1, Math.floor(input.metadata.output.duration.min_sec ?? 1)),
      max: Math.max(
        durationSec,
        Math.ceil(input.metadata.output.duration.max_sec ?? durationSec),
      ),
    },
    aspectRatios: input.metadata.output.resolution.supported_aspects
      .map(normalizeAspectRatio)
      .filter((aspect, index, aspects) => aspects.indexOf(aspect) === index),
    renderer: input.metadata.engine === 'remotion' ? 'remotion' : 'auto',
    compositionId: input.metadata.native?.compositionId,
    hook: 'cold-open',
    pace: 'medium',
    pricingHint: { low: 0, high: 0 },
    inputs: videoInputsFromJsonSchema(input.metadata.inputs.schema),
    storyboardSeed: {
      intent:
        input.contentGraph.synopsis ??
        input.metadata.description ??
        input.metadata.name,
      scenes: input.contentGraph.nodes.map((node) => {
        const sceneDurationMs = Math.max(
          500,
          Math.round((node.durationSec ?? 3) * 1000),
        );
        return {
          durationMs: sceneDurationMs,
          intent: nodeText(node) || `Render HTML frame ${node.id}`,
          assetPlan: {
            kind: 'ai-clip',
            prompt: nodeText(node) || `Render HTML frame ${node.id}`,
            aspectRatio,
            durationMs: sceneDurationMs,
            provider: 'seedance-2-0-fast',
          },
        };
      }),
    },
    html: {
      engine: input.metadata.engine === 'remotion' ? 'remotion' : 'html',
      aspectRatio,
      durationSec,
      contentGraph: input.contentGraph,
      frameHtml: input.frameHtml,
      provenance: { templateId: input.metadata.id },
    },
    styleDefaults: {},
    providerHints: {},
    version: Number.parseInt(input.metadata.version, 10) || 1,
    source: 'custom',
    authorHandle: input.metadata.author?.name,
    license: input.license,
    projectTemplateId: 'custom',
  }) as VideoTemplate;
}

function assertInsideTemplateDir(
  templateDir: string,
  relativePath: string,
): string {
  const resolvedDir = path.resolve(templateDir);
  const resolved = path.resolve(templateDir, relativePath);
  if (
    resolved !== resolvedDir &&
    !resolved.startsWith(resolvedDir + path.sep)
  ) {
    throw new Error('Template path escapes the template directory');
  }
  return resolved;
}

function videoInputsFromJsonSchema(
  schema: Record<string, unknown>,
): VideoTemplateInput[] {
  const properties =
    schema.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};
  const required = Array.isArray(schema.required)
    ? new Set(
        schema.required.filter(
          (item): item is string => typeof item === 'string',
        ),
      )
    : new Set<string>();
  return Object.entries(properties)
    .filter(([key]) => /^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(key))
    .slice(0, 20)
    .map(([key, value]) => ({
      key,
      kind:
        value.type === 'number' || value.type === 'integer' ? 'number' : 'text',
      label: typeof value.title === 'string' ? value.title : titleFromKey(key),
      required: required.has(key),
      ...(value.default !== undefined ? { default: value.default } : {}),
      ...(Array.isArray(value.enum)
        ? {
            kind: 'enum' as const,
            enum: value.enum
              .filter((item): item is string => typeof item === 'string')
              .slice(0, 20),
          }
        : {}),
    }));
}

function durationSecFromGraph(graph: ContentGraph): number {
  return Math.max(
    1,
    Math.round(
      graph.nodes.reduce((total, node) => total + (node.durationSec ?? 3), 0),
    ),
  );
}

function nodeText(node: ContentGraph['nodes'][number]): string {
  if ('text' in node && typeof node.text === 'string') return node.text;
  if ('title' in node && typeof node.title === 'string') return node.title;
  return '';
}

function normalizeAspectRatio(
  aspect: string | undefined,
): VideoTemplate['aspectRatios'][number] {
  if (aspect === '9:16' || aspect === '1:1' || aspect === '4:5') return aspect;
  return '16:9';
}

function normalizeCategory(category: string): VideoTemplateCategory {
  const allowed: VideoTemplateCategory[] = [
    'shorts',
    'explainer',
    'ad',
    'tutorial',
    'product',
    'podcast',
    'testimonial',
    'recap',
    'announcement',
    'other',
    'custom',
  ];
  return allowed.includes(category as VideoTemplateCategory)
    ? (category as VideoTemplateCategory)
    : 'custom';
}

function licenseFromTemplateMetadata(
  license: TemplateLicense,
): VideoTemplate['license'] {
  if (license.spdx === 'CC0-1.0') return 'CC0';
  if (license.spdx === 'CC-BY-4.0') return 'CC-BY';
  return 'proprietary';
}

function previewThumbnail(template: GalleryTemplate): string {
  if (!template.metadata.preview) return '';
  if (typeof template.metadata.preview === 'string')
    return template.metadata.preview;
  return (
    template.metadata.preview.thumbnail ??
    template.metadata.preview.poster ??
    template.metadata.preview.loop ??
    ''
  );
}

function fallbackFrameHtml(nodeId: string): string {
  return `<!doctype html><html><body><main data-hv-frame="${nodeId}"></main></body></html>`;
}

function titleFromKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function templateLicense(license: VideoTemplate['license']): TemplateLicense {
  if (license === 'CC0') {
    return {
      spdx: 'CC0-1.0',
      attribution_required: false,
      redistribution_allowed: true,
      commercial_use: true,
    };
  }
  if (license === 'CC-BY') {
    return {
      spdx: 'CC-BY-4.0',
      attribution_required: true,
      redistribution_allowed: true,
      commercial_use: true,
    };
  }
  return {
    spdx: 'LicenseRef-Proprietary',
    attribution_required: false,
    redistribution_allowed: false,
    commercial_use: true,
  };
}

function resolutionForAspect(aspect: string | undefined): {
  width: number;
  height: number;
} {
  if (aspect === '9:16') return { width: 1080, height: 1920 };
  if (aspect === '1:1') return { width: 1080, height: 1080 };
  if (aspect === '4:5') return { width: 1080, height: 1350 };
  return { width: 1920, height: 1080 };
}
