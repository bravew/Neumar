import type { NeumaTargetPayload } from '@/components/artifacts/live/iframe-sandbox';
import { designBlobUrl } from '@/shared/hooks/useDesignMode';
import type { DesignFileEntry } from '@/shared/types/design-mode';

export type FileKind =
  | 'html'
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'sketch'
  | 'binary';

export function classifyFile(path: string | null): FileKind {
  if (!path) return 'binary';
  const lower = path.toLowerCase();
  if (/\.html?$/.test(lower)) return 'html';
  if (isSketchFilePath(lower)) return 'sketch';
  if (
    /\.(md|markdown|txt|json|jsonl|css|js|jsx|ts|tsx|svg|xml|csv|yaml|yml)$/.test(
      lower,
    )
  ) {
    return 'text';
  }
  if (/\.(png|jpe?g|webp|gif|svg)$/.test(lower)) return 'image';
  if (/\.(mp4|webm|mov)$/.test(lower)) return 'video';
  if (/\.(mp3|wav|m4a|ogg)$/.test(lower)) return 'audio';
  return 'binary';
}

export function isJsModuleFilePath(path: string | null): path is string {
  return Boolean(path && /\.(?:m?js|jsx|tsx)$/i.test(path));
}

export function isRetainablePreviewPath(path: string | null): path is string {
  const kind = classifyFile(path);
  return kind === 'html' || isJsModuleFilePath(path);
}

export function flattenDesignFilePaths(files: DesignFileEntry[]): string[] {
  const paths: string[] = [];
  const visit = (entries: DesignFileEntry[]) => {
    for (const entry of entries) {
      if (!entry.isDir) paths.push(entry.path);
      if (entry.children) visit(entry.children);
    }
  };
  visit(files);
  return paths;
}

export interface JsModuleHtmlCandidate {
  path: string;
  content: string;
}

export function candidateHtmlEntriesForModule(
  modulePath: string | null,
  filePaths: string[],
): string[] {
  if (!isJsModuleFilePath(modulePath)) return [];
  const moduleFilePath = modulePath;
  const dir = dirname(moduleFilePath);
  return filePaths
    .filter((path) => classifyFile(path) === 'html' && dirname(path) === dir)
    .sort((a, b) => htmlEntryPriority(a) - htmlEntryPriority(b));
}

export function findJsModuleHtmlEntry(
  modulePath: string | null,
  candidates: JsModuleHtmlCandidate[],
): string | null {
  if (!isJsModuleFilePath(modulePath)) return null;
  const moduleFilePath = modulePath;
  for (const candidate of candidates) {
    if (
      htmlReferencesModule(candidate.path, candidate.content, moduleFilePath)
    ) {
      return candidate.path;
    }
  }
  return null;
}

function htmlReferencesModule(
  htmlPath: string,
  html: string,
  modulePath: string,
): boolean {
  const scriptPattern = /<script\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(html))) {
    const tag = match[0] ?? '';
    const type = attributeValue(tag, 'type');
    if (!type || !/^text\/(?:babel|jsx)$/i.test(type.trim())) continue;
    const src = attributeValue(tag, 'src');
    if (!src) continue;
    if (resolveProjectRelativePath(dirname(htmlPath), src) === modulePath) {
      return true;
    }
  }
  return false;
}

function attributeValue(tag: string, name: string): string | null {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  );
  const match = pattern.exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function resolveProjectRelativePath(baseDir: string, rawSrc: string): string {
  const [withoutHash] = rawSrc.split('#');
  const [withoutQuery] = (withoutHash ?? '').split('?');
  const src = safeDecodeURIComponent(withoutQuery ?? '').replace(/\\/g, '/');
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) {
    return '';
  }
  if (src.startsWith('/')) return normalizeProjectPath(src.slice(1));
  return normalizeProjectPath(baseDir ? `${baseDir}/${src}` : src);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeProjectPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function htmlEntryPriority(path: string): number {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (name === 'index.html' || name === 'index.htm') return 0;
  return 1;
}

export function isSketchFilePath(path: string | null): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  return lower.endsWith('.sketch.json') || /^sketches\/.+\.json$/.test(lower);
}

export function sketchScreenIdFromPath(path: string): string {
  const match = /^sketches\/(.+)\.json$/i.exec(path);
  if (match?.[1]) return match[1].replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80);
  return path.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80);
}

export function formatJsonFileTextForDisplay(
  path: string | null,
  text: string,
): string {
  if (!isJsonFilePath(path)) return text;
  try {
    if (hasPrecisionSensitiveJsonNumberText(text)) return text;
    const parsed = JSON.parse(text) as unknown;
    if (hasUnsafeJsonNumber(parsed)) return text;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function isJsonFilePath(path: string | null): boolean {
  return Boolean(path && /\.json$/i.test(path));
}

function hasPrecisionSensitiveJsonNumberText(text: string): boolean {
  let inString = false;
  let escaped = false;
  const numberTokenPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      i += 1;
      continue;
    }

    numberTokenPattern.lastIndex = i;
    const match = numberTokenPattern.exec(text);
    if (!match) {
      i += 1;
      continue;
    }

    const token = match[0];
    if (isSignedNegativeZeroJsonNumberToken(token)) return true;
    if (/[.eE]/.test(token) && isPrecisionSensitiveJsonNumberToken(token)) {
      return true;
    }
    i = numberTokenPattern.lastIndex;
  }
  return false;
}

