import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { TTS_PCM_SAMPLE_RATE } from '@/shared/lib/audio-constants';
import { getAudioPlaybackEngine } from '@/shared/lib/audio-playback';

import type { Voice } from '../types';

/** Language-specific test sentences for TTS preview. */
const TTS_TEST_TEXTS: Record<string, string> = {
  // Full locale keys (local providers: Kokoro, Pocket-TTS, Kitten)
  'en-US': 'Hello! This is a test of the text-to-speech system.',
  'en-GB': 'Hello! This is a test of the text-to-speech system.',
  'fr-FR': 'Bonjour ! Ceci est un test du système de synthèse vocale.',
  'es-ES': '¡Hola! Esta es una prueba del sistema de síntesis de voz.',
  cmn: '你好！这是语音合成系统的测试。',
  // Short ISO keys (ElevenLabs, Deepgram, OpenAI)
  en: 'Hello! This is a test of the text-to-speech system.',
  fr: 'Bonjour ! Ceci est un test du système de synthèse vocale.',
  es: '¡Hola! Esta es una prueba del sistema de síntesis de voz.',
  zh: '你好！这是语音合成系统的测试。',
  // Multilingual voices default to English test text
  multi: 'Hello! This is a test of the text-to-speech system.',
};
const DEFAULT_TTS_TEST_TEXT =
  'Hello! This is a test of the text-to-speech system.';

export type TtsTestState = 'idle' | 'loading' | 'playing' | 'error';

interface UseTtsTestOptions {
  voice: string;
  speed: number;
  format?: string;
  provider?: string;
  filteredVoices: Voice[];
}

export function useTtsTest({
  voice,
  speed,
  format,
  provider,
  filteredVoices,
}: UseTtsTestOptions) {
  const [ttsTestText, setTtsTestText] = useState(DEFAULT_TTS_TEST_TEXT);
  const [ttsTestState, setTtsTestState] = useState<TtsTestState>('idle');
  const [ttsTestError, setTtsTestError] = useState('');

  // Update test text when selected voice language changes
  useEffect(() => {
    const selectedVoice = filteredVoices.find((v) => v.id === voice);
    const lang = selectedVoice?.language;
    setTtsTestText(
      lang
        ? (TTS_TEST_TEXTS[lang] ?? DEFAULT_TTS_TEST_TEXT)
        : DEFAULT_TTS_TEST_TEXT,
    );
  }, [voice, filteredVoices]);

  const testTTS = useCallback(async () => {
    if (!ttsTestText.trim()) return;
    setTtsTestState('loading');
    setTtsTestError('');
    try {
      const response = await fetch(`${API_BASE_URL}/speech/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: ttsTestText,
          voice,
          speed,
          format: format ?? 'pcm',
          ...(provider && provider !== 'auto' ? { provider } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response
          .json()
          .catch(() => ({ error: response.statusText }));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${response.status}`,
        );
      }
      const contentType = response.headers.get('Content-Type') ?? '';
      const data = await response.arrayBuffer();
      const engine = getAudioPlaybackEngine();
      setTtsTestState('playing');
      const onEnded = () => {
        setTtsTestState('idle');
        engine.off('ended', onEnded);
      };
      engine.on('ended', onEnded);
      if (contentType.includes('pcm') || (format ?? 'pcm') === 'pcm') {
        engine.queuePCM(data, TTS_PCM_SAMPLE_RATE);
      } else {
        await engine.queueEncoded(data);
      }
    } catch (err) {
      setTtsTestError(err instanceof Error ? err.message : String(err));
      setTtsTestState('error');
    }
  }, [ttsTestText, voice, speed, format, provider]);

  const stopTTSTest = useCallback(() => {
    getAudioPlaybackEngine().stop();
    setTtsTestState('idle');
  }, []);

  return {
    ttsTestText,
    setTtsTestText,
    ttsTestState,
    ttsTestError,
    testTTS,
    stopTTSTest,
  };
}
