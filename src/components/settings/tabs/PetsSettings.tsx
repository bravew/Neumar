import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Download,
  FolderOpen,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';

import { useReducedMotion } from '@/components/pets/useReducedMotion';
import {
  DEFAULT_PET_SETTINGS,
  type PetSettingsConfig,
} from '@/shared/db/settings';
import {
  fetchCommunityPets,
  fetchCustomPets,
  installCommunityPet,
  type CommunityPetSummary,
  type CustomPetSummary,
} from '@/shared/pets/api';
import { BUILTIN_PETS, customPetToCatalogItem } from '@/shared/pets/catalog';
import { getPetDescription } from '@/shared/pets/i18n';
import { normalizePetSettings } from '@/shared/pets/settings';
import { useLanguage } from '@/shared/providers/language-provider';

import type { SettingsTabProps } from '../types';
import {
  PetChoiceButton,
  PetSection,
  ToggleRow,
} from './pets/PetSettingsControls';
import {
  communityPetToCatalogItem,
  customSelectionFromSummary,
  openFolderInSystem,
  useMountedRef,
} from './pets/PetSettingsHelpers';

export function PetsSettings({ settings, onSettingsChange }: SettingsTabProps) {
  const { t } = useLanguage();
  const reducedMotion = useReducedMotion();
  const config = normalizePetSettings(settings.pets);
  const [customPets, setCustomPets] = useState<CustomPetSummary[]>([]);
  const [communityPets, setCommunityPets] = useState<CommunityPetSummary[]>([]);
  const [rootDir, setRootDir] = useState('');
  const [loadingCustom, setLoadingCustom] = useState(true);
  const [loadingCommunity, setLoadingCommunity] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const installedPets = useMemo(
    () => new Map(customPets.map((pet) => [pet.id, pet])),
    [customPets],
  );

  const mountedRef = useMountedRef();

  const update = (patch: Partial<PetSettingsConfig>) => {
    onSettingsChange({
      ...settings,
      pets: normalizePetSettings({
        ...config,
        ...patch,
        position: patch.position ?? config.position,
        windowPosition: patch.windowPosition ?? config.windowPosition,
      }),
    });
  };

  const loadCustomPets = useCallback(async (signal?: AbortSignal) => {
    const result = await fetchCustomPets(signal);
    if (signal?.aborted || !mountedRef.current) return;
    setCustomPets(result.pets);
    setRootDir(result.rootDir);
  }, []);

  const refreshPets = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      setLoadingCustom(true);
      try {
        await loadCustomPets(signal);
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!signal?.aborted) setLoadingCustom(false);
      }
    },
    [loadCustomPets],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refreshPets(controller.signal);
    return () => controller.abort();
  }, [refreshPets]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingCommunity(true);
    fetchCommunityPets(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setCommunityPets(result.pets);
      })
      .catch((err) => {
        if ((err as { name?: string }).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingCommunity(false);
      });

    return () => controller.abort();
  }, []);

  const adoptCustomPet = (pet: CustomPetSummary) => {
    const customPet = customSelectionFromSummary(
      pet,
      t.settings.petCustomGreeting,
    );
    update({
      activePetId: customPet.id,
      activePetSource: 'custom',
      customPet,
      enabled: true,
    });
  };

  const handleInstallCommunityPet = async (pet: CommunityPetSummary) => {
    if (installingId) return;

    const installed = installedPets.get(pet.id);
    if (installed) {
      adoptCustomPet(installed);
      return;
    }

    setInstallingId(pet.id);
    setError(null);
    try {
      const result = await installCommunityPet(pet.id);
      if (!mountedRef.current) return;
      await loadCustomPets();
      if (mountedRef.current) adoptCustomPet(result.pet);
    } catch (err) {
      if (mountedRef.current)
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setInstallingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div>
          <h2 className="text-foreground text-lg font-semibold">
            {t.settings.petsHeading}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t.settings.petsDescription}
          </p>
        </div>

        <ToggleRow
          label={t.settings.petsEnabled}
          description={t.settings.petsEnabledDescription}
          checked={config.enabled}
          onChange={(enabled) => update({ enabled })}
        />

        <ToggleRow
          label={t.settings.petsAgentActivity}
          description={t.settings.petsAgentActivityDescription}
          checked={config.showAgentActivity}
          onChange={(showAgentActivity) => update({ showAgentActivity })}
        />
      </section>

      {error && (
        <p className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
          {t.settings.petsLoadFailed}: {error}
        </p>
      )}

      <PetSection
        title={t.settings.petsCatalog}
        description={t.settings.petsCatalogDescription}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {BUILTIN_PETS.map((pet) => (
            <PetChoiceButton
              key={pet.id}
              pet={pet}
              description={getPetDescription(pet, t)}
              selected={
                config.activePetSource === 'builtin' &&
                pet.id === config.activePetId
              }
              reducedMotion={reducedMotion}
              selectedLabel={t.settings.petsSelected}
              actionLabel={t.settings.petsSelect}
              onClick={() =>
                update({
                  activePetId: pet.id,
                  activePetSource: 'builtin',
                  customPet: null,
                  enabled: true,
                })
              }
            />
          ))}
        </div>
      </PetSection>

      <PetSection
        title={t.settings.petsCustom}
        description={t.settings.petsCustomDescription}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshPets()}
            className="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
          >
            {loadingCustom ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t.settings.petsRefresh}
          </button>
          {rootDir && (
            <button
              type="button"
              onClick={() => void openFolderInSystem(rootDir)}
              className="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              <FolderOpen className="size-4" />
              {t.settings.petsOpenFolder}
            </button>
          )}
        </div>

        {customPets.length === 0 && !loadingCustom ? (
          <p className="text-muted-foreground rounded-md border p-3 text-xs">
            {t.settings.petsCustomEmpty}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {customPets.map((pet) => {
              const customPet = customSelectionFromSummary(
                pet,
                t.settings.petCustomGreeting,
              );
              return (
                <PetChoiceButton
                  key={pet.id}
                  pet={customPetToCatalogItem(customPet)}
                  description={pet.description}
                  selected={
                    config.activePetSource === 'custom' &&
                    pet.id === config.activePetId
                  }
                  reducedMotion={reducedMotion}
                  selectedLabel={t.settings.petsSelected}
                  actionLabel={t.settings.petsSelect}
                  onClick={() => adoptCustomPet(pet)}
                />
              );
            })}
          </div>
        )}
      </PetSection>

      <PetSection
        title={t.settings.petsCommunity}
        description={t.settings.petsCommunityDescription}
      >
        {communityPets.length === 0 && !loadingCommunity ? (
          <p className="text-muted-foreground rounded-md border p-3 text-xs">
            {t.settings.petsCommunityEmpty}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {communityPets.map((pet) => {
              const installed = installedPets.has(pet.id);
              const installing = installingId === pet.id;
              const installDisabled = Boolean(installingId);
              return (
                <PetChoiceButton
                  key={pet.id}
                  pet={communityPetToCatalogItem(pet)}
                  description={pet.description}
                  selected={
                    config.activePetSource === 'custom' &&
                    pet.id === config.activePetId
                  }
                  reducedMotion={reducedMotion}
                  selectedLabel={t.settings.petsSelected}
                  actionLabel={
                    installed ? t.settings.petsSelect : t.settings.petsDownload
                  }
                  actionIcon={
                    installing ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : installed ? undefined : (
                      <Download className="size-3" />
                    )
                  }
                  disabled={installDisabled}
                  onClick={() => void handleInstallCommunityPet(pet)}
                />
              );
            })}
          </div>
        )}
      </PetSection>

      <section className="space-y-3">
        <div>
          <h3 className="text-foreground text-sm font-semibold">
            {t.settings.petsPosition}
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {t.settings.petsPositionDescription}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            update({
              position: { ...DEFAULT_PET_SETTINGS.position },
              windowPosition: { ...DEFAULT_PET_SETTINGS.windowPosition },
            })
          }
          className="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
        >
          <RotateCcw className="size-4" />
          {t.settings.petsResetPosition}
        </button>
      </section>
    </div>
  );
}
