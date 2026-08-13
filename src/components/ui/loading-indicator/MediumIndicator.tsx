import { motion } from 'motion/react';

import { cn } from '@/shared/lib/utils';

import type { IndicatorProps } from './types';

/* ─── Constants ─── */

const PARTICLE_COUNT = 3;
const ORBIT_DURATION = 3; // seconds
const ORBIT_RADIUS = 14; // px
const CORE_SIZE = 8; // px
const GLOW_DURATION = 2.5; // seconds
const RING_DURATION = 2.2; // seconds
const CORE_BREATHE_DURATION = 3; // seconds

const PARTICLES = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
  radius: ORBIT_RADIUS,
  startAngle: (360 / PARTICLE_COUNT) * i,
  duration: ORBIT_DURATION + i * 0.4,
  size: 4 - i * 0.5,
  opacity: 1 - i * 0.15,
}));

/**
 * md: Orbital Core — morphing center with orbiting particles.
 */
export function MediumIndicator({ className, reducedMotion }: IndicatorProps) {
  if (reducedMotion) {
    return (
      <div className={cn('relative size-9', className)}>
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(
              from 0deg,
              transparent 0deg,
              var(--primary) 60deg,
              var(--ai-glow) 120deg,
              transparent 180deg,
              var(--secondary) 260deg,
              transparent 360deg
            )`,
            mask: 'radial-gradient(circle, transparent 55%, black 57%, black 100%)',
            WebkitMask:
              'radial-gradient(circle, transparent 55%, black 57%, black 100%)',
          }}
        />
        <div
          className="absolute top-1/2 left-1/2 rounded-full"
          style={{
            width: CORE_SIZE,
            height: CORE_SIZE,
            marginLeft: -CORE_SIZE / 2,
            marginTop: -CORE_SIZE / 2,
            background:
              'radial-gradient(circle at 40% 40%, var(--ai-glow), var(--primary))',
          }}
        />
      </div>
    );
  }

  return (
    <div className={cn('relative size-9', className)}>
      {/* Ambient glow ring */}
      <motion.div
        className="absolute inset-[-2px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, var(--ai-glow) 0%, transparent 70%)',
        }}
        animate={{ opacity: [0.15, 0.35, 0.15], scale: [0.95, 1.05, 0.95] }}
        transition={{
          duration: GLOW_DURATION,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Rotating gradient ring */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(
            from 0deg,
            transparent 0deg,
            var(--primary) 60deg,
            var(--ai-glow) 120deg,
            transparent 180deg,
            var(--secondary) 260deg,
            transparent 360deg
          )`,
          mask: 'radial-gradient(circle, transparent 55%, black 57%, black 100%)',
          WebkitMask:
            'radial-gradient(circle, transparent 55%, black 57%, black 100%)',
        }}
        animate={{ rotate: 360 }}
        transition={{
          duration: RING_DURATION,
          repeat: Infinity,
          ease: 'linear',
        }}
      />

      {/* Orbiting particles */}
      {PARTICLES.map((p, i) => (
        <motion.div
          key={i}
          className="absolute top-1/2 left-1/2"
          style={{
            width: p.size,
            height: p.size,
            marginLeft: -p.size / 2,
            marginTop: -p.size / 2,
          }}
          animate={{ rotate: 360 }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            ease: 'linear',
            delay: (p.startAngle / 360) * p.duration,
          }}
        >
          <motion.div
            className="rounded-full"
            style={{
              width: p.size,
              height: p.size,
              backgroundColor: 'var(--ai-glow)',
              transform: `translateY(-${p.radius}px)`,
              boxShadow: '0 0 4px var(--ai-glow)',
            }}
            animate={{ opacity: [p.opacity * 0.5, p.opacity, p.opacity * 0.5] }}
            transition={{
              duration: p.duration / 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        </motion.div>
      ))}

      {/* Core morphing dot */}
      <motion.div
        className="absolute top-1/2 left-1/2 rounded-full"
        style={{
          width: CORE_SIZE,
          height: CORE_SIZE,
          marginLeft: -CORE_SIZE / 2,
          marginTop: -CORE_SIZE / 2,
          background:
            'radial-gradient(circle at 40% 40%, var(--ai-glow), var(--primary))',
        }}
        animate={{
          scale: [1, 1.3, 0.9, 1.1, 1],
          opacity: [0.8, 1, 0.7, 1, 0.8],
        }}
        transition={{
          duration: CORE_BREATHE_DURATION,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
    </div>
  );
}
