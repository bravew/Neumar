import path from 'node:path';

import {
  getDesignSystem,
  type DesignSystemRecord,
} from '@/shared/services/design-mode/catalogs';

import { getDesignWorkspaceRoot, writeJsonAtomic, writeTextAtomic } from './fs';

const MAX_DTCG_DEPTH = 12;
const MAX_DTCG_TOKENS = 1_000;
const MAX_DTCG_VALUE_LENGTH = 1_000;
const DTCG_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const CSS_CUSTOM_PROPERTY_PATTERN = /^--[a-z][a-z0-9-]{0,198}$/;
const DTCG_ALIAS_PATTERN = /^\{([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\}$/;
const CSS_UNIT_PATTERN = /^-?[a-zA-Z%][a-zA-Z0-9%]*$/;
const COLOR_TOKEN_NAMES = new Set([
  '--bg',
  '--surface',
  '--surface-warm',
  '--fg',
  '--fg-2',
  '--muted',
  '--meta',
  '--border',
  '--border-soft',
  '--accent',
  '--accent-on',
  '--accent-hover',
  '--accent-active',
  '--success',
  '--warn',
  '--danger',
]);

export class DtcgTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DtcgTokenError';
  }
}

export interface NormalizedDtcgToken {
  name: string;
  path: string[];
  type: string;
  value: string;
  description?: string;
  alias?: string;
}

interface PendingDtcgToken extends NormalizedDtcgToken {
  aliasPath?: string[];
}

export interface ImportDtcgDesignSystemInput {
  id?: string;
  title?: string;
  category?: string;
  summary?: string;
  document: unknown;
}

export interface CssDesignToken {
  name: string;
  value: string;
}

export async function importDtcgDesignSystem({
  id,
  title,
  category,
  summary,
  document,
}: ImportDtcgDesignSystemInput): Promise<DesignSystemRecord> {
  const tokens = normalizeDtcgTokens(document);
  const systemId = slugifyCatalogId(id || title || 'dtcg-design-system');
  const systemTitle = normalizeTitle(title, systemId);
  const systemSummary = normalizeMarkdownLine(
    summary || `Imported from W3C Design Tokens JSON.`,
  );
  const systemCategory = normalizeMarkdownLine(category || 'Imported');
  const root = path.join(
    getDesignWorkspaceRoot(),
    '.neuma/design-systems',
    systemId,
  );

  await writeJsonAtomic(path.join(root, 'meta.json'), {
    id: systemId,
    sourceKind: 'dtcg',
    tokenCount: tokens.length,
    createdAt: new Date().toISOString(),
  });
  await writeTextAtomic(
    path.join(root, 'DESIGN.md'),
    [
      `# ${systemTitle}`,
      '',
      `> Category: ${systemCategory}`,
      `> ${systemSummary}`,
      '',
      'This design system was imported from a W3C Design Tokens JSON document.',
      'Use `tokens.css` as the runtime binding contract and `tokens.dtcg.json` as the interchange snapshot.',
      '',
    ].join('\n'),
  );
  await writeTextAtomic(
    path.join(root, 'tokens.css'),
    compileDtcgTokens(tokens),
  );
  await writeJsonAtomic(
    path.join(root, 'tokens.dtcg.json'),
    tokensToDtcgDocument(tokens, {
      description: `Normalized DTCG export for ${systemTitle}.`,
    }),
  );

  const record = await getDesignSystem(systemId);
  if (!record) {
    throw new DtcgTokenError('Imported design system could not be read');
  }
  return record;
}

export function normalizeDtcgTokens(document: unknown): NormalizedDtcgToken[] {
  if (!isRecord(document)) {
    throw new DtcgTokenError('DTCG document must be a JSON object');
  }

  const tokens: PendingDtcgToken[] = [];
  walkDtcgNode(document, [], undefined, tokens);
  if (tokens.length === 0) {
    throw new DtcgTokenError('DTCG document does not contain any tokens');
  }
  if (tokens.length > MAX_DTCG_TOKENS) {
    throw new DtcgTokenError(
      `DTCG document has too many tokens (${tokens.length})`,
    );
  }

  const seenNames = new Set<string>();
  for (const token of tokens) {
    if (seenNames.has(token.name)) {
      throw new DtcgTokenError(`Duplicate CSS token name: ${token.name}`);
    }
    seenNames.add(token.name);
  }

  resolveAliases(tokens);
  return tokens.map(({ aliasPath: _aliasPath, ...token }) => token);
}

