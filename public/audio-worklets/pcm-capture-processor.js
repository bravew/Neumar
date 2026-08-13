/**
 * PCM Capture AudioWorklet Processor
 *
 * Captures raw PCM audio at 16kHz 16-bit mono.
 * Buffers 128-sample frames (~8ms at 16kHz) into ~128ms chunks (2048 samples),
 * converts Float32 [-1.0, 1.0] to Int16 PCM, and posts the buffer as a
 * transferable to the main thread.
 */

const BUFFER_SIZE = 2048; // ~128ms at 16kHz

class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(BUFFER_SIZE);
    this._writeIndex = 0;

    this.port.onmessage = (event) => {
      if (event.data && event.data.command === 'flush') {
        this._flush();
      }
    };
  }

  /**
   * Convert buffered Float32 samples to Int16 PCM and post to the main thread.
   * @param {number} sampleCount - Number of valid samples in the buffer to send.
   */
  _sendBuffer(sampleCount) {
    if (sampleCount === 0) return;

    const pcm16 = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      // Clamp to [-1.0, 1.0] then scale to Int16 range
      const sample = Math.max(-1, Math.min(1, this._buffer[i]));
      pcm16[i] = sample * 0x7fff;
    }

    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
  }

  /**
   * Flush any remaining samples in the buffer to the main thread.
   */
  _flush() {
    if (this._writeIndex > 0) {
      this._sendBuffer(this._writeIndex);
      this._writeIndex = 0;
    }
  }

  /**
   * Called by the Web Audio API for each render quantum (128 samples).
   * Accumulates samples into the internal buffer and sends when full.
   */
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Use the first channel (mono capture)
    const channelData = input[0];
    if (!channelData) return true;

    let readIndex = 0;
    const framesToCopy = channelData.length;

    while (readIndex < framesToCopy) {
      const remaining = BUFFER_SIZE - this._writeIndex;
      const toCopy = Math.min(remaining, framesToCopy - readIndex);

      this._buffer.set(
        channelData.subarray(readIndex, readIndex + toCopy),
        this._writeIndex,
      );
      this._writeIndex += toCopy;
      readIndex += toCopy;

      if (this._writeIndex >= BUFFER_SIZE) {
        this._sendBuffer(BUFFER_SIZE);
        this._writeIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-capture-processor', PCMCaptureProcessor);
