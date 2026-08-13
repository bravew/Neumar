/**
 * Animated Components
 *
 * Reusable wrapper components that encapsulate common animation patterns.
 * These provide a clean API for adding animations throughout the app
 * without repeating boilerplate motion props.
 */

import type { ReactNode } from 'react';

import { AnimatePresence, motion } from 'motion/react';

import { cn } from '@/shared/lib/utils';

import { DURATION, EASE, SPRING, STAGGER } from './constants';
import { useAnimationPreference } from './hooks';
import {
  fadeIn,
  fadeScale,
  listItem,
  pageEnter,
  slideUp,
  staggerContainer,
  staggerContainerFast,
} from './variants';

// ---------------------------------------------------------------------------
// AnimatedPage — wraps page-level content with entrance animation
// ---------------------------------------------------------------------------

interface AnimatedPageProps {
  children: ReactNode;
  className?: string;
}

/**
 * Wraps page content with a smooth entrance animation.
 * Use at the top level of each page component's main content area.
 *
 * Example:
 *   <AnimatedPage>
 *     <h1>Welcome</h1>
 *     <p>Content here</p>
 *   </AnimatedPage>
 */
export function AnimatedPage({ children, className }: AnimatedPageProps) {
  const prefersReduced = useAnimationPreference();

  return (
    <motion.div
      variants={pageEnter}
      initial="hidden"
      animate="visible"
      className={className}
      transition={
        prefersReduced
          ? { duration: DURATION.instant }
          : { duration: DURATION.slow, ease: EASE.out }
      }
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// AnimatedList — staggers children's entrance animations
// ---------------------------------------------------------------------------

interface AnimatedListProps {
  children: ReactNode;
  className?: string;
  /** Use 'fast' for dense lists (tools), 'normal' for standard lists */
  speed?: 'fast' | 'normal';
}

/**
 * Container that staggers its children's entrance animations.
 * Wrap a list of AnimatedListItem components.
 *
 * Example:
 *   <AnimatedList>
 *     {items.map(item => (
 *       <AnimatedListItem key={item.id}>{item.name}</AnimatedListItem>
 *     ))}
 *   </AnimatedList>
 */
export function AnimatedList({
  children,
  className,
  speed = 'normal',
}: AnimatedListProps) {
  const variants = speed === 'fast' ? staggerContainerFast : staggerContainer;

  return (
    <motion.div
      variants={variants}
      initial="hidden"
      animate="visible"
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// AnimatedListItem — individual item within an AnimatedList
// ---------------------------------------------------------------------------

interface AnimatedListItemProps {
  children: ReactNode;
  className?: string;
}

/**
 * Individual list item with entrance animation.
 * Must be a direct child of AnimatedList for stagger to work.
 */
export function AnimatedListItem({
  children,
  className,
}: AnimatedListItemProps) {
  return (
    <motion.div variants={listItem} className={className}>
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// FadeIn — simple fade entrance
// ---------------------------------------------------------------------------

interface FadeInProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

/**
 * Fades content in on mount. Optionally delays the animation.
 */
export function FadeIn({ children, className, delay = 0 }: FadeInProps) {
  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      className={className}
      transition={{
        duration: DURATION.normal,
        ease: EASE.out,
        delay,
      }}
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// SlideIn — slide + fade entrance
// ---------------------------------------------------------------------------

interface SlideInProps {
  children: ReactNode;
  className?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  delay?: number;
  /** Use spring physics instead of tween */
  spring?: boolean;
}

/**
 * Slides content in from a direction with fade.
 */
export function SlideIn({
  children,
  className,
  direction = 'up',
  delay = 0,
  spring = false,
}: SlideInProps) {
  const offset = 16;
  const initialPosition = {
    up: { y: offset },
    down: { y: -offset },
    left: { x: -offset },
    right: { x: offset },
  }[direction];

  return (
    <motion.div
      initial={{ opacity: 0, ...initialPosition }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      className={className}
      transition={
        spring
          ? { ...SPRING.default, delay }
          : { duration: DURATION.normal, ease: EASE.out, delay }
      }
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// AnimatedPresence — wrapper for conditional mount/unmount with transitions
// ---------------------------------------------------------------------------

interface AnimatedPresenceProps {
  children: ReactNode;
  /** Whether the child should be shown */
  show: boolean;
  className?: string;
  /** Animation style */
  variant?: 'fade' | 'scale' | 'slide-up';
}

/**
 * Conditionally renders children with enter/exit animations.
 *
 * Example:
 *   <AnimatedPresenceWrapper show={isVisible} variant="scale">
 *     <Dialog>...</Dialog>
 *   </AnimatedPresenceWrapper>
 */
export function AnimatedPresenceWrapper({
  children,
  show,
  className,
  variant = 'fade',
}: AnimatedPresenceProps) {
  const variants = {
    fade: fadeIn,
    scale: fadeScale,
    'slide-up': slideUp,
  }[variant];

  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// AnimatedCounter — smooth number transitions
// ---------------------------------------------------------------------------

interface AnimatedCounterProps {
  value: number;
  className?: string;
}

/**
 * Animates number changes with a spring transition.
 * Useful for displaying counts, stats, etc.
 */
export function AnimatedCounter({ value, className }: AnimatedCounterProps) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={className}
      transition={{ ...SPRING.snappy }}
    >
      {value}
    </motion.span>
  );
}

// ---------------------------------------------------------------------------
// PulsingDot — agent status indicator with breathing animation
// ---------------------------------------------------------------------------

interface PulsingDotProps {
  /** Color class name (e.g., 'bg-primary', 'bg-emerald-500') */
  color?: string;
  /** Size in Tailwind (e.g., 'size-2', 'size-3') */
  size?: string;
  /** Show the outer ping ring */
  showPing?: boolean;
  /** Accessible label for screen readers */
  ariaLabel?: string;
}

/**
 * Animated dot indicator for agent status.
 * Uses a combination of scale and opacity for a breathing effect.
 */
export function PulsingDot({
  color = 'bg-primary',
  size = 'size-2',
  showPing = false,
  ariaLabel = 'Loading',
}: PulsingDotProps) {
  return (
    <span className="relative inline-flex" aria-label={ariaLabel} role="status">
      {showPing && (
        <motion.span
          className={cn(
            'absolute inline-flex rounded-full opacity-75',
            color,
            size,
          )}
          animate={{
            scale: [1, 1.8, 1.8],
            opacity: [0.75, 0, 0],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: 'easeOut',
          }}
        />
      )}
      <motion.span
        className={cn('relative inline-flex rounded-full', color, size)}
        animate={{
          scale: [1, 1.15, 1],
          opacity: [1, 0.8, 1],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// SkeletonShimmer — loading skeleton with shimmer effect
// ---------------------------------------------------------------------------

interface SkeletonShimmerProps {
  className?: string;
  /** Number of skeleton lines to show */
  lines?: number;
}

/**
 * Animated loading skeleton with a shimmer sweep.
 */
export function SkeletonShimmer({
  className,
  lines = 3,
}: SkeletonShimmerProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <motion.div
          key={i}
          className="bg-muted h-4 rounded-md"
          style={{ width: `${85 - i * 15}%` }}
          animate={{
            opacity: [0.4, 0.7, 0.4],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.15,
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnimatedTaskGroup — collapsible group with smooth height animation
// ---------------------------------------------------------------------------

interface AnimatedCollapseProps {
  children: ReactNode;
  isOpen: boolean;
  className?: string;
}

/**
 * Smoothly collapses/expands content.
 * Uses AnimatePresence for clean mount/unmount with height animation.
 */
export function AnimatedCollapse({
  children,
  isOpen,
  className,
}: AnimatedCollapseProps) {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{
            opacity: 1,
            height: 'auto',
            transition: {
              height: { duration: DURATION.moderate, ease: EASE.out },
              opacity: { duration: DURATION.normal, delay: 0.05 },
            },
          }}
          exit={{
            opacity: 0,
            height: 0,
            transition: {
              height: { duration: DURATION.normal, ease: EASE.in },
              opacity: { duration: DURATION.fast },
            },
          }}
          className={cn('overflow-hidden', className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// StaggeredText — text that appears word-by-word or line-by-line
// ---------------------------------------------------------------------------

interface StaggeredTextProps {
  text: string;
  className?: string;
  /** Split by 'word' or 'line' */
  splitBy?: 'word' | 'line';
}

/**
 * Text that animates in word-by-word or line-by-line.
 * Great for hero titles and important headings.
 */
export function StaggeredText({
  text,
  className,
  splitBy = 'word',
}: StaggeredTextProps) {
  const parts = splitBy === 'word' ? text.split(' ') : text.split('\n');

  return (
    <motion.span
      key={text}
      className={className}
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: STAGGER.slow },
        },
      }}
      initial="hidden"
      animate="visible"
    >
      {parts.map((part, i) => (
        <motion.span
          key={`${part}-${i}`}
          className="inline-block"
          variants={{
            hidden: { opacity: 0, y: 8 },
            visible: {
              opacity: 1,
              y: 0,
              transition: { duration: DURATION.normal, ease: EASE.out },
            },
          }}
        >
          {part}
          {splitBy === 'word' && i < parts.length - 1 ? '\u00A0' : ''}
        </motion.span>
      ))}
    </motion.span>
  );
}
