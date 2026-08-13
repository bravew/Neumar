/**
 * Curated caption font catalog. Matches the OpenReel grouping so the UI feels
 * familiar without dragging in every Google Font. "System" entries render
 * everywhere without network; the rest are loaded on demand via
 * loadGoogleFontIfNeeded() the first time they are referenced.
 *
 * Editing notes:
 *  - Group order = display order in the picker dropdown.
 *  - Family names match the Google Fonts `family=` parameter exactly
 *    (spaces become `+` at load time). System fonts must be safe CSS
 *    fallbacks so they render with no network on first paint.
 *  - Adding a font here is sufficient for the live Remotion preview and the
 *    on-canvas CaptionBox. The backend full render uses the same loader; the
 *    FFmpeg ASS sidecar still falls back to fontconfig defaults — flagged on
 *    the type definition.
 */
export const SYSTEM_FONTS = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Verdana',
] as const;

export const FONT_CATEGORIES: ReadonlyArray<{
  category: string;
  fonts: ReadonlyArray<string>;
}> = [
  {
    category: 'Popular',
    fonts: [
      'Inter',
      'Poppins',
      'Montserrat',
      'Roboto',
      'Open Sans',
      'Lato',
      'DM Sans',
    ],
  },
  {
    category: 'Display',
    fonts: [
      'Bebas Neue',
      'Anton',
      'Oswald',
      'Archivo Black',
      'Righteous',
      'Bungee',
    ],
  },
  {
    category: 'Serif',
    fonts: [
      'Playfair Display',
      'Lora',
      'Merriweather',
      'DM Serif Display',
      'Abril Fatface',
    ],
  },
  {
    category: 'Handwritten',
    fonts: [
      'Pacifico',
      'Lobster',
      'Dancing Script',
      'Caveat',
      'Permanent Marker',
    ],
  },
  { category: 'Monospace', fonts: ['Roboto Mono', 'Space Mono'] },
  { category: 'System', fonts: [...SYSTEM_FONTS] },
];

export const DEFAULT_CAPTION_FONT_FAMILY = 'Inter';

const SYSTEM_FONT_SET = new Set<string>(SYSTEM_FONTS);
const LOADED_GOOGLE_FONTS = new Set<string>();

/**
 * Inject the Google Fonts stylesheet for `family` once. No-op for system
 * fonts and on the server (where `document` is undefined — Remotion render
 * loads fonts through its own pipeline).
 */
export function loadGoogleFontIfNeeded(family: string | undefined): void {
  if (!family) return;
  if (SYSTEM_FONT_SET.has(family)) return;
  if (typeof document === 'undefined') return;
  if (LOADED_GOOGLE_FONTS.has(family)) return;
  LOADED_GOOGLE_FONTS.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family,
  ).replace(/%20/g, '+')}:wght@400;700&display=swap`;
  document.head.appendChild(link);
}
