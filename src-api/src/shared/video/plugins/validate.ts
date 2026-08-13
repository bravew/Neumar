import { z } from 'zod';

import { PLUGIN_NAME_RE, SEMVER_RE, formatZodIssues } from '@/shared/plugins';
import type { PluginManifest } from '@/shared/plugins/manifest';
import {
  ensureBuiltinVideoEnginesRegistered,
  tryGetVideoEngine,
} from '@/shared/video/engines';
import type { EngineTemplateRef } from '@/shared/video/engines/types';

import apiPackage from '../../../../package.json' with { type: 'json' };
import {
  VIDEO_PLUGIN_API_VERSION,
  VIDEO_PLUGIN_ASPECT_RATIOS,
  VIDEO_PLUGIN_ATOMS,
  VIDEO_PLUGIN_CAPABILITIES,
  VIDEO_PLUGIN_ENGINE_IDS,
  type VideoPluginAtom,
  requiredCapabilitiesForAtoms,
} from './types';

const DEFAULT_HOST_VERSION = apiPackage.version ?? '0.0.0';

const safeText = z
  .string()
  .min(1)
  .max(4000)
  .refine((value) => !/(<script|javascript:|data:text\/html)/i.test(value), {
    message: 'Text fields may not contain executable content',
  });

const relativePath = z
  .string()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      !value.includes('\0') &&
      !value.startsWith('/') &&
      !/^[a-zA-Z]:[\\/]/.test(value) &&
      !/(^|[\\/])\.\.([\\/]|$)/.test(value),
    'path must be plugin-relative and stay within the plugin folder',
  );

const hostPattern = z
  .string()
  .min(1)
  .max(253)
  .refine((host) => host !== '*', 'wildcard network access is not allowed')
  .refine(
    (host) =>
      host === 'none' ||
      /^(\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
        host,
      ),
    'host must be an exact hostname or *.example.com wildcard',
  );
const networkPathPrefix = z.string().min(1).max(200).startsWith('/');

const engineTemplateRefSchema = z.union([
  z
    .object({
      id: z.string().min(1).max(128),
      engineId: z.string().min(1),
      sourcePath: relativePath,
      version: z.string().optional(),
      mode: z.literal('bridge').optional(),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(128),
      engineId: z.string().min(1),
      sourcePath: relativePath,
      version: z.string().optional(),
      mode: z.literal('native'),
      nativeCompositionId: z.string().min(1).max(200).optional(),
    })
    .strict(),
]);

const inputSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/),
    kind: z.enum(['text', 'longText', 'number', 'enum', 'asset', 'color']),
    label: z.string().min(1).max(120),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    enum: z.array(z.string().min(1).max(120)).max(30).optional(),
    assetKind: z.enum(['image', 'video', 'audio']).optional(),
  })
  .strict();

const stageSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/),
    atoms: z.array(z.enum(VIDEO_PLUGIN_ATOMS)).min(1),
    inputs: z.record(z.string(), z.unknown()).optional(),
    policy: z.string().min(1).max(120).optional(),
    optional: z.boolean().optional(),
    repeat: z.boolean().optional(),
    until: z.string().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((stage, ctx) => {
    if (stage.repeat && !stage.until) {
      ctx.addIssue({
        code: 'custom',
        message: 'repeat stages must declare until',
        path: ['until'],
      });
    }
  });

const overlayControlContributionSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z][\w-]{0,39}$/),
    type: z.enum(['number', 'color', 'text', 'select', 'toggle']),
    label: z.string().min(1).max(120),
    defaultValue: z.union([z.string().max(500), z.number(), z.boolean()]),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    options: z.array(z.string().min(1).max(120)).max(20).optional(),
  })
  .strict();

const overlayPresetContributionSchema = z
  .object({
    id: z.string().regex(/^[\w.-]{1,80}$/),
    backend: z.enum(['html', 'gif', 'lottie', 'text-motion']),
    category: z.enum(['caption', 'sticker', 'title', 'callout', 'ambient']),
    label: z.string().min(1).max(120),
    description: z.string().min(1).max(300),
    /** Must reference a BUILT-IN document; validated at registration. */
    documentId: z.string().min(1).max(120).optional(),
    requiresSourceAsset: z.boolean().optional(),
    controls: z.array(overlayControlContributionSchema).max(12).default([]),
    defaultDurationMs: z.number().int().min(33).max(36_000_000),
    minDurationMs: z.number().int().min(33).max(60_000),
  })
  .strict();

const genuiSurfaceSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/),
    kind: z.enum(['form', 'choice', 'confirmation']),
    persist: z.enum(['run', 'conversation', 'project']),
    title: z.string().min(1).max(160).optional(),
    prompt: z.string().min(1).max(500).optional(),
    trigger: z.record(z.string(), z.unknown()).optional(),
    schema: z.record(z.string(), z.unknown()).optional(),
    options: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            label: z.string().min(1).max(120),
            description: z.string().min(1).max(300).optional(),
            preview: z.string().min(1).max(1000).optional(),
          })
          .strict(),
      )
      .max(4)
      .optional(),
    capabilitiesRequired: z.array(z.enum(VIDEO_PLUGIN_CAPABILITIES)).optional(),
  })
  .strict();

const networkAccessSchema = z
  .object({
    allowedHosts: z.array(hostPattern).min(1).max(50),
    allowedPaths: z
      .record(hostPattern, z.array(networkPathPrefix).min(1).max(25))
      .optional(),
    reason: z.string().min(1).max(500).optional(),
    devAllowedHosts: z.array(hostPattern).max(20).optional(),
  })
  .strict()
  .superRefine((networkAccess, ctx) => {
    const hasExternalHosts = networkAccess.allowedHosts.some(
      (host) => host !== 'none',
    );
    if (hasExternalHosts && !networkAccess.reason) {
      ctx.addIssue({
        code: 'custom',
        message: 'networkAccess.reason is required for external hosts',
        path: ['reason'],
      });
    }
    const externalHosts = [
      ...networkAccess.allowedHosts,
      ...(networkAccess.devAllowedHosts ?? []),
    ].filter((host) => host !== 'none');
    for (const host of externalHosts) {
      if (!networkAccess.allowedPaths?.[host]?.length) {
        ctx.addIssue({
          code: 'custom',
          message:
            'networkAccess.allowedPaths must list path prefixes for every external host',
          path: ['allowedPaths', host],
        });
      }
    }
    for (const host of Object.keys(networkAccess.allowedPaths ?? {})) {
      if (!externalHosts.includes(host)) {
        ctx.addIssue({
          code: 'custom',
          message:
            'networkAccess.allowedPaths entries must match allowedHosts or devAllowedHosts',
          path: ['allowedPaths', host],
        });
      }
    }
    if (
      networkAccess.allowedHosts.includes('none') &&
      networkAccess.allowedHosts.length > 1
    ) {
      ctx.addIssue({
        code: 'custom',
        message: '"none" cannot be combined with network hosts',
        path: ['allowedHosts'],
      });
    }
  });

export const VideoPluginManifestSchema = z
  .object({
    $schema: z.string().url().optional(),
    specVersion: z.literal('1.0.0'),
    name: z
      .string()
      .regex(PLUGIN_NAME_RE, 'name must be lower-kebab-case (a-z, 0-9, -)'),
    title: safeText.max(200),
    title_i18n: z.record(z.string(), safeText.max(200)).optional(),
    version: z.string().regex(SEMVER_RE).optional(),
    compatibility: z
      .object({
        neuma: z.string().min(1).max(120),
        videoPluginApi: z.string().min(1).max(120),
      })
      .strict(),
    description: safeText.max(1000),
    author: z
      .object({
        name: z.string().min(1).max(200),
        url: z.string().url().optional(),
      })
      .strict()
      .optional(),
    license: z.string().min(1).max(100).optional(),
    icon: relativePath.optional(),
    tags: z.array(z.string().min(1).max(50)).max(20).optional(),
    video: z
      .object({
        kind: z.enum(['flow', 'atom', 'bundle']),
        mode: z.enum([
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
        ]),
        aspectRatios: z.array(z.enum(VIDEO_PLUGIN_ASPECT_RATIOS)).min(1),
        engine: z
          .object({
            id: z.enum(VIDEO_PLUGIN_ENGINE_IDS),
            templateRef: engineTemplateRefSchema.optional(),
          })
          .strict(),
        templates: z
          .array(
            z
              .object({
                id: z.string().regex(/^[\w][\w.-]*$/),
                role: z
                  .enum(['primary', 'supporting', 'example'])
                  .default('supporting'),
              })
              .strict(),
          )
          .max(20)
          .optional(),
        useCase: z
          .object({
            query: safeText.max(1000),
            query_i18n: z.record(z.string(), z.string().min(1)).optional(),
            goals: z.array(z.string().min(1).max(200)).max(20).optional(),
            activation: z
              .object({
                keywords: z.array(z.string().min(1).max(80)).max(50).optional(),
                assetKinds: z
                  .array(z.enum(['image', 'video', 'audio']))
                  .max(10)
                  .optional(),
              })
              .strict()
              .optional(),
            exampleOutputs: z
              .array(
                z
                  .object({
                    path: relativePath,
                    title: z.string().min(1).max(200),
                  })
                  .strict(),
              )
              .max(20)
              .optional(),
          })
          .strict()
          .optional(),
        inputs: z.array(inputSchema).max(100).optional(),
        pipeline: z
          .object({
            stages: z.array(stageSchema).min(1).max(30),
          })
          .strict(),
        genui: z
          .object({
            surfaces: z.array(genuiSurfaceSchema).max(20),
          })
          .strict()
          .optional(),
        // Data-only vivid-overlay preset contributions. Plugins may only
        // recombine BUILT-IN backends/documents with their own labels and
        // control defaults — no code, no documents (the documentId is
        // validated against the built-in catalog at registration).
        overlayPresets: z
          .array(overlayPresetContributionSchema)
          .max(20)
          .optional(),
        output: z
          .object({
            preset: z.string().min(1).max(120),
            durationTargetSec: z
              .tuple([z.number().positive(), z.number().positive()])
              .optional(),
            captions: z.enum(['auto', 'none', 'provided']).optional(),
            loudnessLufs: z.number().min(-60).max(0).optional(),
            fps: z
              .union([z.literal(24), z.literal(30), z.literal(60)])
              .optional(),
          })
          .strict(),
        capabilities: z.array(z.enum(VIDEO_PLUGIN_CAPABILITIES)).min(1),
        networkAccess: networkAccessSchema.optional(),
      })
      .strict(),
  })
  .strict();

