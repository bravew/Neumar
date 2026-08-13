import { describe, expect, it } from 'vitest';

import { DeepgramSpeechAdapter } from '@/shared/services/speech/adapters/deepgram';
import { ElevenLabsSpeechAdapter } from '@/shared/services/speech/adapters/elevenlabs';
import { ElevenLabsSfxAdapter } from '@/shared/services/speech/adapters/elevenlabs-sfx';
import { LocalSpeechAdapter } from '@/shared/services/speech/adapters/local';
import { MiniMaxSpeechAdapter } from '@/shared/services/speech/adapters/minimax';
import { OpenAISpeechAdapter } from '@/shared/services/speech/adapters/openai';
import { SenseAudioSpeechAdapter } from '@/shared/services/speech/adapters/senseaudio';
import type { SpeechProviderConfig } from '@/shared/services/speech/types';
import { VIDEO_PROVIDER_CAPABILITIES } from '@/shared/video/providers/types';

const providerConfig: SpeechProviderConfig = {
  id: 'test-provider',
  name: 'Test Provider',
  apiKey: 'test-key',
  baseUrl: 'https://example.com',
  models: ['test-model'],
};

describe('video provider data egress metadata', () => {
  it('declares local/cloud egress for every video provider', () => {
    expect(VIDEO_PROVIDER_CAPABILITIES).not.toHaveLength(0);
    expect(
      VIDEO_PROVIDER_CAPABILITIES.every(
        (provider) =>
          provider.dataEgress === 'local' || provider.dataEgress === 'cloud',
      ),
    ).toBe(true);
  });

  it('marks local transcription providers as local egress', () => {
    expect(
      VIDEO_PROVIDER_CAPABILITIES.filter((provider) =>
        provider.kinds.includes('transcribe'),
      ).map((provider) => [provider.id, provider.dataEgress]),
    ).toEqual([
      ['whisperx-local', 'local'],
      ['auto-subs-local', 'local'],
    ]);
  });

  it('declares egress on every speech adapter', () => {
    const adapters = [
      new LocalSpeechAdapter(providerConfig),
      new OpenAISpeechAdapter(providerConfig),
      new DeepgramSpeechAdapter(providerConfig),
      new ElevenLabsSpeechAdapter(providerConfig),
      new ElevenLabsSfxAdapter(providerConfig),
      new MiniMaxSpeechAdapter(providerConfig),
      new SenseAudioSpeechAdapter(providerConfig),
    ];

    expect(
      adapters.map((adapter) => [adapter.name, adapter.dataEgress]),
    ).toEqual([
      ['Local', 'local'],
      ['OpenAI', 'cloud'],
      ['Deepgram', 'cloud'],
      ['ElevenLabs', 'cloud'],
      ['ElevenLabs SFX', 'cloud'],
      ['MiniMax', 'cloud'],
      ['SenseAudio', 'cloud'],
    ]);
  });
});
