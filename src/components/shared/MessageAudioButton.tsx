import { useCallback, useEffect, useState } from 'react';

import { Volume2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useSettingsValue } from '@/shared/db/settings';
import { TTS_PCM_SAMPLE_RATE } from '@/shared/lib/audio-constants';
import {
  getAudioPlaybackEngine,
  pipePcmStreamToEngine,
} from '@/shared/lib/audio-playback';
import { cn } from '@/shared/lib/utils';

interface MessageAudioButtonProps {
  /** The message text to speak */
  text: string;
  /** Additional class name */
  className?: string;
}

/**
 * Small speaker icon button that reads an assistant message aloud via TTS.
 * Only renders when TTS is enabled in settings.
 */
export function MessageAudioButton({
  text,
  className,
}: MessageAudioButtonProps) {
  const settings = useSettingsValue();
  const [isPlaying, setIsPlaying] = useState(false);

  // Sync state when the engine finishes playing
  useEffect(() => {
    if (!isPlaying) return;

    const engine = getAudioPlaybackEngine();
    const handleEnded = () => setIsPlaying(false);

    engine.on('ended', handleEnded);
    return () => {
      engine.off('ended', handleEnded);
    };
  }, [isPlaying]);

  const handleClick = useCallback(async () => {
    const engine = getAudioPlaybackEngine();

    if (isPlaying) {
      engine.stop();
      setIsPlaying(false);
      return;
    }

    setIsPlaying(true);
    const signal = engine.createAbortSignal();
    const format = settings.speech.ttsFormat ?? 'pcm';
    const shouldStream = settings.speech.ttsStreaming && format === 'pcm';

    try {
      const response = shouldStream
        ? await fetch(
            `${API_BASE_URL}/speech/synthesize/stream?${new URLSearchParams({
              text,
              format,
              ...(settings.speech.ttsVoice
                ? { voice: settings.speech.ttsVoice }
                : {}),
              ...(settings.speech.ttsSpeed
                ? { speed: String(settings.speech.ttsSpeed) }
                : {}),
              ...(settings.speech.ttsProvider &&
              settings.speech.ttsProvider !== 'auto'
                ? { provider: settings.speech.ttsProvider }
                : {}),
            }).toString()}`,
            { signal },
          )
        : await fetch(`${API_BASE_URL}/speech/synthesize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text,
              voice: settings.speech.ttsVoice,
              speed: settings.speech.ttsSpeed,
              format,
              provider:
                settings.speech.ttsProvider !== 'auto'
                  ? settings.speech.ttsProvider
                  : undefined,
            }),
            signal,
          });

      if (!response.ok || !response.body) {
        setIsPlaying(false);
        return;
      }

      // The backend may return a different format than requested when the
      // chosen provider can't natively serve it (e.g. Local returns WAV
      // even when the client asked for PCM). Trust the response Content-Type.
      const contentType = response.headers.get('Content-Type') ?? '';
      const isRawPcm = contentType.includes('audio/pcm');

      if (shouldStream && isRawPcm) {
        await pipePcmStreamToEngine(response, TTS_PCM_SAMPLE_RATE, signal);
      } else if (isRawPcm) {
        engine.queuePCM(await response.arrayBuffer(), TTS_PCM_SAMPLE_RATE);
      } else {
        // Encoded formats (wav/mp3/opus) need full data for decodeAudioData.
        await engine.queueEncoded(await response.arrayBuffer());
      }
    } catch (err) {
      if (!signal.aborted) {
        console.error('MessageAudioButton: TTS playback failed', err);
        engine.stop();
      }
      setIsPlaying(false);
    }
  }, [
    isPlaying,
    text,
    settings.speech.ttsVoice,
    settings.speech.ttsSpeed,
    settings.speech.ttsFormat,
    settings.speech.ttsProvider,
    settings.speech.ttsStreaming,
  ]);

  if (!settings.speech.ttsEnabled) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={isPlaying ? 'Stop reading aloud' : 'Read aloud'}
      className={cn(
        'text-muted-foreground hover:text-foreground flex items-center justify-center rounded transition-colors',
        'size-6',
        isPlaying && 'text-foreground animate-pulse',
        className,
      )}
    >
      <Volume2 className="size-3.5" />
    </button>
  );
}
