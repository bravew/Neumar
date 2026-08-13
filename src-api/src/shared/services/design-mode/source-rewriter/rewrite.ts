import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

import { createLogger } from '@/shared/utils/logger';

import {
  appendJsonl,
  readProjectTextFile,
  resolveProjectPath,
  writeProjectTextFile,
} from '../fs';
import {
  getManualEditTokenName,
  type ManualEditPatch,
  validateManualEditPatch,
} from './validate';

const logger = createLogger('DesignManualEditPatches');

const TOKEN_OVERRIDE_PATH = '.neuma/tokens.css';

export interface AppliedManualEditPatch {
  patchId: string;
  appliedAt: string;
  patch: ManualEditPatch;
  sourcePath: string;
  beforeContent: string;
}

export interface RevertedManualEditPatch {
  patchId: string;
  revertedAt: string;
  revertedPatchId: string;
  sourcePath: string;
}

export async function applyManualEditPatch(
  projectId: string,
  input: unknown,
): Promise<AppliedManualEditPatch> {
  const patch = validateManualEditPatch(input);
  if (patch.type === 'set-token') {
    const beforeContent = await readOptionalProjectFile(
      projectId,
      TOKEN_OVERRIDE_PATH,
    );
    const next = upsertRootToken(
      beforeContent,
      getManualEditTokenName(patch),
      patch.value,
    );
    await writeProjectTextFile(projectId, TOKEN_OVERRIDE_PATH, next);
    const applied: AppliedManualEditPatch = {
      patchId: patch.patchId ?? `patch_${randomUUID()}`,
      appliedAt: new Date().toISOString(),
      patch,
      sourcePath: TOKEN_OVERRIDE_PATH,
      beforeContent,
    };
    await appendPatchJournal(projectId, applied);
    return applied;
  }

  const file = await readProjectTextFile(projectId, patch.sourcePath);
  if (patch.type === 'set-full-source') {
    await writeProjectTextFile(projectId, file.path, patch.content);
    const applied: AppliedManualEditPatch = {
      patchId: patch.patchId ?? `patch_${randomUUID()}`,
      appliedAt: new Date().toISOString(),
      patch,
      sourcePath: file.path,
      beforeContent: file.content,
    };
    await appendPatchJournal(projectId, applied);
    return applied;
  }

  const next =
    patch.type === 'set-text'
      ? replaceAnnotatedElementText(file.content, patch.targetId, patch.value)
      : patch.type === 'set-link'
        ? replaceAnnotatedElementHref(file.content, patch.targetId, patch.href)
        : patch.type === 'set-image'
          ? replaceAnnotatedElementImage(
              file.content,
              patch.targetId,
              patch.src,
              patch.alt,
            )
          : patch.type === 'set-style'
            ? replaceAnnotatedElementStyle(
                file.content,
                patch.targetId,
                patch.styles,
              )
            : patch.type === 'set-outer-html'
              ? replaceAnnotatedElementOuterHtml(
                  file.content,
                  patch.targetId,
                  patch.content,
                )
              : replaceAnnotatedElementAttributes(
                  file.content,
                  patch.targetId,
                  patch.attributes,
                );
  await writeProjectTextFile(projectId, file.path, next);

  const applied: AppliedManualEditPatch = {
    patchId: patch.patchId ?? `patch_${randomUUID()}`,
    appliedAt: new Date().toISOString(),
    patch,
    sourcePath: file.path,
    beforeContent: file.content,
  };
  await appendPatchJournal(projectId, applied);
  return applied;
}

