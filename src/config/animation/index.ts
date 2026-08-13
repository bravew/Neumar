/**
 * Animation System — Public API
 *
 * Import everything from this module:
 *   import { AnimatedPage, slideUp, DURATION, useAnimationPreference } from '@/config/animation';
 */

// Re-export Motion for React primitives for convenience
export { AnimatePresence, motion } from 'motion/react';

// Constants
export { DURATION, EASE, OFFSET, SCALE, SPRING, STAGGER } from './constants';

// Variants
export {
  attentionPulse,
  backdrop,
  buttonTap,
  cardHover,
  fadeIn,
  fadeScale,
  heroEnter,
  listItem,
  modalEnter,
  notificationEnter,
  pageEnter,
  planEnter,
  planStepComplete,
  scrollButton,
  slideDown,
  slideLeft,
  slideRight,
  slideUp,
  staggerContainer,
  staggerContainerFast,
  staggerContainerSlow,
  statusBadge,
  toolItemEnter,
} from './variants';

// Hooks
export {
  useAccessibleAnimation,
  useAnimationPreference,
  useFirstInView,
  useMountAnimation,
  useStaggerIndex,
} from './hooks';

// Components
export {
  AnimatedCollapse,
  AnimatedCounter,
  AnimatedList,
  AnimatedListItem,
  AnimatedPage,
  AnimatedPresenceWrapper,
  FadeIn,
  PulsingDot,
  SkeletonShimmer,
  SlideIn,
  StaggeredText,
} from './components';
