/**
 * AudioPlaybackEngine — Time-scheduled gapless audio playback with barge-in support.
 *
 * Uses Web Audio API's AudioBufferSourceNode.start(when) for sample-accurate
 * scheduling. A 10ms lookahead compensates for JavaScript timer jitter so that
 * consecutive chunks play back without gaps or overlaps.
 */

const LOOKAHEAD_SECONDS = 0.01; // 10ms jitter compensation
const INT16_MAX = 0x7fff; // 32767
const INT16_MIN = -0x8000; // -32768

type PlaybackEventType = 'ended';
type PlaybackEventListener = () => void;

export class AudioPlaybackEngine {
  private ctx: AudioContext;
  private nextStartTime = 0;
  private playbackStartTime = 0;
  private sources: Set<AudioBufferSourceNode> = new Set();
  private abortController: AbortController | null = null;
  private listeners: Map<PlaybackEventType, Set<PlaybackEventListener>> =
    new Map();
  private destroyed = false;

  constructor() {
    this.ctx = new AudioContext();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Queue a raw PCM (Int16, mono) chunk for gapless playback.
   * The chunk is converted to Float32 and scheduled at the next available time
   * slot with a 10ms lookahead for jitter compensation.
   */
  queuePCM(pcmData: ArrayBuffer, sampleRate: number): void {
    this.ensureNotDestroyed();
    void this.resumeIfSuspended();

    const float32 = this.int16ToFloat32(pcmData);
    const audioBuffer = this.ctx.createBuffer(1, float32.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    this.scheduleBuffer(audioBuffer);
  }

  /**
   * Queue encoded audio (mp3, opus, etc.) for gapless playback.
   * The data is decoded via decodeAudioData and then scheduled identically to
   * raw PCM.
   */
  async queueEncoded(data: ArrayBuffer): Promise<void> {
    this.ensureNotDestroyed();
    await this.resumeIfSuspended();

    // slice() to obtain a transferable copy — decodeAudioData detaches the buffer
    const audioBuffer = await this.ctx.decodeAudioData(data.slice(0));
    this.scheduleBuffer(audioBuffer);
  }

  /**
   * Barge-in: immediately stop all scheduled and playing audio, cancel any
   * pending TTS requests via the abort controller, and return an estimate of
   * how much audio the user actually heard.
   */
  stop(): { heardText: string; cutoffMs: number } {
    const cutoffMs =
      this.playbackStartTime > 0
        ? (this.ctx.currentTime - this.playbackStartTime) * 1000
        : 0;

    for (const source of this.sources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // source may already have ended — ignore
      }
    }
    this.sources.clear();

    // Cancel any in-flight TTS fetch
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.nextStartTime = 0;
    this.playbackStartTime = 0;

    // heardText would require word-level timestamps from the TTS provider;
    // return empty for now.
    return { heardText: '', cutoffMs };
  }

  /** Whether any source nodes are currently scheduled or playing. */
  get isPlaying(): boolean {
    return this.sources.size > 0;
  }

  /** Current AudioContext time in milliseconds. */
  get currentTimeMs(): number {
    return this.ctx.currentTime * 1000;
  }

  /**
   * Create an AbortSignal that will be cancelled on the next barge-in (stop).
   * Use this to wire up pending TTS network requests so they are automatically
   * cancelled when the user interrupts playback.
   */
  createAbortSignal(): AbortSignal {
    this.abortController = new AbortController();
    return this.abortController.signal;
  }

  /** Register a listener for playback events. */
  on(event: PlaybackEventType, listener: PlaybackEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  /** Remove a previously registered listener. */
  off(event: PlaybackEventType, listener: PlaybackEventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  /** Tear down the engine: stop all audio, close the AudioContext. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    void this.ctx.close();

    // Reset the module-level singleton so a fresh instance is created next time
    if (instance === this) {
      instance = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private ensureNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error('AudioPlaybackEngine has been destroyed');
    }
  }

  private async resumeIfSuspended(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /**
   * Schedule an AudioBuffer for gapless playback at the next available time
   * slot. A 10ms lookahead ensures we never schedule in the past even when the
   * JS event loop is slightly delayed.
   */
  private scheduleBuffer(audioBuffer: AudioBuffer): void {
    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.ctx.destination);

    const startTime = Math.max(
      this.ctx.currentTime + LOOKAHEAD_SECONDS,
      this.nextStartTime,
    );

    // Track the wall-clock start of the very first chunk so stop() can compute
    // how much audio the user heard.
    if (this.sources.size === 0 && this.playbackStartTime === 0) {
      this.playbackStartTime = startTime;
    }

    source.start(startTime);
    this.nextStartTime = startTime + audioBuffer.duration;

    this.sources.add(source);

    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();

      if (this.sources.size === 0) {
        this.playbackStartTime = 0;
        this.emit('ended');
      }
    };
  }

  // Truncate trailing odd byte rather than throwing — streaming HTTP can
  // split a 16-bit sample mid-byte. Sample-perfect callers should use the
  // PcmStreamReader helper which carries the byte across chunks.
  private int16ToFloat32(pcmData: ArrayBuffer): Float32Array {
    const usable = pcmData.byteLength - (pcmData.byteLength % 2);
    const buf =
      usable === pcmData.byteLength ? pcmData : pcmData.slice(0, usable);
    const int16 = new Int16Array(buf);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      const val = int16[i];
      float32[i] = val < 0 ? val / -INT16_MIN : val / INT16_MAX;
    }
    return float32;
  }

  private emit(event: PlaybackEventType): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler();
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Singleton accessor
// -----------------------------------------------------------------------------

let instance: AudioPlaybackEngine | null = null;

/**
 * Return a shared AudioPlaybackEngine instance, creating one on first call.
 * The singleton is reset if destroy() is called on the instance.
 */
export function getAudioPlaybackEngine(): AudioPlaybackEngine {
  if (!instance) {
    instance = new AudioPlaybackEngine();
  }
  return instance;
}

/**
 * Read a Response body that streams raw S16LE PCM and queue each chunk to
 * the playback engine, carrying any trailing odd byte across chunk
 * boundaries so 16-bit samples are never split.
 */
export async function pipePcmStreamToEngine(
  response: Response,
  sampleRate: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.body) return;
  const engine = getAudioPlaybackEngine();
  const reader = response.body.getReader();
  let leftover: number | null = null;
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const chunk: Uint8Array = value;

      const carry: number = leftover === null ? 0 : 1;
      const total: number = carry + chunk.byteLength;
      const evenLen: number = total - (total % 2);
      if (evenLen === 0) {
        leftover = chunk[0];
        continue;
      }

      const out = new Uint8Array(evenLen);
      if (carry) out[0] = leftover!;
      out.set(chunk.subarray(0, evenLen - carry), carry);
      leftover = total % 2 === 1 ? chunk[chunk.byteLength - 1] : null;

      engine.queuePCM(out.buffer, sampleRate);
    }
  } finally {
    reader.releaseLock();
  }
}
