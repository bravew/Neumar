# Voice Interface

Neuma includes a full-duplex voice interface: **Text-to-Speech (TTS)** for agent responses and **Speech-to-Text (STT)** for voice input.

---

## Architecture

```
Frontend (React)
├── AudioWorklet (PCM @ 16 kHz)    ← STT input
│     └── WebSocket → /speech/ws
│
└── POST /speech/synthesize         ← TTS output
      └── Audio ArrayBuffer response
```

The frontend uses the **Web Audio API AudioWorklet** to capture microphone input as raw PCM data at 16 kHz, which is streamed in real time to the API server over a WebSocket connection.

TTS is request/response: the frontend POSTs text, the API returns the audio ArrayBuffer, and the frontend plays it back.

---

## Providers

Three provider adapters are available:

### OpenAI

| Feature | Models |
|---|---|
| TTS | `tts-1` (standard), `gpt-4o-mini-tts` (voice cloning) |
| STT | `whisper-1` |

Voice cloning with `gpt-4o-mini-tts` is controlled via an **instruction prompt** — the agent can describe the desired voice style in natural language.

### Deepgram

| Feature | Models |
|---|---|
| STT | `nova-3` (streaming WebSocket) |

Deepgram Nova-3 provides low-latency streaming transcription. The WebSocket connection delivers partial transcriptions as they arrive.

### Local (Sherpa-ONNX)

Fully **offline** — no API key required.

| Feature | Description |
|---|---|
| TTS | Neural TTS via `sherpa-onnx-node` |
| STT | Neural ASR via `sherpa-onnx-node` |
| Models | Stored in `~/.<slug>/models/speech/` |

Local models are automatically downloaded, extracted, and loaded on first use. Download progress is streamed to the UI.

---

## Selecting a Provider

Settings → Voice:

1. Select provider (OpenAI / Deepgram / Local)
2. For OpenAI/Deepgram: enter API key
3. For Local: trigger model download if not already present
4. Select preferred voice (for TTS)

---

## Local Model Management

```
~/.<slug>/models/speech/
├── tts/
│   └── <model-name>/
│       ├── model.onnx
│       └── tokens.txt
└── stt/
    └── <model-name>/
        ├── encoder.onnx
        ├── decoder.onnx
        └── tokens.txt
```

**Download flow:**
1. `GET /speech/capabilities` — check if local model is available
2. `POST /speech/models/download` — start async download
3. SSE progress events during download, extract, and load
4. Model is ready after first successful load

---

## REST API

```
POST /speech/synthesize
  { text: string, voice?: string, provider?: string }
  → ArrayBuffer (audio/mpeg or audio/wav)

POST /speech/transcribe
  FormData { audio: File, language?: string }
  → { text: string, confidence?: number }

GET  /speech/voices
  → { voices: Voice[] }

GET  /speech/capabilities
  → { tts: boolean, stt: boolean, streaming: boolean, localAvailable: boolean }
```

---

## WebSocket Streaming (STT)

```
WS  /speech/ws

Client → Server: { type: "audio", data: ArrayBuffer }  (PCM chunks)
Client → Server: { type: "stop" }

Server → Client: { type: "transcript", text: string, isFinal: boolean }
Server → Client: { type: "error", message: string }
```

The WebSocket is created fresh for each STT session. The client sends PCM chunks as they arrive from the AudioWorklet and receives partial/final transcriptions.

---

## MCP Tools

Agents can use voice capabilities directly via the Speech MCP server:

| Tool | Description |
|---|---|
| `synthesize` | Convert text to speech and play it |
| `transcribe` | Transcribe an audio file |
| `list_voices` | List available TTS voices |
| `list_capabilities` | List active provider capabilities |

---

## Further Reading

- [[MCP Integration]] — Speech MCP server
- [[API Reference]] — `/speech/*` endpoints
