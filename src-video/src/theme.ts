import brandingRaw from '../../branding.json';

/**
 * Brand tokens derived from branding.json.
 * oklch colors are converted to hex equivalents for maximum compatibility
 * in Remotion's Chromium rendering context.
 */
export const brand = {
  name: brandingRaw.displayName,
  tagline: brandingRaw.tagline,
  description: brandingRaw.description,
  website: brandingRaw.urls.website,
  websiteDisplay: brandingRaw.urls.website.replace(/^https?:\/\//, ''),
  colors: {
    // oklch(0.45 0.18 30) ≈ #8B3A00 (warm brown-orange)
    primary: '#8B3A00',
    // oklch(0.65 0.16 30) ≈ #C25A1A (lighter orange)
    primaryDark: '#C25A1A',
    shadow: brandingRaw.theme.shadowColorLight,
    // Derived palette
    background: '#0a0a0a',
    surface: '#1a1a1a',
    surfaceBorder: '#2a2a2a',
    text: '#f5f5f5',
    textMuted: '#a0a0a0',
    accent: '#8B3A00',
  },
  logo: {
    path: 'brand/logo.png',
    iconPath: 'brand/app-icon.png',
  },
} as const;

// Timing presets (in frames at 30fps)
export const timing = {
  fps: 30,
  fadeIn: 15, // 0.5s
  fadeOut: 15,
  sceneGap: 6, // 0.2s
  textEntrance: 20, // 0.67s
  zoomDuration: 30, // 1s
  holdDuration: 60, // 2s
  shortHold: 30, // 1s
} as const;

// Typography
export const fonts = {
  heading: 'Inter',
  body: 'Inter',
  mono: 'JetBrains Mono',
} as const;
