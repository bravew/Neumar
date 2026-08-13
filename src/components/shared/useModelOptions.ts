/**
 * Mode-scoped model options for chat composers and pickers.
 *
 * Merges provider-backed models (settings) with detected local CLI runtime
 * models (`/agent-runtimes`) through one shared catalog so Task, Design, and
 * Video pickers cannot drift. See `runtime-model-catalog.ts` for the rules.
 */

import { useMemo } from 'react';

import { useSettingsValue } from '@/shared/db/settings';
import { useDetectedRuntimes } from '@/shared/hooks/useDetectedRuntimes';
import { useProviderModelsCacheVersion } from '@/shared/hooks/useProviderModelsCacheVersion';
import type { RuntimeMode } from '@/shared/lib/runtime-model-ids';
import { useLanguage } from '@/shared/providers/language-provider';

import type { ModelOption } from './ChatInput.types';
import { buildModeModelOptions } from './runtime-model-catalog';

export function useModelOptions(mode: RuntimeMode): ModelOption[] {
  const { t } = useLanguage();
  const currentSettings = useSettingsValue();
  const providerModelsCacheVersion = useProviderModelsCacheVersion();
  const runtimes = useDetectedRuntimes();
  const providerFingerprint = currentSettings.providers
    .map((p) => `${p.id}:${p.enabled}:${p.models.join(',')}`)
    .join('|');

  return useMemo(
    () =>
      buildModeModelOptions(
        t.settings as Record<string, unknown>,
        currentSettings.providers,
        runtimes,
        mode,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- providerFingerprint is a derived cache key
    [
      providerFingerprint,
      providerModelsCacheVersion,
      t.settings,
      runtimes,
      mode,
    ],
  );
}
