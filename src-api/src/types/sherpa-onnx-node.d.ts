/**
 * Minimal type declarations for sherpa-onnx-node.
 *
 * The package ships JS-only (no .d.ts). These declarations cover only
 * the subset used by speech/local-models.ts.
 */

declare module 'sherpa-onnx-node' {
  interface FeatureConfig {
    sampleRate?: number;
    featureDim?: number;
  }

  interface OfflineSenseVoiceModelConfig {
    model?: string;
    language?: string;
    useInverseTextNormalization?: number;
  }

  interface OfflineModelConfig {
    senseVoice?: OfflineSenseVoiceModelConfig;
    tokens?: string;
    numThreads?: number;
    debug?: boolean | number;
    provider?: string;
  }

  interface OfflineRecognizerConfig {
    featConfig?: FeatureConfig;
    modelConfig?: OfflineModelConfig;
  }

  interface Waveform {
    samples: Float32Array;
    sampleRate: number;
  }

  interface OfflineRecognizerResult {
    text: string;
    lang: string;
    emotion: string;
    event: string;
    timestamps: number[];
    tokens: string[];
  }

  class OfflineStream {
    acceptWaveform(obj: Waveform): void;
  }

  class OfflineRecognizer {
    constructor(config: OfflineRecognizerConfig);
    static createAsync(
      config: OfflineRecognizerConfig,
    ): Promise<OfflineRecognizer>;
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    getResult(stream: OfflineStream): OfflineRecognizerResult;
  }

  interface OfflineTtsKokoroModelConfig {
    model?: string;
    voices?: string;
    tokens?: string;
    dataDir?: string;
    lengthScale?: number;
    lexicon?: string;
    lang?: string;
  }

  interface OfflineTtsPocketModelConfig {
    lmFlow?: string;
    lmMain?: string;
    encoder?: string;
    decoder?: string;
    textConditioner?: string;
    vocabJson?: string;
    tokenScoresJson?: string;
  }

  interface OfflineTtsKittenModelConfig {
    model?: string;
    voices?: string;
    tokens?: string;
    dataDir?: string;
  }

  interface OfflineTtsModelConfig {
    kokoro?: OfflineTtsKokoroModelConfig;
    pocket?: OfflineTtsPocketModelConfig;
    kitten?: OfflineTtsKittenModelConfig;
  }

  interface OfflineTtsConfig {
    model?: OfflineTtsModelConfig;
    maxNumSentences?: number;
    numThreads?: number;
    provider?: string;
  }

  interface GenerationConfig {
    speed?: number;
    referenceAudio?: Float32Array;
    referenceSampleRate?: number;
    numSteps?: number;
    extra?: Record<string, unknown>;
  }

  interface TtsRequest {
    text: string;
    sid: number;
    speed: number;
    enableExternalBuffer?: boolean;
    generationConfig?: GenerationConfig;
  }

  interface GeneratedAudio {
    samples: Float32Array;
    sampleRate: number;
  }

  class OfflineTts {
    constructor(config: OfflineTtsConfig);
    static createAsync(config: OfflineTtsConfig): Promise<OfflineTts>;
    readonly numSpeakers: number;
    readonly sampleRate: number;
    generate(obj: TtsRequest): GeneratedAudio;
    generateAsync(obj: TtsRequest): Promise<GeneratedAudio>;
  }

  function readWave(filename: string): Waveform;
}
