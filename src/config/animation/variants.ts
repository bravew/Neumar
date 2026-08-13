/**
 * Animation Variants
 *
 * Reusable variant objects for Motion for React.
 * Each variant defines `hidden` (initial) and `visible` (animate) states.
 * Use with: <motion.div variants={fadeIn} initial="hidden" animate="visible">
 *
 * These only animate `transform` and `opacity` for optimal performance.
 */

import type { Variants } from 'motion/react';

import { DURATION, EASE, OFFSET, SCALE, SPRING, STAGGER } from './constants';

// ---------------------------------------------------------------------------
// Fade variants
// ---------------------------------------------------------------------------

/** Simple fade in/out */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: DURATION.normal, ease: EASE.out },
  },
  exit: { opacity: 0, transition: { duration: DURATION.fast, ease: EASE.in } },
};

/** Fade with subtle scale — modals, dialogs, popovers */
export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: SCALE.enterFrom },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: DURATION.normal, ease: EASE.out },
  },
  exit: {
    opacity: 0,
    scale: SCALE.exitTo,
    transition: { duration: DURATION.fast, ease: EASE.in },
  },
};

// ---------------------------------------------------------------------------
// Slide variants
// ---------------------------------------------------------------------------

/** Slide up — messages, list items, cards entering */
export const slideUp: Variants = {
  hidden: { opacity: 0, y: OFFSET.small },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.normal, ease: EASE.out },
  },
  exit: {
    opacity: 0,
    y: -OFFSET.subtle,
    transition: { duration: DURATION.fast, ease: EASE.in },
  },
};

/** Slide down — dropdowns, notifications from top */
export const slideDown: Variants = {
  hidden: { opacity: 0, y: -OFFSET.small },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.normal, ease: EASE.out },
  },
  exit: {
    opacity: 0,
    y: -OFFSET.small,
    transition: { duration: DURATION.fast, ease: EASE.in },
  },
};

/** Slide from left — sidebars, panels */
export const slideLeft: Variants = {
  hidden: { opacity: 0, x: -OFFSET.medium },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: DURATION.moderate, ease: EASE.out },
  },
  exit: {
    opacity: 0,
    x: -OFFSET.medium,
    transition: { duration: DURATION.normal, ease: EASE.in },
  },
};

/** Slide from right — right sidebars, detail panels */
export const slideRight: Variants = {
  hidden: { opacity: 0, x: OFFSET.medium },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: DURATION.moderate, ease: EASE.out },
  },
  exit: {
    opacity: 0,
    x: OFFSET.medium,
    transition: { duration: DURATION.normal, ease: EASE.in },
  },
};

// ---------------------------------------------------------------------------
// Page-level variants
// ---------------------------------------------------------------------------

/** Page entrance — main content area on mount */
export const pageEnter: Variants = {
  hidden: { opacity: 0, y: OFFSET.medium },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: DURATION.slow,
      ease: EASE.out,
      staggerChildren: STAGGER.normal,
    },
  },
};

/** Hero entrance — large prominent elements (titles, hero images) */
export const heroEnter: Variants = {
  hidden: { opacity: 0, y: OFFSET.large, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: DURATION.slow, ease: EASE.out },
  },
};

// ---------------------------------------------------------------------------
// List / Container variants (parent orchestrators)
// ---------------------------------------------------------------------------

/** Container that staggers its children — normal speed */
export const staggerContainer: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: STAGGER.normal,
      delayChildren: 0.05,
    },
  },
};

/** Container that staggers its children — slow speed (card grids) */
export const staggerContainerSlow: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: STAGGER.slow,
      delayChildren: 0.05,
    },
  },
};

/** Container that staggers its children — fast speed (tool lists) */
export const staggerContainerFast: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: STAGGER.fast,
      delayChildren: 0.02,
    },
  },
};

/** Individual list item — slide up with fade */
export const listItem: Variants = {
  hidden: { opacity: 0, y: OFFSET.small },
  visible: {
    opacity: 1,
    y: 0,
    transition: { ...SPRING.default },
  },
  exit: {
    opacity: 0,
    y: -OFFSET.subtle,
    transition: { duration: DURATION.fast },
  },
};

// ---------------------------------------------------------------------------
// Interactive element variants
// ---------------------------------------------------------------------------

/** Card hover — subtle lift effect */
export const cardHover: Variants = {
  rest: { scale: 1, y: 0 },
  hover: {
    scale: SCALE.hover,
    y: -2,
    transition: { ...SPRING.snappy },
  },
  tap: { scale: SCALE.tap },
};

/** Button tap feedback */
export const buttonTap: Variants = {
  rest: { scale: 1 },
  tap: { scale: SCALE.tap, transition: { duration: DURATION.instant } },
};

// ---------------------------------------------------------------------------
// Agent state variants
// ---------------------------------------------------------------------------

/** Plan approval entrance — scale in with spring */
export const planEnter: Variants = {
  hidden: { opacity: 0, y: OFFSET.medium, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...SPRING.gentle },
  },
};

/** Plan step completion — checkmark animation */
export const planStepComplete: Variants = {
  incomplete: { scale: 1, backgroundColor: 'transparent' },
  complete: {
    scale: [1, 1.2, 1],
    transition: { duration: DURATION.normal, ease: EASE.bounce },
  },
};

/** Attention pulse — draws user attention to actionable elements */
export const attentionPulse: Variants = {
  idle: { scale: 1 },
  pulse: {
    scale: [1, 1.03, 1],
    transition: {
      duration: 2,
      repeat: Infinity,
      repeatType: 'loop' as const,
      ease: 'easeInOut',
    },
  },
};

/** Tool execution item entrance */
export const toolItemEnter: Variants = {
  hidden: { opacity: 0, x: -OFFSET.subtle, y: OFFSET.subtle },
  visible: {
    opacity: 1,
    x: 0,
    y: 0,
    transition: { duration: DURATION.normal, ease: EASE.out },
  },
};

// ---------------------------------------------------------------------------
// Overlay / Modal variants
// ---------------------------------------------------------------------------

/** Backdrop fade */
export const backdrop: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: DURATION.normal },
  },
  exit: {
    opacity: 0,
    transition: { duration: DURATION.fast },
  },
};

/** Modal entrance — scale + fade from center */
export const modalEnter: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: OFFSET.small },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { ...SPRING.snappy },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: OFFSET.small,
    transition: { duration: DURATION.fast, ease: EASE.in },
  },
};

// ---------------------------------------------------------------------------
// Notification / Status variants
// ---------------------------------------------------------------------------

/** Notification slide in from bottom-right */
export const notificationEnter: Variants = {
  hidden: { opacity: 0, y: OFFSET.medium, x: OFFSET.small },
  visible: {
    opacity: 1,
    y: 0,
    x: 0,
    transition: { ...SPRING.default },
  },
  exit: {
    opacity: 0,
    x: OFFSET.large,
    transition: { duration: DURATION.normal, ease: EASE.in },
  },
};

/** Status badge transition */
export const statusBadge: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { ...SPRING.bouncy },
  },
  exit: {
    opacity: 0,
    scale: 0.8,
    transition: { duration: DURATION.fast },
  },
};

// ---------------------------------------------------------------------------
// Scroll button variants
// ---------------------------------------------------------------------------

/** Scroll-to-bottom button appearance */
export const scrollButton: Variants = {
  hidden: { opacity: 0, y: 10, scale: 0.9 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...SPRING.snappy },
  },
  exit: {
    opacity: 0,
    y: 10,
    scale: 0.9,
    transition: { duration: DURATION.fast },
  },
};
