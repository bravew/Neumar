import { useState } from 'react';

import {
  installDesignSystemCatalogPack,
  uninstallDesignSystemCatalogPack,
} from '@/shared/hooks/useDesignMode';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

export function useDesignSystemCatalogActions({
  onCatalogChanged,
  onPreviewChange,
}: {
  onCatalogChanged: () => void;
  onPreviewChange: (system: DesignSystemRecord | null) => void;
}) {
  const [catalogActionId, setCatalogActionId] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState('');

  const updateDesignSystemInstall = async (system: DesignSystemRecord) => {
    setCatalogActionId(system.id);
    setCatalogError('');
    try {
      if (system.canUninstall) {
        await uninstallDesignSystemCatalogPack(system.id);
        onPreviewChange({ ...system, origin: 'bundled', canUninstall: false });
      } else {
        const { designSystem } = await installDesignSystemCatalogPack(
          system.id,
        );
        onPreviewChange(designSystem);
      }
      onCatalogChanged();
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : String(err));
    } finally {
      setCatalogActionId(null);
    }
  };

  return {
    catalogActionId,
    catalogError,
    clearCatalogError: () => setCatalogError(''),
    updateDesignSystemInstall,
  };
}
