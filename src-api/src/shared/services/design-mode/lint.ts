import { createLogger } from '@/shared/utils/logger';

import type { DesignLintFinding } from './types';

const logger = createLogger('DesignLint');

const DEFAULT_TAILWIND_INDIGO = [
  '#6366f1',
  '#4f46e5',
  '#4338ca',
  '#3730a3',
  '#8b5cf6',
  '#7c3aed',
  '#a855f7',
];
const STATEFUL_SURFACE_RE =
  /\b(dashboard|kanban|table|grid|list|form|search|filter|results|inbox|feed|checkout|settings|profile|tasks?|tickets?|orders?|users?|messages?|notifications?)\b/i;
const STATEFUL_HTML_RE =
  /<(form|table|input|select|textarea)\b|\brole=["']?(table|grid|listbox|search|form)\b/i;
const LOADING_STATE_RE =
  /\b(loading|loaded|skeleton|spinner|progress|pending|aria-busy|fetching|refreshing|submitting|saving)\b/i;
const EMPTY_STATE_RE =
  /\b(empty state|no (?:data|results|records|items|tasks|tickets|orders|messages)|nothing (?:here|yet)|zero state|create your first|start by|no matches)\b/i;
const ERROR_STATE_RE =
  /\b(error|failed|failure|retry|try again|unable to|validation|role=["']alert|alertdialog|network unreachable|something went wrong)\b/i;
const INDEFINITE_SPINNER_RE =
  /\b(animate-(?:spin|pulse|bounce)|spinner)\b|\bloading(?:\.\.\.|…)\b|animation\s*:[^;{}]*\binfinite\b/i;
const SPINNER_TIMEOUT_RE =
  /\b(timeout|settimeout|cancel|retry|progress|taking longer|longer than expected|15s|15 s|60s|60 s|one minute)\b/i;
const REDUCED_MOTION_RE = /prefers-reduced-motion/i;
const TRANSFORM_MOTION_RE =
  /@keyframes[\s\S]{0,600}\btransform\s*:|\btransition(?:-property)?\s*:[^;{}]*(?:transform|all)\b|\banimation\s*:[^;{}]*|\banimate-[a-z-]+\b/i;
const PAGE_TRANSITION_RE =
  /\b(page transition|route transition|screen transition|cross-screen|view-transition|container morph)\b/i;
const TRANSITION_DURATION_RE =
  /\btransition(?:-duration)?\s*:\s*([^;{}]+)|\bduration-\[(\d+(?:\.\d+)?)(ms|s)\]|\bduration-(\d{3,4})\b/gi;
const BUTTON_OR_ANCHOR_RE = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const ROLE_BUTTON_RE =
  /<([a-z][\w:-]*)\b([^>]*\brole\s*=\s*(?:"button"|'button'|button)[^>]*)>([\s\S]*?)<\/\1>/gi;
const LANDMARK_TAGS = [
  'section',
  'header',
  'footer',
  'nav',
  'main',
  'aside',
  'article',
] as const;
const CTA_CLASS_RE =
  /(^|[-_])(btn|button|cta)([-_]|$)|^(btn|button|cta)([-_]|$)/i;
const PRIMARY_CLASS_RE = /(^|[-_])(primary|solid|filled|accent|cta)([-_]|$)/i;
const CTA_KEYWORDS = [
  'get started',
  'sign up',
  'sign in',
  'log in',
  'buy',
  'buy now',
  'shop now',
  'subscribe',
  'try it free',
  'start free trial',
  'free trial',
  'add to cart',
  'order now',
  'checkout',
  'continue',
  'submit',
  'learn more',
  'read more',
  'more info',
  'see more',
  '开始',
  '立即',
  '查看',
  '购买',
  '选购',
  '下单',
  '提交',
  '加入购物车',
  '免费试用',
  '了解更多',
  '更多',
  '详情',
] as const;
const SECONDARY_CTA_KEYWORDS = [
  'learn more',
  'read more',
  'more info',
  'see more',
  '了解更多',
  '更多',
  '详情',
] as const;

export function lintDesignArtifact(
  content: string,
  opts: { path?: string; activeAccent?: string } = {},
): DesignLintFinding[] {
  const findings: DesignLintFinding[] = [];
  const lower = content.toLowerCase();

  if (
    opts.activeAccent &&
    DEFAULT_TAILWIND_INDIGO.some((hex) => lower.includes(hex))
  ) {
    findings.push(finding('ai-slop.default-indigo', 'p0', opts.path));
  }
  if (
    /(from-(indigo|purple|blue)|#[0-9a-f]{6}).{0,60}(to-(blue|cyan|pink)|#[0-9a-f]{6})/i.test(
      content,
    )
  ) {
    findings.push(finding('ai-slop.trust-gradient', 'p0', opts.path));
  }
  if (
    /<(h[1-6]|button|li)[^>]*>[^<]*(?:[\u{1f300}-\u{1faff}])/u.test(content)
  ) {
    findings.push(finding('ai-slop.emoji-icons', 'p0', opts.path));
  }
  if (
    /border-l-(2|4|8)[^"']*rounded/i.test(content) ||
    /rounded[^"']*border-l-(2|4|8)/i.test(content)
  ) {
    findings.push(finding('ai-slop.left-border-card', 'p0', opts.path));
  }
  if (
    /(10x|10×|99\.9%|3x|3×)\s+(faster|uptime|productive|productivity)/i.test(
      content,
    )
  ) {
    findings.push(finding('ai-slop.invented-metrics', 'p0', opts.path));
  }
  if (
    /(lorem ipsum|feature one|feature two|feature three|placeholder text)/i.test(
      content,
    )
  ) {
    findings.push(finding('ai-slop.filler-copy', 'p0', opts.path));
  }
  if (/<img\b(?![^>]*\balt=)/i.test(content)) {
    findings.push({
      id: 'a11y.missing-alt',
      severity: 'p1',
      path: opts.path,
      message: 'Image elements need alt text.',
      suggestion:
        'Add a concise alt attribute or mark decorative images with alt="".',
    });
  }
  if (/<button[^>]*>\s*(click|submit|go|ok)\s*<\/button>/i.test(content)) {
    findings.push({
      id: 'a11y.short-button-label',
      severity: 'p1',
      path: opts.path,
      message: 'Button labels should explain the action.',
      suggestion: 'Use a specific two-word-or-longer label.',
    });
  }
  const missingStates = missingStateCoverage(content);
  if (missingStates.length > 0) {
    findings.push({
      id: 'state.missing-coverage',
      severity: 'p1',
      path: opts.path,
      message: `Stateful UI is missing ${missingStates.join(', ')} state coverage.`,
      suggestion:
        'Add loading, empty, and error states with clear copy and recovery actions.',
    });
  }
  if (
    INDEFINITE_SPINNER_RE.test(content) &&
    !SPINNER_TIMEOUT_RE.test(content)
  ) {
    findings.push({
      id: 'state.indefinite-spinner',
      severity: 'p1',
      path: opts.path,
      message: 'Loading motion appears to run indefinitely.',
      suggestion:
        'Add a timeout, longer-than-expected fallback, cancel option, or retry/error state.',
    });
  }
  if (TRANSFORM_MOTION_RE.test(content) && !REDUCED_MOTION_RE.test(content)) {
    findings.push({
      id: 'motion.missing-reduced-motion',
      severity: 'p1',
      path: opts.path,
      message:
        'Transform or animation motion needs a prefers-reduced-motion fallback.',
      suggestion:
        'Strip translate/scale/rotate/parallax under @media (prefers-reduced-motion: reduce), or replace it with opacity/color feedback.',
    });
  }
  const longTransitionMs = longestTransitionDurationMs(content);
  if (longTransitionMs > 500 && !PAGE_TRANSITION_RE.test(content)) {
    findings.push({
      id: 'motion.long-transition',
      severity: 'p1',
      path: opts.path,
      message: `Non-navigation transition duration exceeds 500 ms (${longTransitionMs} ms).`,
      suggestion:
        'Keep hover, press, toggle, validation, chip, and row transitions at or below 500 ms.',
    });
  }
  const ctaFindings = lintCtaHierarchy(content, opts.path);
  if (ctaFindings.length > 0) {
    logger.debug('lint_cta', {
      rule: 'cta-hierarchy',
      findings: ctaFindings.map((finding) => finding.id),
    });
    findings.push(...ctaFindings);
  }

  return findings;
}

export interface CtaHierarchyIssue {
  kind: 'multiple-primary' | 'ambiguous-weight' | 'misleading-prominence';
  selector: string;
  message: string;
}

export interface CtaHierarchyReport {
  issues: CtaHierarchyIssue[];
  primaryCount: number;
  secondaryCount: number;
}

interface CtaCandidate {
  text: string;
  classes: string[];
  inlineStyle: string;
  selector: string;
  weight: 'primary' | 'secondary';
}

export function analyseCtaHierarchy(html: string): CtaHierarchyReport {
  const containers = extractLandmarkContainers(stripHtmlComments(html));
  const issues: CtaHierarchyIssue[] = [];
  let primaryCount = 0;
  let secondaryCount = 0;

  for (const container of containers) {
    const candidates = collectCtaCandidates(container);
    primaryCount += candidates.filter(
      (candidate) => candidate.weight === 'primary',
    ).length;
    secondaryCount += candidates.filter(
      (candidate) => candidate.weight === 'secondary',
    ).length;
    issues.push(
      ...detectMultiplePrimary(candidates),
      ...detectAmbiguousWeight(candidates),
      ...detectMisleadingProminence(candidates),
    );
  }

  return { issues, primaryCount, secondaryCount };
}

function lintCtaHierarchy(
  content: string,
  path: string | undefined,
): DesignLintFinding[] {
  const report = analyseCtaHierarchy(content);
  return report.issues.map((issue) => ({
    id: `qa.cta-hierarchy.${issue.kind}`,
    severity: 'p1',
    path,
    message: issue.message,
    suggestion:
      'Make the primary action singular and visually dominant; keep secondary CTAs lower weight.',
  }));
}

function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function extractLandmarkContainers(html: string): string[] {
  for (const tag of LANDMARK_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    const containers = [...html.matchAll(re)].map((match) => match[0]);
    if (containers.length > 0) return containers;
  }
  return [html];
}

function collectCtaCandidates(html: string): CtaCandidate[] {
  const candidates: CtaCandidate[] = [];
  const seenIndexes = new Set<number>();

  function addMatches(re: RegExp) {
    for (const match of html.matchAll(re)) {
      const index = match.index ?? -1;
      if (seenIndexes.has(index)) continue;
      seenIndexes.add(index);
      addCandidate(match);
    }
  }

  function addCandidate(match: RegExpMatchArray) {
    const tag = (match[1] ?? '').toLowerCase();
    const attrs = match[2] ?? '';
    const text = normalizeText(stripTags(match[3] ?? ''));
    const classes = parseClasses(readAttribute(attrs, 'class'));
    const role = (readAttribute(attrs, 'role') ?? '').toLowerCase();
    const hasButtonClass = classes.some((className) =>
      CTA_CLASS_RE.test(className),
    );
    const isButtonTag = tag === 'button';
    const isRoleButton = role === 'button';
    const hasCtaCopy = matchesAnyKeyword(text, CTA_KEYWORDS);

    if (!hasButtonClass && !isRoleButton && !(isButtonTag && hasCtaCopy)) {
      return;
    }
    if (!hasCtaCopy) return;

    const inlineStyle = normalizeStyle(readAttribute(attrs, 'style'));
    candidates.push({
      text,
      classes,
      inlineStyle,
      selector: buildSelector(tag, classes, role),
      weight: classifyCtaWeight(classes, inlineStyle),
    });
  }

  addMatches(BUTTON_OR_ANCHOR_RE);
  addMatches(ROLE_BUTTON_RE);
  return candidates;
}

function detectMultiplePrimary(
  candidates: CtaCandidate[],
): CtaHierarchyIssue[] {
  const primary = candidates.filter(
    (candidate) => candidate.weight === 'primary',
  );
  return primary.slice(1).map((candidate) => ({
    kind: 'multiple-primary',
    selector: candidate.selector,
    message: `Multiple primary CTAs share the same section; "${truncate(candidate.text)}" competes with the main action.`,
  }));
}

function detectAmbiguousWeight(
  candidates: CtaCandidate[],
): CtaHierarchyIssue[] {
  if (candidates.length < 2) return [];
  const reference = ctaSignature(candidates[0]!);
  if (!candidates.every((candidate) => ctaSignature(candidate) === reference)) {
    return [];
  }
  return [
    {
      kind: 'ambiguous-weight',
      selector: candidates[1]?.selector ?? candidates[0]!.selector,
      message:
        'All CTAs in this section share identical class and inline style; the visual hierarchy is ambiguous.',
    },
  ];
}

function detectMisleadingProminence(
  candidates: CtaCandidate[],
): CtaHierarchyIssue[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.weight === 'primary' &&
        matchesAnyKeyword(candidate.text, SECONDARY_CTA_KEYWORDS),
    )
    .map((candidate) => ({
      kind: 'misleading-prominence',
      selector: candidate.selector,
      message: `"${truncate(candidate.text)}" reads as a secondary action but is styled with primary-weight visuals.`,
    }));
}

function classifyCtaWeight(
  classes: string[],
  inlineStyle: string,
): 'primary' | 'secondary' {
  if (classes.some((className) => PRIMARY_CLASS_RE.test(className))) {
    return 'primary';
  }
  return hasNonTransparentBackground(inlineStyle) ? 'primary' : 'secondary';
}

function hasNonTransparentBackground(inlineStyle: string): boolean {
  const background =
    extractStyleValue(inlineStyle, 'background-color') ??
    extractStyleValue(inlineStyle, 'background');
  const value = background?.toLowerCase().trim();
  if (!value) return false;
  if (
    value === 'transparent' ||
    value === 'none' ||
    value === 'inherit' ||
    value === 'initial'
  ) {
    return false;
  }
  return !/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)$/.test(
    value,
  );
}

function extractStyleValue(
  inlineStyle: string,
  property: string,
): string | null {
  for (const declaration of inlineStyle.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    if (name === property) return declaration.slice(colon + 1).trim();
  }
  return null;
}

function readAttribute(attrs: string, name: string): string | undefined {
  const match = attrs.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function parseClasses(raw: string | undefined): string[] {
  return raw?.split(/\s+/).filter(Boolean) ?? [];
}

function normalizeText(raw: string): string {
  return decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim();
}

function normalizeStyle(raw: string | undefined): string {
  return raw?.replace(/\s+/g, ' ').trim() ?? '';
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

function matchesAnyKeyword(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function buildSelector(tag: string, classes: string[], role: string): string {
  const classPart = classes.length > 0 ? `.${classes.join('.')}` : '';
  const rolePart = role && tag !== 'button' ? `[role="${role}"]` : '';
  return `${tag || 'element'}${classPart}${rolePart}`;
}

function ctaSignature(candidate: CtaCandidate): string {
  return `${[...candidate.classes].sort().join('.')}|${candidate.inlineStyle}`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function truncate(text: string, max = 40): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function missingStateCoverage(content: string): string[] {
  if (!STATEFUL_SURFACE_RE.test(content) && !STATEFUL_HTML_RE.test(content)) {
    return [];
  }
  const missing: string[] = [];
  if (!LOADING_STATE_RE.test(content)) missing.push('loading');
  if (!EMPTY_STATE_RE.test(content)) missing.push('empty');
  if (!ERROR_STATE_RE.test(content)) missing.push('error');
  return missing;
}

function longestTransitionDurationMs(content: string): number {
  let longest = 0;
  for (const match of content.matchAll(TRANSITION_DURATION_RE)) {
    const cssValue = match[1];
    if (cssValue) {
      for (const duration of extractCssDurationsMs(cssValue)) {
        longest = Math.max(longest, duration);
      }
      continue;
    }
    const bracketValue = match[2];
    const bracketUnit = match[3];
    if (bracketValue && bracketUnit) {
      longest = Math.max(longest, toMs(Number(bracketValue), bracketUnit));
      continue;
    }
    const tailwindDuration = match[4];
    if (tailwindDuration) longest = Math.max(longest, Number(tailwindDuration));
  }
  return longest;
}

function extractCssDurationsMs(value: string): number[] {
  return [...value.matchAll(/(\d*\.?\d+)\s*(ms|s)\b/gi)].map((match) =>
    toMs(Number(match[1]), match[2] ?? 'ms'),
  );
}

function toMs(value: number, unit: string): number {
  if (!Number.isFinite(value)) return 0;
  return unit.toLowerCase() === 's'
    ? Math.round(value * 1000)
    : Math.round(value);
}

function finding(
  id: string,
  severity: 'p0' | 'p1',
  path: string | undefined,
): DesignLintFinding {
  const messages: Record<string, string> = {
    'ai-slop.default-indigo':
      'Default Tailwind indigo/purple is used as an accent while a design system is active.',
    'ai-slop.trust-gradient':
      'Two-stop purple/blue trust gradients are a blocked DesignMode pattern.',
    'ai-slop.emoji-icons':
      'Emoji feature icons are not allowed in core UI text.',
    'ai-slop.left-border-card':
      'Rounded cards with colored left borders match a blocked AI-dashboard pattern.',
    'ai-slop.invented-metrics':
      'Specific performance metrics need a cited source in the brief.',
    'ai-slop.filler-copy': 'Filler or placeholder copy is not exportable.',
  };
  return {
    id,
    severity,
    path,
    message: messages[id] ?? id,
    suggestion:
      'Revise the artifact to follow the active DESIGN.md and craft references.',
  };
}