function isSignedNegativeZeroJsonNumberToken(token: string): boolean {
  return /^-0(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(token);
}

function isPrecisionSensitiveJsonNumberToken(token: string): boolean {
  const parsed = Number(token);
  if (!Number.isFinite(parsed)) return true;
  const rendered = JSON.stringify(parsed);
  if (!rendered) return true;
  const originalValue = parseJsonNumberTokenAsDecimal(token);
  const renderedValue = parseJsonNumberTokenAsDecimal(rendered);
  return (
    !originalValue ||
    !renderedValue ||
    originalValue.coefficient !== renderedValue.coefficient ||
    originalValue.exponent !== renderedValue.exponent
  );
}

function parseJsonNumberTokenAsDecimal(
  token: string,
): { coefficient: bigint; exponent: number } | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) return null;
  const [, sign, integerPart, fractionPart = '', exponentPart = '0'] = match;
  const coefficient = BigInt(`${sign ?? ''}${integerPart}${fractionPart}`);
  const exponent = Number(exponentPart) - fractionPart.length;
  return normalizeDecimalParts(coefficient, exponent);
}

function normalizeDecimalParts(
  coefficient: bigint,
  exponent: number,
): { coefficient: bigint; exponent: number } {
  if (coefficient === 0n) return { coefficient: 0n, exponent: 0 };
  let normalizedCoefficient = coefficient;
  let normalizedExponent = exponent;
  while (normalizedCoefficient % 10n === 0n) {
    normalizedCoefficient /= 10n;
    normalizedExponent += 1;
  }
  return { coefficient: normalizedCoefficient, exponent: normalizedExponent };
}

function hasUnsafeJsonNumber(value: unknown): boolean {
  if (typeof value === 'number') {
    return (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    );
  }
  if (Array.isArray(value)) return value.some(hasUnsafeJsonNumber);
  if (value && typeof value === 'object') {
    return Object.values(value).some(hasUnsafeJsonNumber);
  }
  return false;
}

export function parseNeumaTarget(payload: unknown): NeumaTargetPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = payload as Partial<NeumaTargetPayload>;
  if (value.kind !== 'neuma-target' || typeof value.id !== 'string') {
    return null;
  }
  return {
    kind: 'neuma-target',
    id: value.id,
    selector: value.selector,
    role: value.role,
    label: value.label,
    screen: value.screen,
    tagName: value.tagName || 'ELEMENT',
    text: value.text,
    pin:
      value.pin &&
      typeof value.pin === 'object' &&
      typeof value.pin.x === 'number' &&
      typeof value.pin.y === 'number'
        ? value.pin
        : undefined,
    styles:
      typeof value.styles === 'object' && value.styles !== null
        ? value.styles
        : undefined,
  };
}

export function parseNeumaTargetList(payload: unknown): NeumaTargetPayload[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const value = payload as { kind?: unknown; targets?: unknown };
  if (value.kind !== 'neuma-target-list' || !Array.isArray(value.targets)) {
    return [];
  }
  const targets: NeumaTargetPayload[] = [];
  for (const item of value.targets) {
    const target = parseNeumaTarget(item);
    if (target) targets.push(target);
  }
  return targets;
}

export function MediaPreview({
  projectId,
  path,
  kind,
  zoom,
  fastStartNote,
}: {
  projectId: string;
  path: string;
  kind: FileKind;
  zoom: number;
  fastStartNote?: string;
}) {
  const src = designBlobUrl(projectId, path);
  const scale = zoom / 100;
  const showFastStartNote = kind === 'video' && /\.mp4$/i.test(path);
  return (
    <div className="bg-muted/20 flex h-full min-h-[420px] flex-col items-center justify-center gap-3 overflow-auto rounded-md border p-4">
      <div
        className="max-w-full origin-center"
        style={{ transform: `scale(${scale})` }}
      >
        {kind === 'image' ? (
          <img
            src={src}
            alt=""
            className="max-h-[70vh] max-w-full rounded-md object-contain"
          />
        ) : kind === 'video' ? (
          <video
            src={src}
            className="max-h-[70vh] max-w-full rounded-md"
            controls
          />
        ) : (
          <audio src={src} controls className="w-[min(36rem,80vw)]" />
        )}
      </div>
      {showFastStartNote && fastStartNote && (
        <p className="text-muted-foreground max-w-xl text-center text-xs">
          {fastStartNote}
        </p>
      )}
    </div>
  );
}
