---
summary: "Speech service — TTS and STT with provider-agnostic adapters (OpenAI, Deepgram, ElevenLabs, local Sherpa-ONNX), streaming via WebSocket, MCP tools for agents, and local model management"
read_when:
  - Adding or configuring TTS/STT providers
  - Understanding how voice input/output works end-to-end
  - Working on the speech API routes or MCP server
title: "Speech System (TTS / STT)"
---

# Speech System (TTS / STT)

End-to-end voice capabilities: streaming speech-to-text input via microphone, text-to-speech playback for messages, and a pluggable adapter system supporting multiple providers.

## Architecture

```
Frontend (useSpeech / useVoiceRecorder)
  ├── STT: AudioWorklet (PCM @ 16 kHz) → WebSocket → speech/stt/stream
  └── TTS: POST /speech/synthesize → PCM audio → AudioPlaybackEngine

Backend speech service (src-api/src/shared/services/speech/)
  ├── router.ts    — provider discovery + dispatch
  ├── registry.ts  — adapter factory registry
  ├── types.ts     — provider-agnostic interfaces
  ├── local-models.ts — Sherpa-ONNX model download + management
  └── adapters/
      ├── openai.ts      — OpenAI TTS (gpt-4o-mini-tts, tts-1) + Whisper STT
      ├── deepgram.ts    — Deepgram streaming + batch STT (Nova-3 etc.)
      ├── elevenlabs.ts  — ElevenLabs TTS (batch + streaming) + Scribe STT
      └── local.ts       — Local Sherpa-ONNX TTS + STT (offline, privacy-first)

MCP server (src-api/src/shared/mcp/speech-server.ts)
  └── 4 agent tools: synthesize, transcribe, list_voices, list_capabilities
```

## Service Layer (`src-api/src/shared/services/speech/`)

| File | Purpose |
|------|---------|
| `types.ts` | Provider-agnostic interfaces: `SpeechAdapter`, `TTSParams`, `STTResult`, `StreamingSTTSession`, `VoiceInfo`, `LocalModelStatus`, conversation types |
| `registry.ts` | Pattern-based adapter factory registry — maps provider IDs to adapter constructors |
| `router.ts` | Provider discovery, adapter selection, synthesize/transcribe/streaming dispatch |
| `index.ts` | Public API re-exports |
| `local-models.ts` | Sherpa-ONNX model download, extraction, loading, and status tracking |
| `adapters/openai.ts` | OpenAI TTS (`tts-1`, `gpt-4o-mini-tts`) + Whisper batch STT |
| `adapters/deepgram.ts` | Deepgram Nova STT — streaming WebSocket + batch REST, VAD, end-of-turn detection |
| `adapters/elevenlabs.ts` | ElevenLabs TTS (batch + streaming) via `xi-api-key` auth + Scribe STT; voice listing from user library + shared voices |
| `adapters/local.ts` | Sherpa-ONNX offline TTS + STT — downloads bundled models to `~/.<slug>/models/` |

## Adapter Interface

Every adapter implements `SpeechAdapter`:

```typescript
interface SpeechAdapter {
  readonly name: string;
  readonly supportsTTS: boolean;
  readonly supportsSTT: boolean;
  readonly supportsStreamingSTT: boolean;
  readonly supportsStreamingTTS: boolean;

  synthesize?(params: TTSParams): Promise<TTSResult>;
  synthesizeStream?(params: TTSParams): AsyncGenerator<Buffer>;
  transcribe?(params: STTParams): Promise<STTResult>;
  transcribeStream?(config: StreamingSTTConfig): StreamingSTTSession;
  listVoices?(): Promise<VoiceInfo[]>;  // VoiceInfo includes: id, name, language?, gender?, description?, previewUrl?, provider
}
```

The router selects an adapter based on the `provider` field in the request (or falls back to the first available adapter that supports the requested operation).

## Providers

| Provider | TTS | STT | Streaming STT | Streaming TTS | Notes |
|----------|-----|-----|---------------|---------------|-------|
| **OpenAI** | `tts-1`, `gpt-4o-mini-tts` | Whisper | — | — | Voice cloning via `gpt-4o-mini-tts` instructions; 13 voices with gender/language metadata |
| **Deepgram** | Aura 2 (en, fr, es) | Nova-3, Nova-2 | WebSocket (VAD, end-of-turn) | — | Low-latency real-time transcription |
| **ElevenLabs** | `eleven_flash_v2_5`, `eleven_multilingual_v2` | Scribe (`scribe_v2`) | — | Streaming via `/stream` endpoint | Uses `xi-api-key` header (not Bearer); voices fetched from user library + shared voices per language |
| **Local (Sherpa-ONNX)** | Kokoro, Pocket-TTS, Kitten | SenseVoice | — | — | Fully offline; models downloaded on first use; voices for en, fr, es, zh |

