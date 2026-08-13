---
summary: "Provider-agnostic image and video generation service — router, registry, adapter interface, and supported providers (BytePlus, OpenAI, Gemini, Leonardo, OpenAI-compatible image routers)"
read_when:
  - Adding a new media generation provider
  - Understanding how image/video generation works
  - Working with the media MCP server
title: "Media Generation Service"
---

# Media Generation Service

The media generation service provides provider-agnostic image and video generation,
exposed to agents via the built-in Media Generation MCP server.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Media Generation MCP Server             │
│              (shared/mcp/media-server.ts)                │
│                                                          │
│  Tools: media_generate_image, media_generate_video,      │
│         media_check_video, media_list_capabilities        │
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────┐
│                    Router (router.ts)                      │
│                                                           │
│  • Discovers enabled providers from DB settings           │
│  • Selects best adapter for image/video requests          │
│  • Routes generation calls to the matching adapter        │
│  • Manages async video task → provider mapping (1h TTL)   │
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────┐
│              Registry (registry.ts)                        │
│                                                           │
│  Pattern-based adapter factory — first match wins:        │
│  • BytePlus: url/model patterns for Seedream/Seedance      │
│  • Leonardo: providerIdPrefix "leonardo"                  │
│  • OpenAI-compatible image routers: custom-image,          │
│    imagerouter                                             │
│  • OpenAI:   url/model patterns for GPT-Image/Sora         │
│  • Gemini:   url/model patterns for Imagen/Veo/Gemini img │
└────────┬──────────────┬──────────────────┬───────────────┘
         │              │                  │
    ┌────▼───┐    ┌─────▼────┐    ┌───────▼──────┐
    │BytePlus│    │  OpenAI  │    │Google Gemini │
    │Adapter │    │  Adapter │    │   Adapter    │
    └────────┘    └──────────┘    └──────────────┘
         │              │                  │
    ┌────▼────┐   ┌─────▼──────┐    ┌─────▼─────┐
    │Leonardo │   │ImageRouter │    │Codex local│
    │Adapter  │   │/custom img │    │image path │
    └─────────┘   └────────────┘    └───────────┘
```

## Adapter Interface

Every provider implements the `MediaGenerationAdapter` interface:

| Method                       | Returns                  | Description                                       |
| ---------------------------- | ------------------------ | ------------------------------------------------- |
| `generateImage(params)`      | `ImageGenerationResult`  | Synchronous image generation (returns when ready) |
| `createVideoTask(params)`    | `VideoTaskCreatedResult` | Starts async video task, returns task ID          |
| `getVideoTaskStatus(taskId)` | `VideoTaskStatusResult`  | Polls async video task status                     |

## Supported Providers

| Adapter                 | Image Models                                          | Video Models | Base URL Pattern                                                       |
| ----------------------- | ----------------------------------------------------- | ------------ | ---------------------------------------------------------------------- |
| **Codex local**         | Provider-prefixed local image models                  | —            | `codex:` model IDs / `codex://local`                                   |
| **BytePlus**            | Seedream, SeedEdit, Doubao Seedream                   | Seedance     | `byteplus`, `bytedance`, `volcengine`, `ark.` or Seed model names      |
| **Leonardo.ai**         | Leonardo Phoenix/Kino/Flux/Anime models               | —            | `leonardo:` model IDs or `leonardo.ai`                                 |
| **Custom OpenAI Image** | OpenAI-compatible image endpoints                     | —            | `custom-image:` model IDs                                              |
| **ImageRouter**         | ImageRouter models                                    | —            | `imagerouter:` model IDs or `imagerouter.io`                           |
| **OpenAI**              | DALL-E, GPT-Image, ChatGPT Image                      | Sora         | `openai.com` or matching model names                                   |
| **Google Gemini**       | Imagen, Gemini image models, Nano Banana when enabled | Veo          | `googleapis.com`, `generativelanguage.google`, or matching model names |

## Key Design Choices

- **Two entry points** — regular agent conversations use the Media Generation MCP tools;
  DesignMode wraps the same provider routers through `/design/projects/:id/media` so
  local design projects can track budgets, provenance, generated assets, and exports
- **Provider auto-discovery** — adapters are matched by URL pattern or model name pattern
  from the user's configured providers (same providers used for chat)
- **Provider-prefix routing first** — model IDs such as `leonardo:*`, `custom-image:*`,
  `imagerouter:*`, and `codex:*` win before regex matching so similarly named models do not
  route to the wrong adapter
- **Async video model** — video generation is asynchronous (create task → poll status)
  because video rendering can take minutes; task-to-provider mapping has a 1-hour TTL
- **Graceful degradation** — if no media providers are configured, tools return a
  user-friendly "no provider configured" message instead of failing
- **Reference image handling** — OpenAI image edits use a 30-second reference-image fetch
  timeout and image requests use a 5-minute provider timeout; Gemini image generation uses
  the chat-completions image path when routed through OpenRouter-compatible proxies
- **Gated Gemini image routing** — Nano Banana model names are only selected when
  `NEUMA_PROVIDER_NANO_BANANA=1`; otherwise the Gemini adapter falls back to Imagen/Gemini
  image patterns
- **Speech handoff** — DesignMode audio requests pass `languageBoost` through to the speech
  router so MiniMax can set its `language_boost` field or infer it from the requested
  language

---

_See also: [MCP Integration](mcp.md) · [Provider Management](providers.md)_