export async function listManualEditPatches(projectId: string) {
  const filePath = patchJournalPath(projectId);
  const raw = await fs.readFile(filePath, 'utf-8').catch(() => '');
  const entries: Array<AppliedManualEditPatch | RevertedManualEditPatch> = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      entries.push(
        JSON.parse(line) as AppliedManualEditPatch | RevertedManualEditPatch,
      );
    } catch (error) {
      logger.warn('Skipping malformed patch journal entry', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return entries;
}

export async function revertManualEditPatch(
  projectId: string,
  patchId: string,
): Promise<RevertedManualEditPatch> {
  const entries = await listManualEditPatches(projectId);
  const applied = entries.find(
    (entry): entry is AppliedManualEditPatch =>
      'patch' in entry && entry.patchId === patchId,
  );
  if (!applied) throw new Error(`Patch not found: ${patchId}`);
  await writeProjectTextFile(
    projectId,
    applied.sourcePath,
    applied.beforeContent,
  );
  const reverted: RevertedManualEditPatch = {
    patchId: `revert_${randomUUID()}`,
    revertedAt: new Date().toISOString(),
    revertedPatchId: patchId,
    sourcePath: applied.sourcePath,
  };
  await appendPatchJournal(projectId, reverted);
  return reverted;
}

export function replaceAnnotatedElementText(
  source: string,
  targetId: string,
  value: string,
) {
  const escapedId = escapeRegExp(targetId);
  const pattern = new RegExp(
    `(<([a-zA-Z][\\w:-]*)(?=[^>]*\\bdata-neuma-id=["']${escapedId}["'])[^>]*>)([\\s\\S]*?)(</\\2>)`,
    'm',
  );
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`Target element not found: ${targetId}`);
  }
  if (/<[a-zA-Z][\s\S]*>/.test(match[3] ?? '')) {
    throw new Error('set-text only supports leaf text elements.');
  }
  return source.replace(
    pattern,
    () => `${match[1]!}${escapeHtml(value)}${match[4]!}`,
  );
}

export function replaceAnnotatedElementHref(
  source: string,
  targetId: string,
  href: string,
) {
  return replaceAnnotatedStartTag(source, targetId, (startTag, tagName) => {
    if (tagName.toLowerCase() !== 'a') {
      throw new Error('set-link only supports anchor elements.');
    }
    return setHtmlAttribute(startTag, 'href', href);
  });
}

export function replaceAnnotatedElementAttributes(
  source: string,
  targetId: string,
  attributes: Record<string, string>,
) {
  return replaceAnnotatedStartTag(source, targetId, (startTag) => {
    let next = startTag;
    for (const [name, value] of Object.entries(attributes)) {
      next = setHtmlAttribute(next, name, value);
    }
    return next;
  });
}

export function replaceAnnotatedElementImage(
  source: string,
  targetId: string,
  src: string,
  alt?: string,
) {
  return replaceAnnotatedStartTag(source, targetId, (startTag, tagName) => {
    if (tagName.toLowerCase() !== 'img') {
      throw new Error('set-image only supports image elements.');
    }
    const withSrc = setHtmlAttribute(startTag, 'src', src);
    return alt === undefined ? withSrc : setHtmlAttribute(withSrc, 'alt', alt);
  });
}

export function replaceAnnotatedElementStyle(
  source: string,
  targetId: string,
  styles: Record<string, string>,
) {
  return replaceAnnotatedStartTag(source, targetId, (startTag) => {
    const current = readHtmlAttribute(startTag, 'style');
    const nextStyles = new Map<string, string>();
    for (const declaration of current.split(';')) {
      const [rawName, ...rawValue] = declaration.split(':');
      const name = rawName?.trim();
      const value = rawValue.join(':').trim();
      if (name && value) nextStyles.set(name, value);
    }
    for (const [name, value] of Object.entries(styles)) {
      const cssName = toKebabCase(name);
      const cssValue = value.trim();
      if (cssValue) nextStyles.set(cssName, cssValue);
      else nextStyles.delete(cssName);
    }
    const styleValue = [...nextStyles.entries()]
      .map(([name, value]) => `${name}: ${value}`)
      .join('; ');
    return styleValue
      ? setHtmlAttribute(startTag, 'style', styleValue)
      : removeHtmlAttribute(startTag, 'style');
  });
}

export function replaceAnnotatedElementOuterHtml(
  source: string,
  targetId: string,
  content: string,
) {
  const escapedId = escapeRegExp(targetId);
  const pairedPattern = new RegExp(
    `<([a-zA-Z][\\w:-]*)(?=[^>]*\\bdata-neuma-id=["']${escapedId}["'])[^>]*>[\\s\\S]*?</\\1>`,
    'm',
  );
  if (pairedPattern.test(source)) {
    return source.replace(pairedPattern, () => content);
  }

  const startTagPattern = new RegExp(
    `<([a-zA-Z][\\w:-]*)(?=[^>]*\\bdata-neuma-id=["']${escapedId}["'])[^>]*\\/?>`,
    'm',
  );
  if (startTagPattern.test(source)) {
    return source.replace(startTagPattern, () => content);
  }

  throw new Error(`Target element not found: ${targetId}`);
}

