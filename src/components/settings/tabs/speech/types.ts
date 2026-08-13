export type LocalModelState =
  | 'not_downloaded'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'error';

export interface LocalModelStatusEntry {
  state: LocalModelState;
  downloadProgress?: { downloadedBytes: number; totalBytes: number };
  phase?: string;
  model?: string;
  size?: string;
  error?: string;
}

export interface LocalModelStatus {
  stt: LocalModelStatusEntry;
  tts: {
    kokoro: LocalModelStatusEntry;
    pocket: LocalModelStatusEntry;
    kitten: LocalModelStatusEntry;
  };
}

export type TtsModelKey = 'kokoro' | 'pocket' | 'kitten';

export interface Voice {
  id: string;
  name: string;
  language?: string;
  gender?: 'male' | 'female' | 'neutral';
  description?: string;
}

export interface ClonedVoiceEntry {
  voiceId: string;
  name: string;
  createdAt: string;
}
