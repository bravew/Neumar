import type { ReactNode } from 'react';

import { Camera, Layers3, Mic, Monitor } from 'lucide-react';

import type {
  NativeCaptureComposition,
  NativeCaptureDevices,
} from '@/shared/lib/video-capture';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  nativeCompositionUsesCamera,
  nativeCompositionUsesScreen,
} from './captureUtils';

interface CaptureDevicePanelProps {
  devices: NativeCaptureDevices | null;
  loading: boolean;
  browserSupported: boolean;
  hasNativeWorkspace: boolean;
  composition: NativeCaptureComposition;
  cameraDevice: string;
  screenDevice: string;
  micDevice: string;
  onCompositionChange: (value: NativeCaptureComposition) => void;
  onCameraDeviceChange: (value: string) => void;
  onScreenDeviceChange: (value: string) => void;
  onMicDeviceChange: (value: string) => void;
}

const FALLBACK_COMPOSITIONS: NativeCaptureComposition[] = [
  'screen+camera+mic',
  'screen+camera',
  'camera',
  'screen',
];

export function CaptureDevicePanel({
  devices,
  loading,
  browserSupported,
  hasNativeWorkspace,
  composition,
  cameraDevice,
  screenDevice,
  micDevice,
  onCompositionChange,
  onCameraDeviceChange,
  onScreenDeviceChange,
  onMicDeviceChange,
}: CaptureDevicePanelProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.capture.devicePanel;
  const compositions = devices?.supportedCompositions.length
    ? devices.supportedCompositions
    : FALLBACK_COMPOSITIONS;
  const nativeAvailable = Boolean(
    hasNativeWorkspace && devices?.nativeAvailable,
  );

  return (
    <section className="border-border space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-foreground text-sm font-semibold">
          {labels.title}
        </h3>
        <span className="text-muted-foreground text-xs">
          {loading
            ? labels.loading
            : nativeAvailable
              ? labels.native
              : browserSupported
                ? labels.browser
                : labels.unavailable}
        </span>
      </div>
      {nativeAvailable ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            icon={<Layers3 className="size-3.5" />}
            label={labels.composition}
            value={composition}
            onChange={(value) =>
              onCompositionChange(value as NativeCaptureComposition)
            }
            options={compositions.map((value) => ({
              value,
              label: compositionLabel(labels.compositions, value),
            }))}
          />
          {nativeCompositionUsesCamera(composition) ? (
            <SelectField
              icon={<Camera className="size-3.5" />}
              label={labels.camera}
              value={cameraDevice}
              onChange={onCameraDeviceChange}
              placeholder={labels.defaultDevice}
              options={deviceOptions(devices?.cameras)}
            />
          ) : null}
          {nativeCompositionUsesScreen(composition) ? (
            <SelectField
              icon={<Monitor className="size-3.5" />}
              label={labels.screen}
              value={screenDevice}
              onChange={onScreenDeviceChange}
              placeholder={labels.defaultDevice}
              options={deviceOptions(devices?.screens)}
            />
          ) : null}
          {devices?.mics.length ? (
            <SelectField
              icon={<Mic className="size-3.5" />}
              label={labels.mic}
              value={micDevice}
              onChange={onMicDeviceChange}
              options={[
                { value: '', label: labels.noMic },
                ...deviceOptions(devices.mics),
              ]}
            />
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          {loading
            ? labels.loading
            : hasNativeWorkspace
              ? (devices?.unavailableReason ?? labels.nativeUnavailable)
              : browserSupported
                ? labels.browserFallback
                : labels.unavailable}
        </p>
      )}
    </section>
  );
}

interface SelectFieldProps {
  icon: ReactNode;
  label: string;
  value: string;
  placeholder?: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

function SelectField({
  icon,
  label,
  value,
  placeholder,
  options,
  onChange,
}: SelectFieldProps) {
  return (
    <label className="text-muted-foreground space-y-1 text-xs">
      <span className="flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-border bg-background text-foreground h-8 w-full rounded-md border px-2 text-xs"
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function deviceOptions(
  devices: Array<{ id: string; label: string }> | undefined,
): Array<{ value: string; label: string }> {
  return (
    devices?.map((device) => ({
      value: device.id,
      label: device.label || device.id,
    })) ?? []
  );
}

function compositionLabel(
  labels: Record<NativeCaptureComposition, string>,
  composition: NativeCaptureComposition,
): string {
  return labels[composition];
}
