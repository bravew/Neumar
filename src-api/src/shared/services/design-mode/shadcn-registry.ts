import fs from 'node:fs/promises';
import path from 'node:path';

import { safeFetch } from '@/shared/network-policy/fetch';
import { externalApiPolicy } from '@/shared/network-policy/schema';

import { getDesignSystem, type DesignSystemRecord } from './catalogs';
import { getDesignWorkspaceRoot, writeJsonAtomic, writeTextAtomic } from './fs';

const MAX_REGISTRY_BYTES = 1_000_000;
const MAX_REGISTRY_FILES = 100;
const MAX_FILE_CONTENT_BYTES = 120_000;
const MAX_COMPONENT_SNIPPET_CHARS = 12_000;
const MAX_COMPONENTS_HTML_CHARS = 120_000;
const MAX_CSS_VALUE_LENGTH = 500;
const MAX_RAW_CSS_LENGTH = 100_000;
const MAX_CSS_RULES = 250;

const SHADCN_REGISTRY_TYPES = new Set([
  'registry:base',
  'registry:block',
  'registry:component',
  'registry:font',
  'registry:hook',
  'registry:item',
  'registry:file',
  'registry:lib',
  'registry:page',
  'registry:style',
  'registry:theme',
  'registry:ui',
]);

const CSS_CUSTOM_PROPERTY_PATTERN = /^--[a-z][a-z0-9-]{0,198}$/;
const CSS_PROPERTY_PATTERN = /^-?[A-Za-z_][A-Za-z0-9_-]{0,120}$/;
const CSS_RULE_PATTERN = /^[^{};<>]{1,180}$/;
const CONTROL_CHAR_PATTERN = /[\0-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const DANGEROUS_CSS_PATTERN = /(?:@import\b|\burl\s*\(|\bexpression\s*\()/i;
const CSS_VALUE_BREAKOUT_PATTERN = /[{};]|<\/style/i;
const COLOR_TOKEN_NAMES = new Set([
  'accent',
  'background',
  'border',
  'brand',
  'card',
  'card-foreground',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'destructive',
  'foreground',
  'input',
  'muted',
  'muted-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'ring',
  'secondary',
  'secondary-foreground',
  'sidebar',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-ring',
]);

export class ShadcnRegistryImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShadcnRegistryImportError';
  }
}

export interface ImportShadcnRegistryDesignSystemInput {
  url: string;
  item?: string;
  id?: string;
  title?: string;
  category?: string;
  summary?: string;
}

interface ShadcnRegistryFile {
  path: string;
  type: string;
  target?: string;
  content?: string;
}

interface ShadcnCssVars {
  theme: CssDeclaration[];
  light: CssDeclaration[];
  dark: CssDeclaration[];
}

interface CssDeclaration {
  name: string;
  value: string;
}

interface ShadcnRegistryItem {
  name: string;
  type: string;
  title?: string;
  description?: string;
  dependencies: string[];
  devDependencies: string[];
  registryDependencies: string[];
  files: ShadcnRegistryFile[];
  cssVars: ShadcnCssVars;
  css?: unknown;
}

interface SelectedRegistryItem {
  item: ShadcnRegistryItem;
  registryName?: string;
}

export async function importShadcnRegistryDesignSystem({
  url,
  item,
  id,
  title,
  category,
  summary,
}: ImportShadcnRegistryDesignSystemInput): Promise<DesignSystemRecord> {
  const requestedUrl = parseImportUrl(url);
  const response = await fetchRegistryJson(requestedUrl.toString());
  const selected = selectRegistryItem(response.document, item);
  const registryItem = selected.item;
  const systemId = slugifyCatalogId(
    id || registryItem.name || title || registryItem.title || 'shadcn-registry',
  );
  const systemTitle = normalizeMarkdownLine(
    title || registryItem.title || titleFromSlug(systemId),
  );
  const systemCategory = normalizeMarkdownLine(category || 'Imported');
  const systemSummary = normalizeMarkdownLine(
    summary ||
      registryItem.description ||
      `Imported from shadcn registry item ${registryItem.name}.`,
  );
  const storedSourceUrl = redactUrlForStorage(response.finalUrl);
  const root = path.join(
    getDesignWorkspaceRoot(),
    '.neuma/design-systems',
    systemId,
  );
  const meta = {
    id: systemId,
    sourceKind: 'shadcn-registry',
    sourceUrl: storedSourceUrl,
    requestedUrl: redactUrlForStorage(requestedUrl.toString()),
    registryName: selected.registryName,
    registryItem: registryItem.name,
    registryType: registryItem.type,
    createdAt: new Date().toISOString(),
  };
  const markdown = compileDesignSystemMarkdown({
    title: systemTitle,
    category: systemCategory,
    summary: systemSummary,
    sourceUrl: storedSourceUrl,
    registryName: selected.registryName,
    item: registryItem,
  });
  const tokenCss = compileShadcnDesignSystemCss(registryItem);
  const componentsHtml = compileComponentsHtml(registryItem);

  await writeJsonAtomic(path.join(root, 'meta.json'), meta);
  await writeTextAtomic(path.join(root, 'DESIGN.md'), markdown);
  await writeTextAtomic(path.join(root, 'tokens.css'), tokenCss);
  if (componentsHtml) {
    await writeTextAtomic(path.join(root, 'components.html'), componentsHtml);
  } else {
    await fs.rm(path.join(root, 'components.html'), { force: true });
  }

  const record = await getDesignSystem(systemId);
  if (!record) {
    throw new ShadcnRegistryImportError(
      'Imported shadcn design system could not be read',
    );
  }
  return record;
}

function compileShadcnDesignSystemCss(
  item: Pick<ShadcnRegistryItem, 'name' | 'cssVars' | 'css'>,
): string {
  const lines = [
    `/* Generated from shadcn registry item ${sanitizeCssComment(item.name)}. */`,
  ];

  if (item.cssVars.light.length > 0) {
    lines.push(':root {');
    for (const declaration of item.cssVars.light) {
      lines.push(`  ${declaration.name}: ${declaration.value};`);
    }
    lines.push('}', '');
  }

  if (item.cssVars.dark.length > 0) {
    lines.push('.dark {');
    for (const declaration of item.cssVars.dark) {
      lines.push(`  ${declaration.name}: ${declaration.value};`);
    }
    lines.push('}', '');
  }

  const themeEntries = compileTailwindThemeEntries(item.cssVars);
  if (themeEntries.length > 0) {
    lines.push('@theme {');
    for (const declaration of themeEntries) {
      lines.push(`  ${declaration.name}: ${declaration.value};`);
    }
    lines.push('}', '');
  }

  const css = compileRegistryCss(item.css);
  if (css) {
    lines.push('/* Additional registry CSS. */', css, '');
  }

  if (lines.length === 1) {
    lines.push('/* This registry item did not define cssVars or css. */', '');
  }

  return lines.join('\n');
}

function parseImportUrl(input: string): URL {
  if (input.length > 2048) {
    throw new ShadcnRegistryImportError('Registry URL is too long');
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ShadcnRegistryImportError('Registry URL must be a valid URL');
  }
  if (url.protocol !== 'https:') {
    throw new ShadcnRegistryImportError('Registry URL must use HTTPS');
  }
  if (url.username || url.password) {
    throw new ShadcnRegistryImportError(
      'Registry URL must not include credentials',
    );
  }
  return url;
}

async function fetchRegistryJson(url: string): Promise<{
  document: unknown;
  finalUrl: string;
}> {
  let response: Awaited<ReturnType<typeof safeFetch>>;
  try {
    response = await safeFetch(url, externalApiPolicy(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      timeoutMs: 15_000,
      maxRedirects: 3,
      maxBytes: MAX_REGISTRY_BYTES,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'NetworkPolicyDenied') {
      throw new ShadcnRegistryImportError(
        'Registry URL is not allowed by the network policy',
      );
    }
    throw new ShadcnRegistryImportError(
      `Failed to fetch shadcn registry: ${errorMessage(error)}`,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new ShadcnRegistryImportError(
      `Registry returned HTTP ${response.status}`,
    );
  }
  if (response.body.byteLength > MAX_REGISTRY_BYTES) {
    throw new ShadcnRegistryImportError('Registry response is too large');
  }

  try {
    return {
      document: JSON.parse(response.body.toString('utf-8')),
      finalUrl: response.finalUrl,
    };
  } catch {
    throw new ShadcnRegistryImportError('Registry response must be valid JSON');
  }
}

function selectRegistryItem(
  document: unknown,
  requestedItem: string | undefined,
): SelectedRegistryItem {
  if (!isRecord(document)) {
    throw new ShadcnRegistryImportError('Registry document must be an object');
  }

  if (Array.isArray(document.items)) {
    const items = document.items.map(normalizeRegistryItem);
    const selected =
      requestedItem !== undefined
        ? items.find((entry) => entry.name === requestedItem)
        : items.length === 1
          ? items[0]
          : undefined;
    if (!selected) {
      throw new ShadcnRegistryImportError(
        requestedItem
          ? `Registry item not found: ${requestedItem}`
          : 'Registry contains multiple items; provide an item name',
      );
    }
    return {
      item: selected,
      registryName: stringValue(document.name),
    };
  }

  return { item: normalizeRegistryItem(document) };
}

function normalizeRegistryItem(document: unknown): ShadcnRegistryItem {
  if (!isRecord(document)) {
    throw new ShadcnRegistryImportError('Registry item must be an object');
  }
  const name = requiredString(document.name, 'Registry item name');
  const type = requiredString(document.type, 'Registry item type');
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(name)) {
    throw new ShadcnRegistryImportError('Registry item name is invalid');
  }
  if (!SHADCN_REGISTRY_TYPES.has(type)) {
    throw new ShadcnRegistryImportError(
      `Unsupported shadcn registry item type: ${type}`,
    );
  }

  return {
    name,
    type,
    title: stringValue(document.title),
    description: stringValue(document.description),
    dependencies: stringArray(document.dependencies, 'dependencies'),
    devDependencies: stringArray(document.devDependencies, 'devDependencies'),
    registryDependencies: stringArray(
      document.registryDependencies,
      'registryDependencies',
    ),
    files: normalizeRegistryFiles(document.files),
    cssVars: normalizeCssVars(document.cssVars),
    css: document.css,
  };
}

function normalizeRegistryFiles(input: unknown): ShadcnRegistryFile[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    throw new ShadcnRegistryImportError('Registry files must be an array');
  }
  if (input.length > MAX_REGISTRY_FILES) {
    throw new ShadcnRegistryImportError(
      'Registry item declares too many files',
    );
  }

  return input.map((file, index) => {
    if (!isRecord(file)) {
      throw new ShadcnRegistryImportError(
        `Registry file ${index + 1} must be an object`,
      );
    }
    const filePath = requiredString(file.path, `Registry file ${index + 1}`);
    const fileType = requiredString(file.type, `Registry file ${index + 1}`);
    assertSafeRegistryPath(filePath, `Registry file ${index + 1} path`);
    if (!SHADCN_REGISTRY_TYPES.has(fileType)) {
      throw new ShadcnRegistryImportError(
        `Unsupported shadcn registry file type: ${fileType}`,
      );
    }
    const target = stringValue(file.target);
    if (target) {
      assertSafeRegistryPath(target, `Registry file ${index + 1} target`);
    }
    let content: string | undefined;
    if (file.content !== undefined) {
      if (typeof file.content !== 'string') {
        throw new ShadcnRegistryImportError(
          `Registry file ${filePath} content must be a string`,
        );
      }
      content = file.content;
    }
    if (
      content &&
      Buffer.byteLength(content, 'utf-8') > MAX_FILE_CONTENT_BYTES
    ) {
      throw new ShadcnRegistryImportError(
        `Registry file ${filePath} content is too large`,
      );
    }

    return {
      path: filePath,
      type: fileType,
      target,
      content,
    };
  });
}

function normalizeCssVars(input: unknown): ShadcnCssVars {
  if (input === undefined) return { theme: [], light: [], dark: [] };
  if (!isRecord(input)) {
    throw new ShadcnRegistryImportError('Registry cssVars must be an object');
  }

  const hasSection =
    isRecord(input.theme) || isRecord(input.light) || isRecord(input.dark);
  if (!hasSection) {
    return {
      theme: [],
      light: normalizeCssDeclarations(input, 'cssVars'),
      dark: [],
    };
  }

  return {
    theme: normalizeCssDeclarations(input.theme, 'cssVars.theme'),
    light: normalizeCssDeclarations(input.light, 'cssVars.light'),
    dark: normalizeCssDeclarations(input.dark, 'cssVars.dark'),
  };
}

function normalizeCssDeclarations(
  input: unknown,
  label: string,
): CssDeclaration[] {
  if (input === undefined) return [];
  if (!isRecord(input)) {
    throw new ShadcnRegistryImportError(`${label} must be an object`);
  }
  return Object.entries(input).map(([name, value]) => ({
    name: normalizeCssCustomProperty(name),
    value: normalizeCssValue(value, `${label}.${name}`),
  }));
}

function compileTailwindThemeEntries(cssVars: ShadcnCssVars): CssDeclaration[] {
  const entries = new Map<string, string>();
  for (const declaration of cssVars.theme) {
    entries.set(declaration.name, declaration.value);
  }

  for (const declaration of [...cssVars.light, ...cssVars.dark]) {
    const inferred = inferTailwindThemeName(declaration);
    if (inferred && !entries.has(inferred)) {
      entries.set(inferred, `var(${declaration.name})`);
    }
  }

  return [...entries].map(([name, value]) => ({ name, value }));
}

function inferTailwindThemeName(declaration: CssDeclaration): string | null {
  const base = declaration.name.slice(2);
  if (base.startsWith('color-')) return declaration.name;
  if (
    base.startsWith('font-') ||
    base.startsWith('radius') ||
    base.startsWith('shadow-') ||
    base.startsWith('spacing-') ||
    base.startsWith('text-')
  ) {
    return declaration.name;
  }
  if (COLOR_TOKEN_NAMES.has(base) || looksLikeColorValue(declaration.value)) {
    return normalizeCssCustomProperty(`color-${base}`);
  }
  return null;
}

function looksLikeColorValue(value: string): boolean {
  return (
    /^#[0-9a-f]{3,8}$/i.test(value) ||
    /^(?:oklch|hsl|rgb|lab|lch|color-mix)\(/i.test(value) ||
    /^-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?%?\s+-?\d+(?:\.\d+)?%?/.test(value)
  );
}

function compileRegistryCss(input: unknown): string {
  if (input === undefined) return '';
  if (typeof input === 'string') {
    assertSafeRawCss(input);
    return input.trim();
  }
  if (!isRecord(input)) {
    throw new ShadcnRegistryImportError('Registry css must be an object');
  }

  const context = { rules: 0 };
  const lines: string[] = [];
  for (const [rule, body] of Object.entries(input)) {
    lines.push(...compileCssRule(rule, body, 0, context));
  }
  return lines.join('\n');
}

function compileCssRule(
  rule: string,
  body: unknown,
  depth: number,
  context: { rules: number },
): string[] {
  if (context.rules++ > MAX_CSS_RULES) {
    throw new ShadcnRegistryImportError('Registry css declares too many rules');
  }
  assertSafeCssRule(rule);
  if (!isRecord(body)) {
    throw new ShadcnRegistryImportError(`Registry css rule ${rule} is invalid`);
  }

  const indent = '  '.repeat(depth);
  if (Object.keys(body).length === 0 && rule.trim().startsWith('@')) {
    return [`${indent}${rule.trim()};`];
  }
  if (isCssDeclarationBlock(body)) {
    return [
      `${indent}${rule.trim()} {`,
      ...Object.entries(body).map(([property, value]) => {
        assertSafeCssProperty(property);
        return `${indent}  ${property}: ${normalizeCssValue(
          value,
          `css.${rule}.${property}`,
        )};`;
      }),
      `${indent}}`,
    ];
  }

  const lines = [`${indent}${rule.trim()} {`];
  for (const [childRule, childBody] of Object.entries(body)) {
    lines.push(...compileCssRule(childRule, childBody, depth + 1, context));
  }
  lines.push(`${indent}}`);
  return lines;
}

function isCssDeclarationBlock(input: Record<string, unknown>): boolean {
  return Object.values(input).every(
    (value) => typeof value === 'string' || typeof value === 'number',
  );
}

function compileComponentsHtml(item: ShadcnRegistryItem): string | null {
  if (item.files.length === 0) return null;
  const lines = [
    `<section data-shadcn-registry="${escapeHtml(item.name)}">`,
    `  <h2>${escapeHtml(item.title || item.name)}</h2>`,
    '  <ul>',
  ];
  for (const file of item.files) {
    lines.push(
      `    <li><code>${escapeHtml(file.path)}</code> <span>${escapeHtml(
        file.type,
      )}</span>${file.target ? ` -> <code>${escapeHtml(file.target)}</code>` : ''}</li>`,
    );
  }
  lines.push('  </ul>');

  for (const file of item.files) {
    if (!file.content) continue;
    lines.push(
      `  <article data-path="${escapeHtml(file.path)}">`,
      `    <h3>${escapeHtml(file.path)}</h3>`,
      '    <pre><code>',
      escapeHtml(file.content.slice(0, MAX_COMPONENT_SNIPPET_CHARS)),
      '    </code></pre>',
      '  </article>',
    );
    if (lines.join('\n').length > MAX_COMPONENTS_HTML_CHARS) break;
  }

  lines.push('</section>', '');
  return lines.join('\n').slice(0, MAX_COMPONENTS_HTML_CHARS);
}

function compileDesignSystemMarkdown({
  title,
  category,
  summary,
  sourceUrl,
  registryName,
  item,
}: {
  title: string;
  category: string;
  summary: string;
  sourceUrl: string;
  registryName?: string;
  item: ShadcnRegistryItem;
}): string {
  const lines = [
    `# ${title}`,
    '',
    `> Category: ${category}`,
    `> ${summary}`,
    '',
    'This design system was imported from a shadcn registry item.',
    'Use `tokens.css` as the runtime binding contract for DesignMode generations.',
    '',
    '## Registry metadata',
    '',
    `- Item: \`${item.name}\``,
    `- Type: \`${item.type}\``,
    `- Source: ${sourceUrl}`,
  ];
  if (registryName) lines.push(`- Registry: \`${registryName}\``);
  appendList(lines, 'Registry dependencies', item.registryDependencies);
  appendList(lines, 'Dependencies', item.dependencies);
  appendList(lines, 'Dev dependencies', item.devDependencies);
  if (item.files.length > 0) {
    lines.push('', '## Files', '');
    for (const file of item.files.slice(0, 20)) {
      lines.push(
        `- \`${file.path}\` (${file.type})${
          file.target ? ` -> \`${file.target}\`` : ''
        }`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

function appendList(lines: string[], title: string, values: string[]) {
  if (values.length === 0) return;
  lines.push('', `## ${title}`, '');
  for (const value of values.slice(0, 30)) {
    lines.push(`- \`${normalizeMarkdownLine(value)}\``);
  }
}

function normalizeCssCustomProperty(input: string): string {
  const body = input
    .trim()
    .replace(/^--/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 198);
  const name = `--${body}`;
  if (!CSS_CUSTOM_PROPERTY_PATTERN.test(name)) {
    throw new ShadcnRegistryImportError(
      `Invalid CSS custom property name: ${input}`,
    );
  }
  return name;
}

function normalizeCssValue(input: unknown, label: string): string {
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw new ShadcnRegistryImportError(`${label} must be a CSS value`);
  }
  const value = String(input).trim();
  assertSafeCssValue(value, label);
  return value;
}

function assertSafeCssValue(value: string, label: string): void {
  if (!value || value.length > MAX_CSS_VALUE_LENGTH) {
    throw new ShadcnRegistryImportError(`${label} CSS value is invalid`);
  }
  if (
    CONTROL_CHAR_PATTERN.test(value) ||
    DANGEROUS_CSS_PATTERN.test(value) ||
    CSS_VALUE_BREAKOUT_PATTERN.test(value)
  ) {
    throw new ShadcnRegistryImportError(`${label} CSS value is unsafe`);
  }
}

function assertSafeRawCss(value: string): void {
  if (!value.trim() || value.length > MAX_RAW_CSS_LENGTH) {
    throw new ShadcnRegistryImportError('Registry css is invalid');
  }
  if (CONTROL_CHAR_PATTERN.test(value) || DANGEROUS_CSS_PATTERN.test(value)) {
    throw new ShadcnRegistryImportError('Registry css is unsafe');
  }
  if (/<\/style/i.test(value)) {
    throw new ShadcnRegistryImportError('Registry css is unsafe');
  }
}

function assertSafeCssRule(rule: string): void {
  const trimmed = rule.trim();
  if (
    !CSS_RULE_PATTERN.test(trimmed) ||
    /[\r\n]/.test(trimmed) ||
    CONTROL_CHAR_PATTERN.test(trimmed) ||
    DANGEROUS_CSS_PATTERN.test(trimmed)
  ) {
    throw new ShadcnRegistryImportError(`Unsafe CSS rule: ${rule}`);
  }
}

function assertSafeCssProperty(property: string): void {
  if (
    !CSS_PROPERTY_PATTERN.test(property) &&
    !CSS_CUSTOM_PROPERTY_PATTERN.test(property)
  ) {
    throw new ShadcnRegistryImportError(`Unsafe CSS property: ${property}`);
  }
}

function assertSafeRegistryPath(value: string, label: string): void {
  const normalized = value.replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.length > 500 ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new ShadcnRegistryImportError(`${label} is invalid`);
  }
}

function requiredString(input: unknown, label: string): string {
  const value = stringValue(input);
  if (!value) throw new ShadcnRegistryImportError(`${label} is required`);
  return value;
}

function stringArray(input: unknown, label: string): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    throw new ShadcnRegistryImportError(`${label} must be an array`);
  }
  return input.map((value, index) => {
    const text = stringValue(value);
    if (!text) {
      throw new ShadcnRegistryImportError(
        `${label}[${index}] must be a string`,
      );
    }
    return text.slice(0, 300);
  });
}

function stringValue(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() ? input.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeMarkdownLine(input: string): string {
  return input
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugifyCatalogId(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'shadcn-registry'
  );
}

function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ');
}

function redactUrlForStorage(input: string): string {
  const url = new URL(input);
  url.hash = '';
  if (url.search) url.search = '?redacted';
  return url.toString();
}

function sanitizeCssComment(input: string): string {
  return input.replace(/\*\//g, '* /').replace(CONTROL_CHAR_PATTERN, ' ');
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
