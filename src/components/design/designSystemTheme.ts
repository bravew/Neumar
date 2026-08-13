import type { DesignSystemRecord } from '@/shared/types/design-mode';

export interface DesignSystemTheme {
  accent: string;
  border: string;
  danger: string;
  isDark: boolean;
  layer: string;
  layerElevated: string;
  muted: string;
  onAccent: string;
  onPrimary: string;
  onSuccess: string;
  primary: string;
  secondary: string;
  success: string;
  surface: string;
  text: string;
  warning: string;
}

export function designSystemTheme(
  system: DesignSystemRecord,
): DesignSystemTheme {
  const colors = colorsFor(system);
  const role = colorRoles(system.body);
  const rawSurface =
    role.surface ??
    role.background ??
    role.canvas ??
    findSurfaceCandidate(colors) ??
    '#ffffff';
  const surface = normalizeSurface(rawSurface);
  const isDark = relativeLuminance(surface) < 0.35;
  const baseText =
    role.text ??
    role.foreground ??
    role.ink ??
    findTextCandidate(colors, surface) ??
    (isDark ? '#f4f4f5' : '#111827');
  const text = ensureContrast(baseText, surface, 7);
  const primarySeed =
    role.primary && contrastRatio(role.primary, surface) >= 3
      ? role.primary
      : (role.accent ??
        role.secondary ??
        role.primary ??
        colors[0] ??
        '#2563eb');
  const primary = ensureUiColor(primarySeed, surface, isDark);
  const accent = ensureUiColor(
    role.accent ?? role.secondary ?? colors[2] ?? primary,
    surface,
    isDark,
  );
  const success = ensureUiColor(role.success ?? '#16a34a', surface, isDark);

  return {
    accent,
    border: mix(surface, text, isDark ? 0.22 : 0.14),
    danger: ensureUiColor(
      role.danger ?? role.error ?? '#dc2626',
      surface,
      isDark,
    ),
    isDark,
    layer: isDark
      ? mix(surface, '#ffffff', 0.08)
      : mix(surface, '#000000', 0.035),
    layerElevated: isDark
      ? mix(surface, '#ffffff', 0.14)
      : mix(surface, '#000000', 0.015),
    muted: ensureContrast(
      mix(text, surface, isDark ? 0.28 : 0.36),
      surface,
      4.5,
    ),
    onAccent: readableOn(accent),
    onPrimary: readableOn(primary),
    onSuccess: readableOn(success),
    primary,
    secondary: ensureUiColor(
      role.secondary ?? colors[1] ?? primary,
      surface,
      isDark,
    ),
    success,
    surface,
    text,
    warning: ensureUiColor(
      role.warning ?? role.warn ?? '#d97706',
      surface,
      isDark,
    ),
  };
}

export function colorsFor(system: DesignSystemRecord) {
  const source =
    system.tokens.length > 0
      ? system.tokens
      : system.swatches.length > 0
        ? system.swatches
        : [];
  return [...new Set(source.filter(isColorToken))];
}

export function isColorToken(value: string) {
  return /^#[0-9a-fA-F]{3,8}$/.test(value);
}

export function readableOn(background: string) {
  const white = '#ffffff';
  const black = '#111827';
  return contrastRatio(white, background) >= contrastRatio(black, background)
    ? white
    : black;
}

function colorRoles(body: string) {
  const roles: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const color = line.match(/#[0-9a-fA-F]{6}\b/)?.[0];
    if (!color) continue;
    for (const role of [
      'primary',
      'secondary',
      'accent',
      'success',
      'warning',
      'warn',
      'danger',
      'error',
      'surface',
      'background',
      'canvas',
      'text',
      'foreground',
      'ink',
    ]) {
      if (new RegExp(`\\b${role}\\b`, 'i').test(line)) {
        roles[role] ??= color;
      }
    }
  }
  return roles;
}

function findSurfaceCandidate(colors: string[]) {
  return (
    colors.find(
      (color, index) => index > 0 && relativeLuminance(color) > 0.82,
    ) ??
    colors.find((color) => relativeLuminance(color) < 0.18) ??
    colors[0]
  );
}

function findTextCandidate(colors: string[], surface: string) {
  return colors
    .filter((color) => contrastRatio(color, surface) >= 7)
    .sort((a, b) => contrastRatio(b, surface) - contrastRatio(a, surface))[0];
}

function normalizeSurface(surface: string) {
  const luminance = relativeLuminance(surface);
  if (luminance < 0.025) return '#121212';
  if (luminance > 0.97) return '#ffffff';
  return surface;
}

function ensureUiColor(color: string, surface: string, isDark: boolean) {
  const target = isDark ? '#f8fafc' : '#111827';
  const adjusted = isDark ? mix(color, '#ffffff', 0.28) : color;
  return ensureContrast(adjusted, surface, 3, target);
}

function ensureContrast(
  foreground: string,
  background: string,
  minimum: number,
  target = relativeLuminance(background) < 0.5 ? '#ffffff' : '#111827',
) {
  if (contrastRatio(foreground, background) >= minimum) return foreground;
  let best = foreground;
  for (let step = 0.1; step <= 1; step += 0.1) {
    const candidate = mix(foreground, target, step);
    best = candidate;
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return contrastRatio(target, background) > contrastRatio(best, background)
    ? target
    : best;
}

function contrastRatio(a: string, b: string) {
  const light = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

function relativeLuminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(from: string, to: string, amount: number) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex(
    a.map((channel, index) =>
      Math.round(channel + (b[index] - channel) * amount),
    ),
  );
}

function hexToRgb(hex: string) {
  const normalized =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex.slice(0, 7);
  const value = Number.parseInt(normalized.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(rgb: number[]) {
  return `#${rgb
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}