export type VideoPluginManifest = z.infer<typeof VideoPluginManifestSchema>;

export interface VideoPluginValidationIssue {
  path: string;
  message: string;
}

export interface ValidateVideoPluginOptions {
  genericManifest?: PluginManifest;
  folderName?: string;
  hostVersion?: string;
  videoPluginApiVersion?: string;
  validateEngineTemplate?: boolean;
}

export interface VideoPluginValidationResult {
  ok: boolean;
  manifest?: VideoPluginManifest;
  issues: VideoPluginValidationIssue[];
}

export function parseVideoPluginManifest(
  raw: string,
  options: ValidateVideoPluginOptions = {},
): VideoPluginValidationResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          path: '<root>',
          message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  return validateVideoPluginManifest(value, options);
}

export function validateVideoPluginManifest(
  value: unknown,
  options: ValidateVideoPluginOptions = {},
): VideoPluginValidationResult {
  const result = VideoPluginManifestSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      issues: formatZodIssues(result.error).map((message) => {
        const [path, ...rest] = message.split(': ');
        return { path: path ?? '<root>', message: rest.join(': ') || message };
      }),
    };
  }

  const manifest = result.data;
  const issues = collectCrossFieldIssues(manifest, options);
  return {
    ok: issues.length === 0,
    manifest: issues.length === 0 ? manifest : undefined,
    issues,
  };
}

