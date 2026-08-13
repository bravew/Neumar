import { Cloud, HardDrive, Plus } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoCaptionRenderMode,
  VideoLoudnessTargetSetting,
  VideoProject,
  VideoRenderProviderView,
} from '@/shared/types/video';

export interface RenderSettingsState {
  renderWhere: 'local' | 'cloud';
  renderProviderId: string;
  cloudEgressConfirmed: boolean;
  loudnessTargetLufs: VideoLoudnessTargetSetting;
  autoColor: boolean;
  autoReframe: boolean;
  captionMode: VideoCaptionRenderMode;
}

export interface RenderSettingsSetters {
  setRenderWhere: (value: 'local' | 'cloud') => void;
  setRenderProviderId: (value: string) => void;
  setCloudEgressConfirmed: (value: boolean) => void;
  setLoudnessTargetLufs: (value: VideoLoudnessTargetSetting) => void;
  setAutoColor: (value: boolean) => void;
  setAutoReframe: (value: boolean) => void;
  setCaptionMode: (value: VideoCaptionRenderMode) => void;
}

/**
 * Form body of the render-settings popover. Pure controlled component —
 * RenderControls owns the state (so the split-button trigger can fire a
 * render with the latest values without opening the popover) and passes it
 * down here.
 */
export function RenderSettingsForm({
  project,
  cloudProviders,
  state,
  setters,
  renderBlocked,
  onQueueRender,
}: {
  project: VideoProject;
  cloudProviders: VideoRenderProviderView[];
  state: RenderSettingsState;
  setters: RenderSettingsSetters;
  renderBlocked: boolean;
  onQueueRender?: () => void;
}) {
  const { t } = useLanguage();
  const {
    renderWhere,
    renderProviderId,
    cloudEgressConfirmed,
    loudnessTargetLufs,
    autoColor,
    autoReframe,
    captionMode,
  } = state;
  return (
    <>
      <fieldset className="space-y-2">
        <legend className="text-foreground mb-1 font-medium">
          {t.video.editor.preview.title}
        </legend>
        <label className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md p-1.5">
          <input
            type="radio"
            name="renderWhere"
            value="local"
            checked={renderWhere === 'local'}
            onChange={() => setters.setRenderWhere('local')}
          />
          <HardDrive className="text-muted-foreground size-3.5" />
          <span>{t.video.editor.preview.renderMode.local}</span>
        </label>
        <label className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md p-1.5">
          <input
            type="radio"
            name="renderWhere"
            value="cloud"
            checked={renderWhere === 'cloud'}
            onChange={() => setters.setRenderWhere('cloud')}
          />
          <Cloud className="text-muted-foreground size-3.5" />
          <span>{t.video.editor.preview.renderMode.cloud}</span>
        </label>
      </fieldset>
      {renderWhere === 'cloud' ? (
        <div className="border-border mt-3 space-y-2 border-t pt-3">
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-[11px]">
              {t.video.editor.preview.renderMode.cloud}
            </span>
            <select
              value={renderProviderId}
              onChange={(event) => {
                setters.setRenderProviderId(event.target.value);
                setters.setCloudEgressConfirmed(
                  project.settings?.cloudRenderConsents?.[event.target.value]
                    ?.confirmed === true,
                );
              }}
              className="border-border bg-background w-full rounded-md border px-2 py-1.5 text-xs"
            >
              {cloudProviders.length > 0 ? (
                cloudProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))
              ) : (
                <option value="fal">
                  {t.video.editor.preview.renderMode.cloudUnavailable}
                </option>
              )}
            </select>
          </label>
          <label className="hover:bg-accent flex items-start gap-2 rounded-md p-1.5">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={cloudEgressConfirmed}
              onChange={(event) =>
                setters.setCloudEgressConfirmed(event.target.checked)
              }
            />
            <span className="leading-snug">
              {t.video.render.cloud.consent.firstTime}
            </span>
          </label>
        </div>
      ) : null}
      <div className="border-border mt-3 space-y-2 border-t pt-3">
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-[11px]">
            {t.video.editor.inspector.caption.title}
          </span>
          <select
            value={captionMode}
            onChange={(event) =>
              setters.setCaptionMode(
                event.target.value as VideoCaptionRenderMode,
              )
            }
            className="border-border bg-background w-full rounded-md border px-2 py-1.5 text-xs"
          >
            <option value="off">
              {t.video.editor.render.captionsMode.off}
            </option>
            <option value="burn-in">
              {t.video.editor.render.captionsMode.burnIn}
            </option>
            <option value="sidecar">
              {t.video.editor.render.captionsMode.sidecar}
            </option>
          </select>
        </label>
      </div>
      <div className="border-border mt-3 space-y-2 border-t pt-3">
        <label className="hover:bg-accent mb-2 flex items-start gap-2 rounded-md p-1.5">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={autoColor}
            onChange={(event) => setters.setAutoColor(event.target.checked)}
          />
          <span className="leading-snug">
            {t.video.editor.preview.autoColor}
          </span>
        </label>
        <label className="hover:bg-accent mb-2 flex items-start gap-2 rounded-md p-1.5">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={autoReframe}
            onChange={(event) => setters.setAutoReframe(event.target.checked)}
          />
          <span className="leading-snug">
            {t.video.editor.preview.autoReframe}
          </span>
        </label>
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-[11px]">
            {t.video.editor.preview.loudness.title}
          </span>
          <select
            value={String(loudnessTargetLufs)}
            onChange={(event) => {
              const value = event.target.value;
              setters.setLoudnessTargetLufs(
                value === 'off'
                  ? 'off'
                  : (Number(value) as Exclude<
                      VideoLoudnessTargetSetting,
                      'off'
                    >),
              );
            }}
            className="border-border bg-background w-full rounded-md border px-2 py-1.5 text-xs"
          >
            <option value="off">{t.video.editor.preview.loudness.off}</option>
            <option value="-14">
              {t.video.editor.preview.loudness.youtube}
            </option>
            <option value="-16">
              {t.video.editor.preview.loudness.mobile}
            </option>
            <option value="-23">
              {t.video.editor.preview.loudness.broadcast}
            </option>
          </select>
        </label>
        {onQueueRender ? (
          <button
            type="button"
            className="border-border hover:bg-accent mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs"
            onClick={onQueueRender}
            disabled={renderBlocked}
          >
            <Plus className="size-3" />
            {t.video.editor.preview.queueRender}
          </button>
        ) : null}
      </div>
    </>
  );
}
