import { z } from 'zod';

import { normalizeProjectRelativePath } from '../fs';

const ATTR_NAME_RE =
  /^(class|id|aria-[a-z0-9_-]+|data-(?!neuma-|od-)[a-z0-9_-]+)$/i;
const STYLE_PROP_RE =
  /^(color|background-color|backgroundColor|font-size|fontSize|font-weight|fontWeight|text-align|textAlign|padding|margin|border-radius|borderRadius|border|width|min-height|minHeight)$/;
const TOKEN_NAME_RE = /^--[a-z][a-z0-9_-]{0,120}$/i;
const UNSAFE_TOKEN_VALUE_RE =
  /;|[{}<>]|\/\*|@import|url\s*\(|expression\s*\(|javascript:/i;
const UNSAFE_FULL_SOURCE_RE =
  /<\s*script\b|<\s*(iframe|object|embed)\b|\son[a-z]+\s*=|javascript:/i;
const FULL_SOURCE_MAX_BYTES = 5 * 1024 * 1024;

export const manualEditPatchSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set-text'),
    patchId: z.string().min(1).max(120).optional(),
    sourcePath: z.string().min(1).max(1000),
    targetId: z.string().min(1).max(200),
    value: z.string().max(100_000),
  }),
  z.object({
    type: z.literal('set-link'),
    patchId: z.string().min(1).max(120).optional(),
    sourcePath: z.string().min(1).max(1000),
    targetId: z.string().min(1).max(200),
    href: z.string().min(1).max(4000),
  }),
  z.object({
    type: z.literal('set-image'),
    patchId: z.string().min(1).max(120).optional(),
    sourcePath: z.string().min(1).max(1000),
    targetId: z.string().min(1).max(200),
    src: z.string().min(1).max(4000),
    alt: z.string().max(1000).optional(),
  }),
  z.object({
    type: z.literal('set-style'),
    patchId: z.string().min(1).max(120).optional(),
    sourcePath: z.string().min(1).max(1000),
    targetId: z.string().min(1).max(200),
    styles: z.record(z.string(), z.string().max(1000)),
  }),
  z.object({
    type: z.literal('set-token'),
    patchId: z.string().min(1).max(120).optional(),
    tokenName: z.string().min(1).max(140).optional(),
    name: z.string().min(1).max(140).optional(),
    value: z.string().min(1).max(4000),
  }),
  z.object({
    type: z.literal('set-full-source'),
    patchId: z.string().min(1).max(120).optional(),
    sourcePath: z.string().min(1).max(1000),
    content: z.string().max(FULL_SOURCE_MAX_BYTES),
  }),
  z.object({
    type: z.literal('set-outer-html'),
    patchId: z.string().min(1).max(120).optional(),
    sourcePath: z.string().min(1).max(1000),
    targetId: z.string().min(1).max(200),
    content: z.string().max(100_000),
  }),
  z.object({
    type: z.literal('set-attributes'),
    patchId: z.string().min(1).max(120).optional(),
    sourcePath: z.string().min(1).max(1000),
    targetId: z.string().min(1).max(200),
    attributes: z.record(z.string(), z.string().max(4000)),
  }),
]);

export type ManualEditPatch = z.infer<typeof manualEditPatchSchema>;

export function validateManualEditPatch(input: unknown): ManualEditPatch {
  const patch = manualEditPatchSchema.parse(input);
  if (patch.type !== 'set-token') {
    normalizeProjectRelativePath(patch.sourcePath);
  }

  if (patch.type === 'set-link') {
    validateSafeHref(patch.href);
  }
  if (patch.type === 'set-image') {
    validateSafeImageSrc(patch.src);
  }
  if (patch.type === 'set-attributes') {
    for (const key of Object.keys(patch.attributes)) {
      if (!ATTR_NAME_RE.test(key)) {
        throw new Error(`Attribute is not allowed: ${key}`);
      }
    }
  }
  if (patch.type === 'set-style') {
    for (const [key, value] of Object.entries(patch.styles)) {
      if (!STYLE_PROP_RE.test(key)) {
        throw new Error(`Style property is not allowed: ${key}`);
      }
      if (/url\s*\(|expression\s*\(|javascript:/i.test(value)) {
        throw new Error(`Style value is not allowed: ${key}`);
      }
    }
  }
  if (patch.type === 'set-token') {
    validateSafeTokenName(getManualEditTokenName(patch));
    validateSafeTokenValue(patch.value);
  }
  if (patch.type === 'set-full-source') {
    validateSafeFullSource(patch.content);
  }
  if (patch.type === 'set-outer-html') {
    validateSafeFullSource(patch.content);
  }
  return patch;
}

export function getManualEditTokenName(
  patch: Extract<ManualEditPatch, { type: 'set-token' }>,
) {
  return patch.tokenName ?? patch.name ?? '';
}

export function validateSafeTokenName(value: string) {
  if (!TOKEN_NAME_RE.test(value)) {
    throw new Error(
      'Token names must be CSS custom properties like --brand-primary.',
    );
  }
}

export function validateSafeTokenValue(value: string) {
  if (UNSAFE_TOKEN_VALUE_RE.test(value)) {
    throw new Error('Token values cannot contain active CSS or nested rules.');
  }
}

export function validateSafeFullSource(value: string) {
  if (Buffer.byteLength(value, 'utf-8') > FULL_SOURCE_MAX_BYTES) {
    throw new Error('Full-source patches cannot exceed 5MB.');
  }
  if (UNSAFE_FULL_SOURCE_RE.test(value)) {
    throw new Error('Full-source patches cannot contain active HTML.');
  }
}

export function validateSafeHref(value: string) {
  const url = new URL(value, 'https://neuma.local');
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && url.hostname === 'localhost') return;
  if (url.protocol === 'mailto:') return;
  if (url.protocol === 'tel:') return;
  if (value.startsWith('/') || value.startsWith('./')) return;
  throw new Error(
    'Link targets must be HTTPS, mailto, tel, or project-relative.',
  );
}

export function validateSafeImageSrc(value: string) {
  const url = new URL(value, 'https://neuma.local');
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && url.hostname === 'localhost') return;
  if (value.startsWith('/') || value.startsWith('./') || !value.includes(':')) {
    return;
  }
  throw new Error('Image sources must be HTTPS or project-relative.');
}
