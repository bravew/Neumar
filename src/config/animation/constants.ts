/**
 * Animation Constants
 *
 * Centralized timing, easing, and spring configuration for the entire app.
 * Based on the "Smooth & Modern" design language (similar to Linear/Vercel).
 *
 * Performance principle: Only animate `transform` and `opacity` (compositor-only properties).
 * These run on the GPU and avoid triggering layout/paint recalculations.
 */

// ---------------------------------------------------------------------------
// Durations (in seconds) — short for micro-interactions, longer for page-level
// ---------------------------------------------------------------------------
export const DURATION = {
  /** Instant feedback — button press, toggle, icon swap */
  instant: 0.1,
  /** Fast — tooltips, hover states, small UI shifts */
  fast: 0.15,
  /** Normal — most transitions (default) */
  normal: 0.25,
  /** Moderate — panel open/close, accordions, card expand */
  moderate: 0.35,
  /** Slow — page entrance, hero animations, large layout shifts */
  slow: 0.5,
  /** Dramatic — onboarding, splash, first-time reveals */
  dramatic: 0.7,
} as const;

// ---------------------------------------------------------------------------
// Easing curves — cubic-bezier values matching modern design systems
// ---------------------------------------------------------------------------
export const EASE = {
  /** Default ease — smooth in-and-out for most transitions */
  default: [0.25, 0.1, 0.25, 1.0] as [number, number, number, number],
  /** Ease out — elements arriving (entering the screen) */
  out: [0.0, 0.0, 0.2, 1.0] as [number, number, number, number],
  /** Ease in — elements leaving (exiting the screen) */
  in: [0.4, 0.0, 1.0, 1.0] as [number, number, number, number],
  /** Ease in-out — symmetric transitions */
  inOut: [0.4, 0.0, 0.2, 1.0] as [number, number, number, number],
  /** Bounce — playful, attention-drawing */
  bounce: [0.34, 1.56, 0.64, 1.0] as [number, number, number, number],
  /** Sharp — snappy UI responses */
  sharp: [0.12, 0.0, 0.39, 0.0] as [number, number, number, number],
} as const;

// ---------------------------------------------------------------------------
// Spring presets — physics-based motion for natural feel
// ---------------------------------------------------------------------------
export const SPRING = {
  /** Gentle — sidebar, panel slides */
  gentle: { type: 'spring' as const, stiffness: 120, damping: 20, mass: 1 },
  /** Default — cards, list items */
  default: { type: 'spring' as const, stiffness: 200, damping: 24, mass: 0.8 },
  /** Snappy — buttons, small interactive elements */
  snappy: { type: 'spring' as const, stiffness: 300, damping: 28, mass: 0.6 },
  /** Bouncy — attention-drawing elements, approval buttons */
  bouncy: { type: 'spring' as const, stiffness: 400, damping: 15, mass: 0.8 },
} as const;

// ---------------------------------------------------------------------------
// Stagger delays — for cascading list/grid animations
// ---------------------------------------------------------------------------
export const STAGGER = {
  /** Fast cascade — dense lists, tool execution items */
  fast: 0.03,
  /** Normal cascade — message list, task items */
  normal: 0.05,
  /** Slow cascade — cards, hero elements */
  slow: 0.08,
  /** Dramatic cascade — onboarding steps */
  dramatic: 0.12,
} as const;

// ---------------------------------------------------------------------------
// Distance offsets — how far elements travel during enter/exit (in pixels)
// ---------------------------------------------------------------------------
export const OFFSET = {
  /** Subtle — barely noticeable shift */
  subtle: 8,
  /** Small — list items, tool rows */
  small: 12,
  /** Medium — cards, panels */
  medium: 20,
  /** Large — page content, modals */
  large: 30,
  /** XL — full page transitions */
  xl: 50,
} as const;

// ---------------------------------------------------------------------------
// Scale values — for zoom/pop effects
// ---------------------------------------------------------------------------
export const SCALE = {
  /** Tap feedback — buttons, clickable elements */
  tap: 0.97,
  /** Hover feedback — cards, interactive items */
  hover: 1.02,
  /** Enter from small — modals, dialogs */
  enterFrom: 0.95,
  /** Exit to small — dismissing elements */
  exitTo: 0.95,
} as const;
