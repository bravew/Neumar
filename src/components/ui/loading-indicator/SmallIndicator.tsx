import { motion } from 'motion/react';

import { cn } from '@/shared/lib/utils';

import type { IndicatorProps } from './types';

/* ─── Constants ─── */

const DOT_COUNT = 4;
const SIGNAL_DURATION = 1.6; // seconds

/**
 * sm: Neural Pulse Chain — dots with a traveling energy signal.
 */
export function SmallIndicator({ className, reducedMotion }: IndicatorProps) {
  if (reducedMotion) {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        {Array.from({ length: DOT_COUNT }, (_, i) => (
          <span
            key={i}
            className="block size-1.5 rounded-full"
            style={{ backgroundColor: 'var(--primary)', opacity: 0.6 }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-0 overflow-visible', className)}>
      {Array.from({ length: DOT_COUNT }, (_, i) => (
        <div key={i} className="flex items-center">
          {/* Dot */}
          <motion.span
            className="relative block size-1.5 rounded-full"
            style={{ backgroundColor: 'var(--primary)' }}
            animate={{
              scale: [1, 1.6, 1],
              opacity: [0.35, 1, 0.35],
            }}
            transition={{
              duration: SIGNAL_DURATION,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * (SIGNAL_DURATION / DOT_COUNT),
            }}
          >
            {/* Glow halo */}
            <motion.span
              className="absolute inset-[-3px] rounded-full"
              style={{
                background:
                  'radial-gradient(circle, var(--ai-glow) 0%, transparent 70%)',
              }}
              animate={{ opacity: [0, 0.6, 0] }}
              transition={{
                duration: SIGNAL_DURATION,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: i * (SIGNAL_DURATION / DOT_COUNT),
              }}
            />
          </motion.span>

          {/* Connecting energy line (except after last dot) */}
          {i < DOT_COUNT - 1 && (
            <motion.span
              className="mx-[1px] block h-[1.5px] w-3 rounded-full"
              style={{ backgroundColor: 'var(--primary)' }}
              animate={{ opacity: [0.1, 0.7, 0.1], scaleX: [0.6, 1, 0.6] }}
              transition={{
                duration: SIGNAL_DURATION,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: (i + 0.5) * (SIGNAL_DURATION / DOT_COUNT),
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
