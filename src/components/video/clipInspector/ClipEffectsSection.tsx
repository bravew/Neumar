import {
  CLIP_EFFECT_CATALOG,
  createClipEffect,
  getClipEffectCatalogEntry,
  type ClipEffect,
  type ClipEffectParameter,
  type ClipEffectStack,
} from '@neumar/video-ir';
import { Plus, Trash2 } from 'lucide-react';

import type { VideoVisualTimelineClip } from '@/shared/types/video';

import type { ClipInspectorLabels } from './types';

interface Props {
  clip: VideoVisualTimelineClip;
  labels: ClipInspectorLabels;
  updateEffects: (effects: ClipEffectStack | undefined) => void;
}

export function ClipEffectsSection({ clip, labels, updateEffects }: Props) {
  const stack = clip.effects;
  const effects = stack?.effects ?? [];

  const replaceEffects = (nextEffects: ClipEffect[]) => {
    const keyframes = stack?.keyframes?.filter((track) =>
      nextEffects.some((effect) => effect.id === track.effectId),
    );
    updateEffects(
      nextEffects.length > 0
        ? {
            schema: 'neuma.video.clip-effects.v1',
            effects: nextEffects,
            ...(keyframes && keyframes.length > 0 ? { keyframes } : {}),
          }
        : undefined,
    );
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {CLIP_EFFECT_CATALOG.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            className="border-border hover:bg-muted inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px]"
            onClick={() =>
              replaceEffects([...effects, createClipEffect(entry.kind)])
            }
          >
            <Plus className="size-3" />
            {labels.effectControls.kinds[entry.kind]}
          </button>
        ))}
      </div>

      {effects.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {labels.effectControls.empty}
        </p>
      ) : (
        <div className="space-y-3">
          {effects.map((effect) => {
            const catalog = getClipEffectCatalogEntry(effect.kind);
            return (
              <article
                key={effect.id}
                className="border-border space-y-2 rounded border p-2"
              >
                <header className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] font-medium">
                    <input
                      type="checkbox"
                      checked={!effect.disabled}
                      onChange={(event) =>
                        replaceEffects(
                          effects.map((candidate) =>
                            candidate.id === effect.id
                              ? {
                                  ...candidate,
                                  disabled: !event.currentTarget.checked,
                                }
                              : candidate,
                          ),
                        )
                      }
                    />
                    {labels.effectControls.kinds[effect.kind]}
                  </label>
                  <button
                    type="button"
                    aria-label={labels.effectControls.remove}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      replaceEffects(
                        effects.filter(
                          (candidate) => candidate.id !== effect.id,
                        ),
                      )
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </header>
                {catalog.parameters.map((parameter) => {
                  const value = effectParameterValue(effect, parameter.key);
                  return (
                    <label
                      key={parameter.key}
                      className="grid gap-1 text-[10px]"
                    >
                      <span className="flex justify-between gap-2">
                        <span>
                          {labels.effectControls.parameters[parameter.key]}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {value.toFixed(2)}
                        </span>
                      </span>
                      <input
                        type="range"
                        min={parameter.min}
                        max={parameter.max}
                        step={parameter.step}
                        value={value}
                        className="accent-primary w-full"
                        onChange={(event) =>
                          replaceEffects(
                            effects.map((candidate) =>
                              candidate.id === effect.id
                                ? updateEffectParameter(
                                    candidate,
                                    parameter.key,
                                    Number(event.currentTarget.value),
                                  )
                                : candidate,
                            ),
                          )
                        }
                      />
                    </label>
                  );
                })}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function effectParameterValue(
  effect: ClipEffect,
  parameter: ClipEffectParameter,
): number {
  switch (effect.kind) {
    case 'brightness':
    case 'contrast':
    case 'saturation':
      if (parameter === 'amount') return effect.params.amount;
      break;
    case 'white-balance':
      if (parameter === 'temperature') return effect.params.temperature;
      if (parameter === 'tint') return effect.params.tint;
      break;
    case 'blur':
      if (parameter === 'radius') return effect.params.radius;
      break;
  }
  throw new Error(`${parameter} is not valid for ${effect.kind}`);
}

function updateEffectParameter(
  effect: ClipEffect,
  parameter: ClipEffectParameter,
  value: number,
): ClipEffect {
  switch (effect.kind) {
    case 'brightness':
    case 'contrast':
    case 'saturation':
      if (parameter === 'amount') {
        return { ...effect, params: { amount: value } };
      }
      break;
    case 'white-balance':
      if (parameter === 'temperature') {
        return {
          ...effect,
          params: { ...effect.params, temperature: value },
        };
      }
      if (parameter === 'tint') {
        return { ...effect, params: { ...effect.params, tint: value } };
      }
      break;
    case 'blur':
      if (parameter === 'radius') {
        return { ...effect, params: { ...effect.params, radius: value } };
      }
      break;
  }
  throw new Error(`${parameter} is not valid for ${effect.kind}`);
}