export function compileDtcgTokens(tokens: readonly NormalizedDtcgToken[]) {
  const rootLines = tokens.flatMap((token) => {
    const lines: string[] = [];
    if (token.description) {
      lines.push(`  /* ${sanitizeCssComment(token.description)} */`);
    }
    lines.push(`  ${token.name}: ${token.value};`);
    return lines;
  });
  const themeLines = compileTailwindThemeEntries(tokens).map(
    ([name, value]) => `  ${name}: ${value};`,
  );

  return [
    '/* Generated from W3C Design Tokens JSON. */',
    ':root {',
    ...rootLines,
    '}',
    '',
    '@theme {',
    ...themeLines,
    '}',
    '',
  ].join('\n');
}

export function designSystemTokensToDtcgDocument(
  system: Pick<DesignSystemRecord, 'title' | 'tokenCss'>,
): Record<string, unknown> {
  const tokens = extractCssCustomProperties(system.tokenCss ?? '');
  if (tokens.length === 0) {
    throw new DtcgTokenError('Design system does not define tokens.css');
  }
  return cssTokensToDtcgDocument(tokens, {
    description: `Exported from Neuma DesignMode design system ${system.title}.`,
  });
}

export function extractCssCustomProperties(css: string): CssDesignToken[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Map<string, string>();
  let index = 0;
  while (index < stripped.length) {
    const match = /:root\s*\{/g.exec(stripped.slice(index));
    if (!match) break;
    const openIndex = index + match.index + match[0].length - 1;
    const closeIndex = findMatchingBrace(stripped, openIndex);
    if (closeIndex < 0) break;
    for (const token of parseCssDeclarations(
      stripped.slice(openIndex + 1, closeIndex),
    )) {
      tokens.set(token.name, token.value);
    }
    index = closeIndex + 1;
  }
  return [...tokens].map(([name, value]) => ({ name, value }));
}

export function cssTokensToDtcgDocument(
  tokens: readonly CssDesignToken[],
  options: { description?: string } = {},
): Record<string, unknown> {
  const document: Record<string, unknown> = {
    $schema: 'https://www.designtokens.org/tr/drafts/format/',
  };
  if (options.description) document.$description = options.description;

  const exportPaths = new Map<string, string[]>();
  for (const token of tokens) {
    assertCssCustomProperty(token.name);
    assertCssValue(token.value, token.name);
    exportPaths.set(token.name, exportPathForCssToken(token));
  }

  for (const token of tokens) {
    const type = inferDtcgType(token);
    const exportPath = exportPaths.get(token.name);
    if (!exportPath) continue;
    const aliasName = parseCssAlias(token.value);
    const aliasPath = aliasName ? exportPaths.get(aliasName) : undefined;
    const value = aliasPath ? `{${aliasPath.join('.')}}` : token.value;
    insertDtcgLeaf(document, exportPath, {
      $value: value,
      $extensions: {
        neuma: {
          cssName: token.name,
        },
      },
    });

    const groupName = exportPath[0];
    if (!groupName) continue;
    const group = getOrCreateRecord(document, groupName);
    if (!stringValue(group.$type)) group.$type = type;
  }
  return document;
}

export function tokensToDtcgDocument(
  tokens: readonly NormalizedDtcgToken[],
  options: { description?: string } = {},
): Record<string, unknown> {
  const document: Record<string, unknown> = {
    $schema: 'https://www.designtokens.org/tr/drafts/format/',
  };
  if (options.description) document.$description = options.description;

  for (const token of tokens) {
    insertDtcgLeaf(document, token.path, {
      $value: token.alias
        ? `{${tokenPathForAlias(tokens, token.alias)}}`
        : token.value,
      $type: token.type,
      ...(token.description ? { $description: token.description } : {}),
      $extensions: {
        neuma: {
          cssName: token.name,
        },
      },
    });
  }

  return document;
}

function walkDtcgNode(
  node: Record<string, unknown>,
  tokenPath: string[],
  inheritedType: string | undefined,
  tokens: PendingDtcgToken[],
) {
  if (tokenPath.length > MAX_DTCG_DEPTH) {
    throw new DtcgTokenError('DTCG token nesting is too deep');
  }

  const nodeType = stringValue(node.$type) || inheritedType || 'string';
  if ('$value' in node) {
    const childKeys = Object.keys(node).filter((key) => !key.startsWith('$'));
    if (childKeys.length > 0) {
      throw new DtcgTokenError(
        `DTCG token ${tokenPath.join('.')} cannot also contain child tokens`,
      );
    }
    if (tokenPath.length === 0) {
      throw new DtcgTokenError('Root DTCG token is not supported');
    }
    const normalized = normalizeDtcgValue(node.$value, tokenPath);
    tokens.push({
      name: resolveCssTokenName(node, tokenPath),
      path: [...tokenPath],
      type: nodeType,
      value: normalized.value,
      description: stringValue(node.$description),
      aliasPath: normalized.aliasPath,
    });
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    assertDtcgPathSegment(key);
    if (!isRecord(value)) {
      throw new DtcgTokenError(
        `DTCG node ${[...tokenPath, key].join('.')} must be an object`,
      );
    }
    walkDtcgNode(value, [...tokenPath, key], nodeType, tokens);
  }
}

function normalizeDtcgValue(
  value: unknown,
  tokenPath: readonly string[],
): { value: string; aliasPath?: string[] } {
  if (typeof value === 'string') {
    const aliasPath = parseDtcgAliasPath(value);
    if (aliasPath) {
      return { value: '', aliasPath };
    }
    const cssValue = value.trim();
    assertDtcgLiteralCssValue(cssValue, tokenPath.join('.'));
    return { value: cssValue };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new DtcgTokenError(
        `Invalid numeric token value: ${tokenPath.join('.')}`,
      );
    }
    return { value: String(value) };
  }
  if (typeof value === 'boolean') {
    return { value: String(value) };
  }
  if (isRecord(value)) {
    const scalar = value.value;
    const unit = stringValue(value.unit);
    if ((typeof scalar === 'number' || typeof scalar === 'string') && unit) {
      if (!CSS_UNIT_PATTERN.test(unit)) {
        throw new DtcgTokenError(`Invalid token unit: ${tokenPath.join('.')}`);
      }
      const cssValue = `${scalar}${unit}`;
      assertDtcgLiteralCssValue(cssValue, tokenPath.join('.'));
      return { value: cssValue };
    }
  }
  throw new DtcgTokenError(
    `Unsupported DTCG token value: ${tokenPath.join('.')}`,
  );
}

