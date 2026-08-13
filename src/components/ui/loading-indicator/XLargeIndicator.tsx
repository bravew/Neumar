import { motion } from 'motion/react';

import { cn } from '@/shared/lib/utils';

import type { IndicatorProps } from './types';

/* ─── Constants ─── */

const RING_COUNT = 4;
const SPARKLE_COUNT = 10;
const WAVE_COUNT = 3;
const RING_INSET_STEP = 8; // px between concentric rings
const SPARKLE_BASE_RADIUS = 34; // px
const SPARKLE_RADIUS_STEP = 5; // px
const ORB_SIZE = 22; // px
const ORB_HIGHLIGHT_SIZE = 8; // px
const GLOW_DURATION = 4; // seconds
const ORB_BREATHE_DURATION = 4.5; // seconds
const HIGHLIGHT_PULSE_DURATION = 2.5; // seconds
const WAVE_DURATION = 4; // seconds

const RINGS = Array.from({ length: RING_COUNT }, (_, i) => ({
  inset: i * RING_INSET_STEP,
  duration: 3 + i * 1.4,
  direction: i % 2 === 0 ? 360 : -360,
  arcSpread: 110 + i * 25,
}));

const SPARKLES = Array.from({ length: SPARKLE_COUNT }, (_, i) => {
  const angle = (360 / SPARKLE_COUNT) * i;
  const radius = SPARKLE_BASE_RADIUS + (i % 4) * SPARKLE_RADIUS_STEP;
  const rad = (angle * Math.PI) / 180;
  return {
    x: Math.cos(rad) * radius,
    y: Math.sin(rad) * radius,
    duration: 2 + (i % 4) * 0.5,
    delay: i * 0.25,
    size: 2 + (i % 3),
  };
});

const WAVES = Array.from({ length: WAVE_COUNT }, (_, i) => ({
  delay: i * (WAVE_DURATION / WAVE_COUNT),
}));

/**
 * xl: Radiant Nexus — layered gradient rings, radial pulse waves, and dense particles.
 */
export function XLargeIndicator({ className, reducedMotion }: IndicatorProps) {
  if (reducedMotion) {
    return (
      <div className={cn('relative size-20', className)}>
        {/* Static outer ring */}
        <div
          className="absolute rounded-full"
          style={{
            inset: 0,
            background: `conic-gradient(
              from 0deg,
              transparent 0deg,
              var(--primary) 25deg,
              var(--ai-glow) 50deg,
              var(--secondary) 75deg,
              transparent 110deg,
              transparent 360deg
            )`,
            mask: 'radial-gradient(circle, transparent 68%, black 70%, black 74%, transparent 76%)',
            WebkitMask:
              'radial-gradient(circle, transparent 68%, black 70%, black 74%, transparent 76%)',
            opacity: 0.8,
          }}
        />
        {/* Static inner ring */}
        <div
          className="absolute rounded-full"
          style={{
            inset: RING_INSET_STEP * 2,
            background: `conic-gradient(
              from 180deg,
              transparent 0deg,
              var(--secondary) 30deg,
              var(--ai-glow) 60deg,
              transparent 100deg,
              transparent 360deg
            )`,
            mask: 'radial-gradient(circle, transparent 55%, black 57%, black 62%, transparent 64%)',
            WebkitMask:
              'radial-gradient(circle, transparent 55%, black 57%, black 62%, transparent 64%)',
            opacity: 0.6,
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
    <div className={cn('relative size-20', className)}>
      {/* Expanding pulse waves */}
      {WAVES.map((wave, i) => (
        <motion.div
          key={`wave-${i}`}
          className="absolute inset-0 rounded-full"
          style={{
            border: '1px solid var(--ai-glow)',
          }}
          animate={{
            scale: [0.5, 1.3],
            opacity: [0.5, 0],
          }}
          transition={{
            duration: WAVE_DURATION,
            repeat: Infinity,
            ease: 'easeOut',
            delay: wave.delay,
          }}
        />
      ))}

      {/* Deep ambient glow */}
      <motion.div
        className="absolute inset-[-12px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, var(--ai-glow) 0%, transparent 60%)',
        }}
        animate={{
          opacity: [0.12, 0.35, 0.12],
          scale: [0.92, 1.1, 0.92],
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
            mask: `radial-gradient(circle, transparent ${68 - i * 7}%, black ${70 - i * 7}%, black ${74 - i * 7}%, transparent ${76 - i * 7}%)`,
            WebkitMask: `radial-gradient(circle, transparent ${68 - i * 7}%, black ${70 - i * 7}%, black ${74 - i * 7}%, transparent ${76 - i * 7}%)`,
            opacity: 0.65 + i * 0.08,
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
          key={`spark-${i}`}
          className="absolute top-1/2 left-1/2 rounded-full"
          style={{
            width: spark.size,
            height: spark.size,
            marginLeft: -spark.size / 2 + spark.x,
            marginTop: -spark.size / 2 + spark.y,
            backgroundColor: 'var(--ai-glow)',
          }}
          animate={{
            opacity: [0, 0.85, 0],
            scale: [0.4, 1.3, 0.4],
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
          background:
            'radial-gradient(circle at 35% 35%, var(--ai-glow), var(--primary) 60%, var(--secondary))',
          boxShadow: '0 0 16px var(--ai-glow)',
        }}
        animate={{
          scale: [1, 1.3, 0.85, 1.2, 1],
          opacity: [0.8, 1, 0.7, 1, 0.8],
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
        animate={{ opacity: [0.25, 0.65, 0.25] }}
        transition={{
          duration: HIGHLIGHT_PULSE_DURATION,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
    </div>
  );
}
