import type { RefObject } from 'react';

import { Loader2, Mic, Play, Square, Trash2, Upload } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import { Switch } from '../../components/Switch';
import type { ClonedVoiceEntry } from './types';

const INPUT_CLASS =
  'border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1';

interface VoiceCloningPanelProps {
  voiceCloningEnabled: boolean;
  onVoiceCloningToggle: (v: boolean) => void;
  voiceCloningSupported: boolean;
  pocketReady: boolean;
  cloneName: string;
  setCloneName: (name: string) => void;
  cloneError: string;
  cloneUploading: boolean;
  clonedVoices: ClonedVoiceEntry[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  cloneRecording: boolean;
  cloneRecordDuration: number;
  onUpload: () => void;
  onDelete: (name: string) => void;
  onTest: (voiceId: string) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
}

export function VoiceCloningPanel({
  voiceCloningEnabled,
  onVoiceCloningToggle,
  voiceCloningSupported,
  pocketReady,
  cloneName,
  setCloneName,
  cloneError,
  cloneUploading,
  clonedVoices,
  fileInputRef,
  cloneRecording,
  cloneRecordDuration,
  onUpload,
  onDelete,
  onTest,
  onStartRecording,
  onStopRecording,
}: VoiceCloningPanelProps) {
  const { t } = useLanguage();
  const s = t.settings;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-foreground text-sm font-medium">
            {s.speechVoiceCloning ?? 'Voice Cloning'}
          </p>
          <p className="text-muted-foreground text-xs">
            {s.speechVoiceCloningDesc ??
              'Create a custom voice from a recording or audio file.'}
          </p>
        </div>
        <Switch checked={voiceCloningEnabled} onChange={onVoiceCloningToggle} />
      </div>

      {voiceCloningEnabled && (
        <div
          className={`space-y-3 transition-opacity ${!voiceCloningSupported ? 'pointer-events-none opacity-50' : ''}`}
        >
          {!voiceCloningSupported && (
            <p className="text-muted-foreground text-xs italic">
              {!pocketReady
                ? (s.speechVoiceClonePocketRequired ??
                  'Download Pocket-TTS model to enable voice cloning.')
                : 'Select Pocket-TTS (or Auto/Local) as TTS provider to use voice cloning.'}
            </p>
          )}

          <div className="space-y-2">
            <div>
              <label className="text-foreground/80 mb-1 block text-sm font-medium">
                {s.speechVoiceCloneName ?? 'Voice Name'}
              </label>
              <input
                type="text"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                placeholder="my-custom-voice"
                className={INPUT_CLASS}
                aria-label={s.speechVoiceCloneName ?? 'Voice Name'}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/wav,.wav"
                className="hidden"
                onChange={onUpload}
                aria-label={s.speechVoiceCloneUpload ?? 'Upload audio file'}
              />
              <button
                type="button"
                onClick={() =>
                  cloneName.trim() ? fileInputRef.current?.click() : undefined
                }
                disabled={
                  cloneUploading ||
                  cloneRecording ||
                  !cloneName.trim() ||
                  !voiceCloningSupported
                }
                className="bg-primary hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                aria-label={s.speechVoiceCloneUpload ?? 'Upload WAV'}
              >
                {cloneUploading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Upload size={14} />
                )}
                {cloneUploading
                  ? (s.speechVoiceCloningUploading ?? 'Uploading...')
                  : (s.speechVoiceCloneUpload ?? 'Upload WAV')}
              </button>

              <span className="text-muted-foreground text-xs">or</span>

              {cloneRecording ? (
                <button
                  type="button"
                  onClick={onStopRecording}
                  className="bg-destructive hover:bg-destructive/90 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white"
                  aria-label={s.speechVoiceCloneRecordStop ?? 'Stop recording'}
                >
                  <Square size={14} />
                  {s.speechVoiceCloneRecordStop ?? 'Stop'} (
                  {cloneRecordDuration}s)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onStartRecording}
                  disabled={
                    cloneUploading ||
                    !cloneName.trim() ||
                    !voiceCloningSupported
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50"
                  aria-label={s.speechVoiceCloneRecord ?? 'Record'}
                >
                  <Mic size={14} />
                  {s.speechVoiceCloneRecord ?? 'Record'}
                </button>
              )}
            </div>

            {voiceCloningSupported && (
              <p className="text-muted-foreground text-xs">
                {s.speechVoiceCloneRecordHint ??
                  'Speak clearly for 10–30 seconds in a quiet environment.'}
              </p>
            )}
          </div>

          {cloneError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {cloneError}
            </p>
          )}

          {clonedVoices.length > 0 ? (
            <div className="space-y-2">
              {clonedVoices.map((cv) => (
                <div
                  key={cv.voiceId}
                  className="bg-muted/30 flex items-center gap-3 rounded-md border px-3 py-2"
                >
                  <span className="text-foreground flex-1 text-sm">
                    {cv.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {new Date(cv.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => onTest(cv.voiceId)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                    aria-label={`${s.speechVoiceCloneTest ?? 'Test'} ${cv.name}`}
                  >
                    <Play size={12} />
                    {s.speechVoiceCloneTest ?? 'Test'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(cv.name)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                    aria-label={`${s.speechVoiceCloneDelete ?? 'Delete'} ${cv.name}`}
                  >
                    <Trash2 size={12} />
                    {s.speechVoiceCloneDelete ?? 'Delete'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {s.speechVoiceCloneEmpty ?? 'No cloned voices yet.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