function resolveCssTokenName(
  node: Record<string, unknown>,
  tokenPath: readonly string[],
) {
  const cssName = readCssNameExtension(node);
  if (cssName) {
    assertCssCustomProperty(cssName);
    return cssName;
  }

  const slug = tokenPath.map(cssSegmentFromDtcgSegment).join('-');
  const name = `--${slug}`;
  assertCssCustomProperty(name);
  return name;
}

function readCssNameExtension(node: Record<string, unknown>) {
  const extensions = node.$extensions;
  if (!isRecord(extensions)) return undefined;
  const neuma = extensions.neuma;
  if (!isRecord(neuma)) return undefined;
  return stringValue(neuma.cssName);
}

function cssSegmentFromDtcgSegment(segment: string) {
  const raw = segment.startsWith('--') ? segment.slice(2) : segment;
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function resolveAliases(tokens: PendingDtcgToken[]) {
  const byPath = new Map(tokens.map((token) => [pathKey(token.path), token]));
  for (const token of tokens) {
    if (!token.aliasPath) continue;
    const target = byPath.get(pathKey(token.aliasPath));
    if (!target) {
      throw new DtcgTokenError(
        `Unknown DTCG alias ${token.aliasPath.join('.')} for ${token.path.join('.')}`,
      );
    }
    token.alias = target.name;
    token.value = `var(${target.name})`;
  }

  const graph = new Map(
    tokens
      .filter((token) => token.alias)
      .map((token) => [token.name, token.alias as string]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  for (const token of tokens) {
    detectAliasCycle(token.name, graph, visiting, visited, []);
  }
}

function detectAliasCycle(
  name: string,
  graph: ReadonlyMap<string, string>,
  visiting: Set<string>,
  visited: Set<string>,
  stack: string[],
) {
  if (visited.has(name)) return;
  if (visiting.has(name)) {
    throw new DtcgTokenError(
      `DTCG alias cycle: ${[...stack, name].join(' -> ')}`,
    );
  }
  visiting.add(name);
  const next = graph.get(name);
  if (next) detectAliasCycle(next, graph, visiting, visited, [...stack, name]);
  visiting.delete(name);
  visited.add(name);
}

function parseDtcgAliasPath(value: string) {
  const match = DTCG_ALIAS_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const rawPath = match[1];
  if (!rawPath) return undefined;
  const segments = rawPath.split('.');
  for (const segment of segments) {
    assertDtcgPathSegment(segment);
  }
  return segments;
}

function assertDtcgPathSegment(segment: string) {
  if (segment.startsWith('--')) {
    assertCssCustomProperty(segment);
    return;
  }
  if (!DTCG_SEGMENT_PATTERN.test(segment)) {
    throw new DtcgTokenError(`Invalid DTCG token name segment: ${segment}`);
  }
}

function assertCssCustomProperty(name: string) {
  if (!CSS_CUSTOM_PROPERTY_PATTERN.test(name)) {
    throw new DtcgTokenError(`Invalid CSS custom property name: ${name}`);
  }
}

function assertCssValue(value: string, tokenName: string) {
  if (
    !value ||
    value.length > MAX_DTCG_VALUE_LENGTH ||
    /[\0-\x1F{};]/.test(value) ||
    /\/\*|\*\//.test(value) ||
    /url\s*\(/i.test(value) ||
    /@import/i.test(value)
  ) {
    throw new DtcgTokenError(`Unsafe CSS token value: ${tokenName}`);
  }
}

function assertDtcgLiteralCssValue(value: string, tokenName: string) {
  assertCssValue(value, tokenName);
  if (/var\s*\(/i.test(value)) {
    throw new DtcgTokenError(
      `DTCG aliases must use {path.to.token} syntax: ${tokenName}`,
    );
  }
}

function compileTailwindThemeEntries(tokens: readonly NormalizedDtcgToken[]) {
  const entries = new Map<string, string>();
  for (const token of tokens) {
    const themeName = tailwindThemeNameForToken(token);
    if (!themeName) continue;
    entries.set(
      themeName,
      themeName === token.name ? token.value : `var(${token.name})`,
    );
  }
  return [...entries.entries()];
}

function tailwindThemeNameForToken(
  token: Pick<NormalizedDtcgToken, 'name' | 'type'>,
) {
  if (/^--(color|font|text|radius|shadow|ease|container)-/.test(token.name)) {
    return token.name;
  }
  const slug = token.name.slice(2);
  if (token.type === 'color' || COLOR_TOKEN_NAMES.has(token.name)) {
    return `--color-${slug}`;
  }
  if (token.type === 'fontFamily' || token.name.startsWith('--font-')) {
    return token.name.startsWith('--font-') ? token.name : `--font-${slug}`;
  }
  if (token.type === 'dimension') {
    if (token.name.startsWith('--space-')) {
      return `--spacing-${token.name.slice('--space-'.length)}`;
    }
    if (
      token.name.startsWith('--text-') ||
      token.name.startsWith('--radius-')
    ) {
      return token.name;
    }
  }
  if (token.type === 'shadow' || token.name.startsWith('--elev-')) {
    return `--shadow-${slug.replace(/^elev-/, '')}`;
  }
  if (token.type === 'cubicBezier' || token.name.startsWith('--ease-')) {
    return token.name.startsWith('--ease-') ? token.name : `--ease-${slug}`;
  }
  return undefined;
}

function findMatchingBrace(css: string, openIndex: number) {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < css.length; index += 1) {
    const char = css[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseCssDeclarations(block: string): CssDesignToken[] {
  const tokens: CssDesignToken[] = [];
  let index = 0;
  while (index < block.length) {
    while (/\s/.test(block[index] ?? '')) index += 1;
    const colonIndex = block.indexOf(':', index);
    if (colonIndex < 0) break;
    const name = block.slice(index, colonIndex).trim();
    index = colonIndex + 1;
    const valueStart = index;
    let quote: string | null = null;
    let parenDepth = 0;
    for (; index < block.length; index += 1) {
      const char = block[index];
      if (quote) {
        if (char === '\\') {
          index += 1;
        } else if (char === quote) {
          quote = null;
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '(') parenDepth += 1;
      if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
      if (char === ';' && parenDepth === 0) break;
    }
    const value = block.slice(valueStart, index).trim();
    if (name.startsWith('--') && value) {
      assertCssCustomProperty(name);
      assertCssValue(value, name);
      tokens.push({ name, value });
    }
    index += 1;
  }
  return tokens;
}

function inferDtcgType(token: CssDesignToken) {
  if (
    token.name.startsWith('--color-') ||
    COLOR_TOKEN_NAMES.has(token.name) ||
    /^#(?:[0-9a-f]{3,8})$/i.test(token.value)
  ) {
    return 'color';
  }
  if (token.name.startsWith('--font-')) return 'fontFamily';
  if (
    token.name.startsWith('--text-') ||
    token.name.startsWith('--space-') ||
    token.name.startsWith('--spacing-') ||
    token.name.startsWith('--radius-') ||
    token.name.startsWith('--container-') ||
    /^-?\d*\.?\d+(px|rem|em|%|vw|vh|ch|lh)$/i.test(token.value)
  ) {
    return 'dimension';
  }
  if (token.name.startsWith('--elev-') || token.name.startsWith('--shadow-')) {
    return 'shadow';
  }
  if (token.name.startsWith('--motion-')) return 'duration';
  if (token.name.startsWith('--ease-')) return 'cubicBezier';
  return 'string';
}

function exportPathForCssToken(token: CssDesignToken) {
  const type = inferDtcgType(token);
  const group =
    type === 'fontFamily' ? 'font' : type === 'cubicBezier' ? 'easing' : type;
  return [group, token.name.slice(2)];
}

function insertDtcgLeaf(
  document: Record<string, unknown>,
  tokenPath: readonly string[],
  leaf: Record<string, unknown>,
) {
  let cursor = document;
  for (const segment of tokenPath.slice(0, -1)) {
    assertDtcgPathSegment(segment);
    cursor = getOrCreateRecord(cursor, segment);
  }
  const leafName = tokenPath[tokenPath.length - 1];
  if (!leafName) throw new DtcgTokenError('DTCG token path is empty');
  assertDtcgPathSegment(leafName);
  cursor[leafName] = leaf;
}

function getOrCreateRecord(parent: Record<string, unknown>, key: string) {
  const value = parent[key];
  if (isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function parseCssAlias(value: string) {
  const match = /^var\((--[a-z][a-z0-9-]*)\)$/.exec(value.trim());
  return match?.[1];
}

function tokenPathForAlias(
  tokens: readonly NormalizedDtcgToken[],
  cssName: string,
) {
  const target = tokens.find((token) => token.name === cssName);
  if (!target) return cssName.slice(2);
  return target.path.join('.');
}

function pathKey(segments: readonly string[]) {
  return segments.join('\u0000');
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function slugifyCatalogId(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'dtcg-design-system'
  );
}

function normalizeTitle(title: string | undefined, id: string) {
  return normalizeMarkdownLine(
    title ||
      id
        .split('-')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' '),
  );
}

function normalizeMarkdownLine(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function sanitizeCssComment(value: string) {
  return value.replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim();
}
