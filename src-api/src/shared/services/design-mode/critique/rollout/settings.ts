import { z } from 'zod';

import { getSetting, saveSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

import {
  CRITIQUE_ROLLOUT_PHASES,
  type CritiqueRolloutPhase,
  type CritiqueRolloutSettings,
  type CritiqueUserOverride,
} from './types';

const logger = createLogger('CritiqueTheater');
const phaseSchema = z.enum(CRITIQUE_ROLLOUT_PHASES);
const overrideSchema = z.enum(['auto', 'on', 'off']);
const promotedAtSchema = z
  .object({
    M0: z.string().optional(),
    M1: z.string().optional(),
    M2: z.string().optional(),
    M3: z.string().optional(),
    GA: z.string().optional(),
  })
  .optional();
const critiqueSettingsSchema = z.object({
  rolloutPhase: phaseSchema.optional(),
  userOverride: overrideSchema.optional(),
  promotedAt: promotedAtSchema,
});

export function getCritiqueRolloutSettings(
  now = new Date(),
): Readonly<CritiqueRolloutSettings> {
  const parsed = readStoredCritiqueSettings(now);
  const envPhase = process.env.DESIGNMODE_CRITIQUE_ROLLOUT_PHASE;
  if (!envPhase) return parsed;
  const envResult = phaseSchema.safeParse(envPhase);
  if (!envResult.success) {
    logger.warn('critique.rollout.invalid_env_phase', { envPhase });
    return parsed;
  }
  return { ...parsed, rolloutPhase: envResult.data };
}

export function updateCritiqueRolloutSettings(
  patch: Partial<{
    rolloutPhase: CritiqueRolloutPhase;
    userOverride: CritiqueUserOverride;
    promotedAt: Partial<Record<CritiqueRolloutPhase, string>>;
  }>,
  now = new Date(),
) {
  const currentDesignMode = readDesignModeSetting();
  const current = getCritiqueRolloutSettings(now);
  const next: CritiqueRolloutSettings = {
    rolloutPhase: patch.rolloutPhase ?? current.rolloutPhase,
    userOverride: patch.userOverride ?? current.userOverride,
    promotedAt: {
      ...current.promotedAt,
      ...patch.promotedAt,
    },
  };
  saveSetting(
    'designMode',
    JSON.stringify({
      ...currentDesignMode,
      critique: next,
    }),
  );
  return next;
}

export function defaultCritiqueRolloutSettings(now = new Date()) {
  return {
    rolloutPhase: 'M0',
    userOverride: 'auto',
    promotedAt: { M0: now.toISOString() },
  } satisfies CritiqueRolloutSettings;
}

function readStoredCritiqueSettings(now: Date): CritiqueRolloutSettings {
  const fallback = defaultCritiqueRolloutSettings(now);
  const raw = readDesignModeSetting().critique;
  const parsed = critiqueSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    if (raw !== undefined) logger.warn('critique.rollout.invalid_settings');
    return fallback;
  }
  return {
    rolloutPhase: parsed.data.rolloutPhase ?? fallback.rolloutPhase,
    userOverride: parsed.data.userOverride ?? fallback.userOverride,
    promotedAt: {
      ...fallback.promotedAt,
      ...parsed.data.promotedAt,
    },
  };
}

function readDesignModeSetting() {
  const raw = getSetting('designMode');
  if (!raw) return {};
  try {
    return JSON.parse(raw) as { critique?: unknown };
  } catch {
    logger.warn('critique.rollout.invalid_design_mode_json');
    return {};
  }
}
