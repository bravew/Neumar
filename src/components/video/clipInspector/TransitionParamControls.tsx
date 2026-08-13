import {
  compactResolvedTransitionParams,
  resolveTransitionParams,
  type TransitionParamValue,
} from '@neumar/video-ir';

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoTransitionParamDef,
  VideoTransitionParamValue,
} from '@/shared/types/video';

import {
  colorToHex,
  enumOptionLabel,
  formatParamNumber,
  hexToColor,
  isColorValue,
  isVec2Value,
  transitionParamLabel,
} from './transitionParamControlUtils';
import type { ClipInspectorLabels } from './types';

interface TransitionParamControlsProps {
  disabled: boolean;
  labels: ClipInspectorLabels;
  paramDefs: readonly VideoTransitionParamDef[];
  params?: Record<string, VideoTransitionParamValue>;
  onChange: (
    params: Record<string, VideoTransitionParamValue> | undefined,
  ) => void;
}

export function TransitionParamControls({
  disabled,
  labels,
  onChange,
  paramDefs,
  params,
}: TransitionParamControlsProps) {
  const { t } = useLanguage();
  if (paramDefs.length === 0) return null;

  const transitionLabels = t.video.storyboard.transitions as Record<
    string,
    string
  >;
  const values = resolveTransitionParams({ paramDefs }, params).values;

  const updateParam = (key: string, value: TransitionParamValue) => {
    const compact = compactResolvedTransitionParams(
      { paramDefs },
      { ...values, [key]: value },
    );
    onChange(compact);
  };

  return (
    <fieldset className="grid gap-3">
      <legend className="text-muted-foreground text-[11px] font-semibold tracking-normal uppercase">
        {labels.transitionParams}
      </legend>
      {paramDefs.map((definition) => (
        <ParamControl
          key={definition.key}
          definition={definition}
          disabled={disabled}
          labels={labels}
          transitionLabels={transitionLabels}
          value={values[definition.key]}
          onChange={(value) => updateParam(definition.key, value)}
        />
      ))}
    </fieldset>
  );
}

function ParamControl({
  definition,
  disabled,
  labels,
  onChange,
  transitionLabels,
  value,
}: {
  definition: VideoTransitionParamDef;
  disabled: boolean;
  labels: ClipInspectorLabels;
  transitionLabels: Record<string, string>;
  value: TransitionParamValue | undefined;
  onChange: (value: TransitionParamValue) => void;
}) {
  const label = transitionParamLabel(definition.labelKey, transitionLabels);
  switch (definition.type) {
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-[11px] font-medium">
          <input
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            className="accent-primary size-3.5"
            onChange={(event) => onChange(event.currentTarget.checked)}
          />
          <span>{label}</span>
        </label>
      );
    case 'color':
      return (
        <ColorControl
          definition={definition}
          disabled={disabled}
          label={label}
          labels={labels}
          value={isColorValue(value) ? value : definition.defaultValue}
          onChange={onChange}
        />
      );
    case 'enum':
      return (
        <label className="grid gap-1 text-[11px] font-medium">
          <span>{label}</span>
          <select
            className="border-input bg-background h-8 rounded-md border px-2 text-xs"
            value={typeof value === 'string' ? value : definition.defaultValue}
            disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.value)}
          >
            {definition.options.map((option) => (
              <option key={option} value={option}>
                {enumOptionLabel(definition, option, transitionLabels)}
              </option>
            ))}
          </select>
        </label>
      );
    case 'number':
      return (
        <NumberControl
          definition={definition}
          disabled={disabled}
          label={label}
          value={typeof value === 'number' ? value : definition.defaultValue}
          onChange={onChange}
        />
      );
    case 'vec2':
      return (
        <Vec2Control
          definition={definition}
          disabled={disabled}
          label={label}
          labels={labels}
          value={isVec2Value(value) ? value : definition.defaultValue}
          onChange={onChange}
        />
      );
  }
}