## Local Model Management

Local models are stored in `~/.<slug>/models/speech/`. The `local-models.ts` module handles:

1. **Download** — streams archive from configured URL, shows `downloadedBytes / totalBytes` progress
2. **Extraction** — unpacks `.tar.gz` or `.zip` archives
3. **Loading** — initialises `sherpa-onnx-node` bindings (in production, loaded from bundled native addons in Tauri Resources via `RESOURCES_DIR`; in development, loaded via standard `import()`)
4. **Status tracking** — exposes phase-level status: `not_downloaded | downloading | loading | ready | error`

### Corrupted Model Auto-Cleanup

`removeCorruptedModelDir(modelDir, label)` deletes a model directory when corruption or
incompleteness is detected, so the next retry triggers a fresh download.

**Detection stages:**

1. **Pre-load file checks** — after download/extract, required paths must exist:
   - STT (SenseVoice): `model.int8.onnx`, `tokens.txt`
   - Kokoro: `model.onnx`, `tokens.txt`, `voices.bin`
   - Pocket-TTS: `lm_flow.int8.onnx`, `encoder.onnx`, `decoder.int8.onnx`
   - Kitten: `model.fp16.onnx`, `tokens.txt`

2. **Native load failure** — construction of `OfflineRecognizer` (STT) or `OfflineTts` is
   wrapped in `try/catch`. On throw, logs "model load failed, removing corrupted files",
   runs `removeCorruptedModelDir`, then throws with a user-facing error message.

**Recovery behavior:**
- On successful removal: error tells the user files were corrupted and removed; retry to download fresh
- On removal failure: error asks the user to manually delete the model directory and retry

## WebSocket Infrastructure

`src-api/src/shared/ws.ts` provides a module-level singleton wrapper around `@hono/node-ws`:

```
index.ts: initWebSocket(app)          → must be called once before routes mount
speech.ts: getUpgradeWebSocket()      → returns upgradeWebSocket middleware
index.ts: getInjectWebSocket()(server) → binds WS to the HTTP server after serve()
```

## Streaming STT Session Interface

```typescript
interface StreamingSTTSession {
  sendAudio(chunk: Buffer): void;
  onPartial(cb: (text: string) => void): void;
  onFinal(cb: (text: string) => void): void;
  onEndOfTurn(cb: () => void): void;
  onVADStart(cb: () => void): void;
  onVADEnd(cb: () => void): void;
  onError(cb: (error: Error) => void): void;
  close(): void;
}
```

## MCP Speech Server (4 tools)

Auto-registered during plan and execute phases when any speech provider is configured.
Located at `src-api/src/shared/mcp/speech-server.ts`.

| Tool | Description |
|------|-------------|
| `speech_synthesize` | Generate speech audio from text; saves to workspace and returns a file path |
| `speech_transcribe` | Transcribe an audio file path to text |
| `speech_list_voices` | List available TTS voices across all providers |
| `speech_list_capabilities` | List configured providers and local model status |

## Channel Voice Transcription Integration

The speech service acts as the transcription backend for voice messages arriving from Discord and Telegram channels.

### How It Works

Both the channel manager (`src-api/src/shared/channels/channel-manager.ts`) and the gateway voice module (`src-api/src/shared/services/gateway/core/voice-transcription.ts`) call the speech service's `transcribe({ audioData, mimeType })` method to convert voice audio to text.

### Supported Formats from Channels

| Source | Format | Notes |
|--------|--------|-------|
| Discord voice messages | OGG/Opus (48 kHz) | Detected via message flag `8192` |
| Telegram voice messages | OGG/Opus | `message:voice` event |
| Telegram video notes | MP4 | `message:video_note` event |

### Auto-Cleanup

Temporary audio files (`{tmpdir}/neuma-voice/...`) are deleted in a `finally` block after transcription completes, regardless of success or failure. Cleanup failures are silently ignored — they do not affect message routing.

### Pre-Auth Check

Only paired/approved users trigger STT transcription. This is a deliberate cost-optimization gate: unauthenticated voice messages are rejected before any speech API call is made, avoiding unnecessary provider charges.

## Voice Cloning

The OpenAI adapter supports voice cloning via `gpt-4o-mini-tts` instruction-based prompts. Cloned voices are stored in the workspace and manageable through the `/speech/voice-clone` REST endpoints.

---

*See also: [API Routes](api-routes.md) · [MCP Integration](mcp.md) · [Frontend Hooks](../frontend/hooks.md)*