export function upsertRootToken(
  source: string,
  tokenName: string,
  value: string,
) {
  const tokenValue = value.trim();
  const tokenLinePattern = new RegExp(
    `(^\\s*)${escapeRegExp(tokenName)}\\s*:\\s*[^;\\n]*;?`,
    'm',
  );
  if (tokenLinePattern.test(source)) {
    return source.replace(
      tokenLinePattern,
      (_match, indent: string) => `${indent}${tokenName}: ${tokenValue};`,
    );
  }

  const rootPattern = /:root\s*\{([\s\S]*?)\}/m;
  if (rootPattern.test(source)) {
    return source.replace(rootPattern, (block, body: string) => {
      const indent = inferDeclarationIndent(body);
      const trimmedRight = body.replace(/\s*$/, '');
      const nextBody = trimmedRight
        ? `${trimmedRight}\n${indent}${tokenName}: ${tokenValue};\n`
        : `\n${indent}${tokenName}: ${tokenValue};\n`;
      return block.replace(body, nextBody);
    });
  }

  const prefix = source.trimEnd();
  const rootBlock = `:root {\n  ${tokenName}: ${tokenValue};\n}\n`;
  return prefix ? `${prefix}\n\n${rootBlock}` : rootBlock;
}

function replaceAnnotatedStartTag(
  source: string,
  targetId: string,
  replace: (startTag: string, tagName: string) => string,
) {
  const escapedId = escapeRegExp(targetId);
  const pattern = new RegExp(
    `(<([a-zA-Z][\\w:-]*)(?=[^>]*\\bdata-neuma-id=["']${escapedId}["'])[^>]*)(>)`,
    'm',
  );
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`Target element not found: ${targetId}`);
  }
  return source.replace(
    pattern,
    () => `${replace(match[1]!, match[2]!)}${match[3]!}`,
  );
}

function setHtmlAttribute(startTag: string, name: string, value: string) {
  const escapedName = escapeRegExp(name);
  const attrPattern = new RegExp(
    `(\\s${escapedName}\\s*=\\s*)(["'])(.*?)\\2`,
    'i',
  );
  if (attrPattern.test(startTag)) {
    return startTag.replace(
      attrPattern,
      (_match, prefix: string, quote: string) =>
        `${prefix}${quote}${escapeAttribute(value)}${quote}`,
    );
  }
  return `${startTag} ${name}="${escapeAttribute(value)}"`;
}

function removeHtmlAttribute(startTag: string, name: string) {
  const escapedName = escapeRegExp(name);
  return startTag.replace(
    new RegExp(`\\s${escapedName}\\s*=\\s*(["']).*?\\1`, 'i'),
    '',
  );
}

function readHtmlAttribute(startTag: string, name: string) {
  const escapedName = escapeRegExp(name);
  const attrPattern = new RegExp(
    `\\s${escapedName}\\s*=\\s*(["'])(.*?)\\1`,
    'i',
  );
  return startTag.match(attrPattern)?.[2] ?? '';
}

function toKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inferDeclarationIndent(body: string) {
  return body.match(/\n(\s*)[a-zA-Z-][^:]*:/)?.[1] ?? '  ';
}

async function readOptionalProjectFile(
  projectId: string,
  relativePath: string,
) {
  const resolved = resolveProjectPath(projectId, relativePath);
  return fs.readFile(resolved.absolutePath, 'utf-8').catch((error: unknown) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return '';
    }
    throw error;
  });
}

function patchJournalPath(projectId: string) {
  return resolveProjectPath(projectId, '.neuma/patches.ndjson').absolutePath;
}

async function appendPatchJournal(
  projectId: string,
  value: AppliedManualEditPatch | RevertedManualEditPatch,
) {
  await appendJsonl(patchJournalPath(projectId), value);
}