function NumberControl({
  definition,
  disabled,
  label,
  onChange,
  value,
}: {
  definition: Extract<VideoTransitionParamDef, { type: 'number' }>;
  disabled: boolean;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const step = definition.step ?? (definition.valueKind === 'int' ? 1 : 0.01);
  const update = (rawValue: string) => {
    const nextValue = Number(rawValue);
    if (Number.isFinite(nextValue)) onChange(nextValue);
  };

  return (
    <label className="grid gap-1 text-[11px] font-medium">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {formatParamNumber(value)}
        </span>
      </span>
      <input
        type="range"
        min={definition.min}
        max={definition.max}
        step={step}
        value={value}
        disabled={disabled}
        className="accent-primary w-full"
        aria-label={label}
        onChange={(event) => update(event.currentTarget.value)}
      />
      <input
        type="number"
        min={definition.min}
        max={definition.max}
        step={step}
        value={value}
        disabled={disabled}
        className="border-input bg-background h-8 rounded-md border px-2 text-xs"
        aria-label={label}
        onChange={(event) => update(event.currentTarget.value)}
      />
    </label>
  );
}

function Vec2Control({
  definition,
  disabled,
  label,
  labels,
  onChange,
  value,
}: {
  definition: Extract<VideoTransitionParamDef, { type: 'vec2' }>;
  disabled: boolean;
  label: string;
  labels: ClipInspectorLabels;
  value: readonly [number, number];
  onChange: (value: readonly [number, number]) => void;
}) {
  const min = definition.min ?? 0;
  const max = definition.max ?? 1;
  const update = (index: 0 | 1, rawValue: string) => {
    const nextValue = Number(rawValue);
    if (!Number.isFinite(nextValue)) return;
    onChange(index === 0 ? [nextValue, value[1]] : [value[0], nextValue]);
  };

  return (
    <div className="grid gap-1 text-[11px] font-medium">
      <span>{label}</span>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1">
          <span className="text-muted-foreground">
            {labels.transitionParamX}
          </span>
          <input
            type="number"
            min={min}
            max={max}
            step={0.01}
            value={value[0]}
            disabled={disabled}
            className="border-input bg-background h-8 rounded-md border px-2 text-xs"
            aria-label={`${label} ${labels.transitionParamX}`}
            onChange={(event) => update(0, event.currentTarget.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">
            {labels.transitionParamY}
          </span>
          <input
            type="number"
            min={min}
            max={max}
            step={0.01}
            value={value[1]}
            disabled={disabled}
            className="border-input bg-background h-8 rounded-md border px-2 text-xs"
            aria-label={`${label} ${labels.transitionParamY}`}
            onChange={(event) => update(1, event.currentTarget.value)}
          />
        </label>
      </div>
    </div>
  );
}

function ColorControl({
  disabled,
  label,
  labels,
  onChange,
  value,
}: {
  definition: Extract<VideoTransitionParamDef, { type: 'color' }>;
  disabled: boolean;
  label: string;
  labels: ClipInspectorLabels;
  value: readonly [number, number, number, number];
  onChange: (value: readonly [number, number, number, number]) => void;
}) {
  return (
    <div className="grid gap-1 text-[11px] font-medium">
      <span>{label}</span>
      <div className="grid grid-cols-[auto_1fr] items-center gap-2">
        <input
          type="color"
          value={colorToHex(value)}
          disabled={disabled}
          className="h-8 w-10 rounded border-0 bg-transparent p-0"
          aria-label={label}
          onChange={(event) =>
            onChange(hexToColor(event.currentTarget.value, value[3]))
          }
        />
        <label className="grid gap-1">
          <span className="text-muted-foreground">
            {labels.transitionParamAlpha}
          </span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={value[3]}
            disabled={disabled}
            className="border-input bg-background h-8 rounded-md border px-2 text-xs"
            aria-label={`${label} ${labels.transitionParamAlpha}`}
            onChange={(event) => {
              const alpha = Number(event.currentTarget.value);
              if (Number.isFinite(alpha)) {
                onChange([value[0], value[1], value[2], alpha]);
              }
            }}
          />
        </label>
      </div>
    </div>
  );
}