function collectCrossFieldIssues(
  manifest: VideoPluginManifest,
  options: ValidateVideoPluginOptions,
): VideoPluginValidationIssue[] {
  const issues: VideoPluginValidationIssue[] = [];
  const hostVersion = options.hostVersion ?? DEFAULT_HOST_VERSION;
  const videoPluginApiVersion =
    options.videoPluginApiVersion ?? VIDEO_PLUGIN_API_VERSION;

  if (options.genericManifest) {
    if (options.genericManifest.name !== manifest.name) {
      issues.push({
        path: 'name',
        message: 'video plugin name must match generic plugin manifest name',
      });
    }
    if (
      manifest.version &&
      options.genericManifest.version !== manifest.version
    ) {
      issues.push({
        path: 'version',
        message:
          'video plugin version must match generic plugin manifest version',
      });
    }
  }

  if (options.folderName && options.folderName !== manifest.name) {
    issues.push({
      path: 'name',
      message: 'video plugin name must match plugin folder name',
    });
  }

  if (
    !satisfiesVersionRange(hostVersion, manifest.compatibility.neuma) ||
    manifest.compatibility.neuma.trim() === '*'
  ) {
    issues.push({
      path: 'compatibility.neuma',
      message: `plugin requires Neuma ${manifest.compatibility.neuma}, host is ${hostVersion}`,
    });
  }

  if (
    !satisfiesVersionRange(
      videoPluginApiVersion,
      manifest.compatibility.videoPluginApi,
    ) ||
    manifest.compatibility.videoPluginApi.trim() === '*'
  ) {
    issues.push({
      path: 'compatibility.videoPluginApi',
      message: `plugin requires video plugin API ${manifest.compatibility.videoPluginApi}, host is ${videoPluginApiVersion}`,
    });
  }

  const stages = manifest.video.pipeline.stages;
  const atoms = stages.flatMap((stage) => stage.atoms) as VideoPluginAtom[];
  const declared = new Set(manifest.video.capabilities);
  for (const capability of requiredCapabilitiesForAtoms(atoms)) {
    if (!declared.has(capability)) {
      issues.push({
        path: 'video.capabilities',
        message: `missing capability required by pipeline: ${capability}`,
      });
    }
  }

  const needsNetwork = manifest.video.capabilities.some(
    (capability) =>
      capability.startsWith('network:') || capability === 'research:web',
  );
  const networkAccess = manifest.video.networkAccess;
  if (needsNetwork && !networkAccess) {
    issues.push({
      path: 'video.networkAccess',
      message: 'networkAccess is required by network/research capabilities',
    });
  }
  if (
    needsNetwork &&
    networkAccess &&
    networkAccess.allowedHosts.length === 1 &&
    networkAccess.allowedHosts[0] === 'none'
  ) {
    issues.push({
      path: 'video.networkAccess.allowedHosts',
      message: 'network capabilities require at least one allowed host',
    });
  }

  const forbiddenKeys = findForbiddenExecutableKeys(manifest);
  for (const keyPath of forbiddenKeys) {
    issues.push({
      path: keyPath,
      message:
        'video plugins cannot declare raw commands, env, or install hooks',
    });
  }

  if (manifest.video.engine.id === 'remotion') {
    if (!manifest.video.engine.templateRef) {
      issues.push({
        path: 'video.engine.templateRef',
        message: 'remotion engine plugins must declare templateRef',
      });
    } else if (options.validateEngineTemplate !== false) {
      validateTemplateRef(
        manifest.video.engine.templateRef as EngineTemplateRef,
        issues,
      );
    }
  } else if (
    manifest.video.engine.templateRef &&
    options.validateEngineTemplate !== false
  ) {
    validateTemplateRef(
      manifest.video.engine.templateRef as EngineTemplateRef,
      issues,
    );
  }

  return issues;
}

function validateTemplateRef(
  templateRef: EngineTemplateRef,
  issues: VideoPluginValidationIssue[],
): void {
  ensureBuiltinVideoEnginesRegistered();
  const adapter = tryGetVideoEngine(templateRef.engineId);
  if (!adapter) {
    issues.push({
      path: 'video.engine.templateRef.engineId',
      message: `unknown video engine: ${templateRef.engineId}`,
    });
    return;
  }
  const validation = adapter.validate(templateRef);
  for (const issue of validation.issues) {
    if (issue.severity === 'error') {
      issues.push({
        path: `video.engine.templateRef.${issue.code}`,
        message: issue.message,
      });
    }
  }
}

function findForbiddenExecutableKeys(value: unknown): string[] {
  const forbidden = new Set(['command', 'commands', 'env', 'install', 'hooks']);
  const paths: string[] = [];
  walk(value, []);
  return paths;

  function walk(current: unknown, path: string[]): void {
    if (!current || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      current.forEach((entry, index) => walk(entry, [...path, String(index)]));
      return;
    }
    for (const [key, child] of Object.entries(current)) {
      const nextPath = [...path, key];
      if (forbidden.has(key)) paths.push(nextPath.join('.'));
      walk(child, nextPath);
    }
  }
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

function satisfiesVersionRange(version: string, range: string): boolean {
  const normalized = range.trim();
  if (!normalized || normalized === '*') return false;
  const parsedVersion = parseSemver(version);
  if (!parsedVersion) return false;

  if (normalized.startsWith('^')) {
    const base = parseSemver(normalized.slice(1));
    if (!base) return false;
    const upper = { major: base.major + 1, minor: 0, patch: 0 };
    return (
      compareSemver(parsedVersion, base) >= 0 &&
      compareSemver(parsedVersion, upper) < 0
    );
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1 && SEMVER_RE.test(parts[0]!)) {
    const exact = parseSemver(parts[0]!);
    return exact ? compareSemver(parsedVersion, exact) === 0 : false;
  }

  return parts.every((part) => {
    const match = part.match(
      /^(>=|>|<=|<|=)?(\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)$/,
    );
    if (!match) return false;
    const op = match[1] ?? '=';
    const target = parseSemver(match[2]!);
    if (!target) return false;
    const cmp = compareSemver(parsedVersion, target);
    switch (op) {
      case '>=':
        return cmp >= 0;
      case '>':
        return cmp > 0;
      case '<=':
        return cmp <= 0;
      case '<':
        return cmp < 0;
      case '=':
        return cmp === 0;
      default:
        return false;
    }
  });
}

function parseSemver(version: string): Semver | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemver(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
