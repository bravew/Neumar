import {
  type WaveformSourceRange,
  waveformPeaksFromAudioBuffer,
} from './waveformPeaks';

interface WaveformWorkerRequest {
  id: string;
  src: string;
  bucketCount: number;
  sourceRange?: WaveformSourceRange;
}

interface WaveformWorkerResponse {
  id: string;
  peaks?: number[];
  error?: string;
}

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WaveformWorkerRequest>) => void) | null;
  OfflineAudioContext?: typeof OfflineAudioContext;
  postMessage: (message: WaveformWorkerResponse) => void;
};

ctx.onmessage = (event: MessageEvent<WaveformWorkerRequest>) => {
  void decode(event.data);
};

async function decode(message: WaveformWorkerRequest): Promise<void> {
  try {
    const OfflineAudioContextCtor = ctx.OfflineAudioContext;
    if (!OfflineAudioContextCtor) {
      throw new Error('OfflineAudioContext unavailable');
    }
    const response = await fetch(message.src);
    if (!response.ok) {
      ctx.postMessage({
        id: message.id,
        peaks: [],
      } satisfies WaveformWorkerResponse);
      return;
    }
    const audioContext = new OfflineAudioContextCtor(1, 1, 44_100);
    const audioBuffer = await audioContext.decodeAudioData(
      await response.arrayBuffer(),
    );
    ctx.postMessage({
      id: message.id,
      peaks: waveformPeaksFromAudioBuffer(
        audioBuffer,
        message.bucketCount,
        message.sourceRange,
      ),
    } satisfies WaveformWorkerResponse);
  } catch (error) {
    ctx.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WaveformWorkerResponse);
  }
}
