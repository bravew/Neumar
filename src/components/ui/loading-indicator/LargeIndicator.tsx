import { motion } from 'motion/react';

import { cn } from '@/shared/lib/utils';

import type { IndicatorProps } from './types';

/* ─── Constants ─── */

const RING_COUNT = 3;
const SPARKLE_COUNT = 6;
const RING_INSET_STEP = 6; // px between concentric rings
const SPARKLE_BASE_RADIUS = 22; // px
const SPARKLE_RADIUS_STEP = 4; // px
const ORB_SIZE = 16; // px
const ORB_HIGHLIGHT_SIZE = 6; // px
const GLOW_DURATION = 3.5; // seconds
const ORB_BREATHE_DURATION = 4; // seconds
const HIGHLIGHT_PULSE_DURATION = 2; // seconds

const RINGS = Array.from({ length: RING_COUNT }, (_, i) => ({
  inset: i * RING_INSET_STEP,
  duration: 2.5 + i * 1.2,
  direction: i % 2 === 0 ? 360 : -360,
  arcSpread: 100 + i * 30,
}));

const SPARKLES = Array.from({ length: SPARKLE_COUNT }, (_, i) => {
  const angle = (360 / SPARKLE_COUNT) * i;
  const radius = SPARKLE_BASE_RADIUS + (i % 3) * SPARKLE_RADIUS_STEP;
  const rad = (angle * Math.PI) / 180;
  return {
    x: Math.cos(rad) * radius,
    y: Math.sin(rad) * radius,
    duration: 1.8 + (i % 3) * 0.6,
    delay: i * 0.3,
    size: 2 + (i % 2),
  };
});

/**
 * lg: AI Thinking Orb — concentric gradient rings with floating particles.
 */
export function LargeIndicator({ className, reducedMotion }: IndicatorProps) {
  if (reducedMotion) {
    return (
      <div className={cn('relative size-14', className)}>
        {/* Static ring */}
        <div
          className="absolute rounded-full"
          style={{
            inset: 0,
            background: `conic-gradient(
              from 0deg,
              transparent 0deg,
              var(--primary) 30deg,
              var(--ai-glow) 50deg,
              var(--secondary) 70deg,
              transparent 100deg,
              transparent 360deg
            )`,
            mask: 'radial-gradient(circle, transparent 65%, black 67%, black 72%, transparent 74%)',
            WebkitMask:
              'radial-gradient(circle, transparent 65%, black 67%, black 72%, transparent 74%)',
            opacity: 0.8,
          }}
        />
        {/* Static orb */}
        <div
          className="absolute top-1/2 left-1/2 rounded-full"
          style={{
            width: ORB_SIZE,
            height: ORB_SIZE,
            marginLeft: -ORB_SIZE / 2,
            marginTop: -ORB_SIZE / 2,
            background:
              'radial-gradient(circle at 35% 35%, var(--ai-glow), var(--primary) 60%, var(--secondary))',
          }}
        />
      </div>
    );
  }

  return (
    <div className={cn('relative size-14', className)}>
      {/* Deep ambient glow */}
      <motion.div
        className="absolute inset-[-8px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, var(--ai-glow) 0%, transparent 65%)',
        }}
        animate={{
          opacity: [0.15, 0.4, 0.15],
          scale: [0.9, 1.08, 0.9],
        }}
        transition={{
          duration: GLOW_DURATION,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Concentric rotating gradient rings */}
      {RINGS.map((ring, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            inset: ring.inset,
            background: `conic-gradient(
              from 0deg,
              transparent 0deg,
              var(--primary) ${ring.arcSpread * 0.3}deg,
              var(--ai-glow) ${ring.arcSpread * 0.5}deg,
              var(--secondary) ${ring.arcSpread * 0.7}deg,
              transparent ${ring.arcSpread}deg,
              transparent 360deg
            )`,
            mask: `radial-gradient(circle, transparent ${65 - i * 8}%, black ${67 - i * 8}%, black ${72 - i * 8}%, transparent ${74 - i * 8}%)`,
            WebkitMask: `radial-gradient(circle, transparent ${65 - i * 8}%, black ${67 - i * 8}%, black ${72 - i * 8}%, transparent ${74 - i * 8}%)`,
            opacity: 0.7 + i * 0.1,
          }}
          animate={{ rotate: ring.direction }}
          transition={{
            duration: ring.duration,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      ))}

      {/* Floating sparkle particles */}
      {SPARKLES.map((spark, i) => (
        <motion.div
          key={i}
          className="absolute top-1/2 left-1/2 rounded-full"
          style={{
            width: spark.size,
            height: spark.size,
            marginLeft: -spark.size / 2 + spark.x,
            marginTop: -spark.size / 2 + spark.y,
            backgroundColor: 'var(--ai-glow)',
          }}
          animate={{
            opacity: [0, 0.9, 0],
            scale: [0.5, 1.2, 0.5],
          }}
          transition={{
            duration: spark.duration,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: spark.delay,
          }}
        />
      ))}

      {/* Inner breathing orb */}
      <motion.div
        className="absolute top-1/2 left-1/2 rounded-full"
        style={{
          width: ORB_SIZE,
          height: ORB_SIZE,
          marginLeft: -ORB_SIZE / 2,
          marginTop: -ORB_SIZE / 2,
          background: `radial-gradient(circle at 35% 35%, var(--ai-glow), var(--primary) 60%, var(--secondary))`,
          boxShadow: '0 0 12px var(--ai-glow)',
        }}
        animate={{
          scale: [1, 1.25, 0.9, 1.15, 1],
          opacity: [0.85, 1, 0.75, 1, 0.85],
        }}
        transition={{
          duration: ORB_BREATHE_DURATION,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Inner orb highlight */}
      <motion.div
        className="absolute top-1/2 left-1/2 rounded-full"
        style={{
          width: ORB_HIGHLIGHT_SIZE,
          height: ORB_HIGHLIGHT_SIZE,
          marginLeft: -ORB_HIGHLIGHT_SIZE / 2,
          marginTop: -ORB_HIGHLIGHT_SIZE / 2,
          background: 'radial-gradient(circle, white 0%, transparent 70%)',
        }}
        animate={{ opacity: [0.3, 0.7, 0.3] }}
        transition={{
          duration: HIGHLIGHT_PULSE_DURATION,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
    </div>
  );
}
