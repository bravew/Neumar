---
summary: "Multi-provider web search service — registry, router with failover, 13 adapters, MCP server, settings UI"
read_when:
  - Adding or configuring search providers
  - Understanding the search architecture
  - Working with the search MCP server or API routes
title: "Web Search Service"
---

# Web Search Service

Multi-provider web search with intelligent failover, result caching, and MCP tool exposure.

## Architecture

```
SearchSettings UI  ─→  REST API  ─→  SQLite (SearchConfig)
                                          ↓
MCP Server (3 tools)  ─→  Router  ←──  Config (5s cache)
                            ↓
                   Registry → Adapter Factory
                            ↓
               Priority-ordered failover execution
                            ↓
                   Result cache (SHA256, 15min TTL, max 500)
```

### Registry (`shared/services/search/registry.ts`)

Central `Map<string, AdapterFactory>` mapping provider IDs to adapter constructors. Functions:

- `createSearchAdapter(id, config)` — instantiate a provider adapter
- `isKnownProvider(id)` — check if provider is registered
- `providerRequiresApiKey(id)` — whether API key is mandatory

### Router (`shared/services/search/router.ts`)

Orchestration layer with failover:

- Reads `SearchConfig` from SQLite with 5-second cache TTL (Zod-validated)
- Providers sorted by priority (lower = higher), executed in order with automatic failover
- Result caching: SHA256-hashed query params → response (15 min TTL, max 500 entries)
- Adapter instance cache: 10-second TTL to reduce allocation overhead
- SSRF validation on user-provided base URLs

Functions:

| Function | Description |
|----------|-------------|
| `search(params)` | Execute search with priority-ordered failover |
| `getSearchConfig()` | Fetch and validate config from DB |
| `isSearchEnabled()` | Check if service is enabled with valid providers |
| `listProviders()` | Return provider status list |
| `testProvider(id, config)` | Test connectivity and latency |

### Presets (`shared/services/search/presets.ts`)

Metadata for all 13 providers used by the settings UI:

- Human-readable names and descriptions (i18n keys)
- API key registration URLs
- Categories: `ai-native`, `serp`, `academic`, `privacy`, `chinese`, `self-hosted`
- Default priorities (10–100)
- Extra config fields (e.g., Google CSE requires `searchEngineId`)
- Default base URLs for self-hosted providers

## Supported Providers

| Provider | Category | API Key | Default Priority | Notes |
|----------|----------|---------|-----------------|-------|
| **Tavily** | ai-native | Required | 10 | AI-optimized with relevance scoring and answer summaries |
| **Exa** | academic | Required | 20 | Semantic search for academic papers and deep content |
| **Brave** | privacy | Required | 30 | Privacy-focused with independent index |
| **Perplexity** | ai-native | Required | 40 | Search-augmented AI answers with citations |
| **You.com** | ai-native | Required | 50 | Web and news search with livecrawl |
| **Serper** | serp | Required | 55 | Fast Google search API |
| **SerpAPI** | serp | Required | 60 | Google results API with 80+ engines |
| **Metaso** | chinese | Required | 65 | Chinese AI search engine |
| **Jina** | ai-native | **Free** | 70 | Search with URL-to-markdown conversion |
| **Google CSE** | serp | Required | 75 | Google Custom Search Engine (needs `searchEngineId`) |
| **Yandex** | serp | Required | 80 | Russian and CIS region optimized |
| **SearXNG** | self-hosted | **Free** | 90 | Self-hosted meta search engine (needs `baseUrl`) |
| **DuckDuckGo** | privacy | **Free** | 100 | Free privacy-focused fallback |

Key-free providers: DuckDuckGo, Jina, SearXNG.

## Type System (`shared/services/search/types.ts`)

### SearchAdapter Interface

All adapters implement:

- `search(params: SearchParams): Promise<SearchResponse>` — execute search
- `testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }>` — connectivity test

### SearchParams

| Field | Type | Description |
|-------|------|-------------|
| `query` | `string` | Search query |
| `maxResults` | `number` | Results per query (1–10) |
| `country` | `string?` | Regional filtering |
| `language` | `string?` | Language filtering |
| `freshness` | `string?` | Time-based filtering |
| `includeDomains` | `string[]?` | Domain allowlist |
| `excludeDomains` | `string[]?` | Domain blocklist |
| `type` | `string?` | Search type (web/news) |
| `safeSearch` | `string?` | Content filtering level |

### SearchResponse

| Field | Type | Description |
|-------|------|-------------|
| `results` | `SearchResult[]` | Normalized results (title, url, snippet, content?) |
| `answer` | `string?` | AI-generated answer (provider-dependent) |
| `citations` | `string[]?` | Source citations |
| `latencyMs` | `number` | Request duration |
| `cached` | `boolean` | Whether result was from cache |
| `provider` | `string` | Provider that served the result |

### SearchConfig (SQLite `settings` table)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Master toggle |
| `mode` | `'auto' \| 'always' \| 'manual'` | `'auto'` | When to inject search tools |
| `providers` | `SearchProviderEntry[]` | `[]` | Ordered provider list |
| `maxResults` | `number` | `5` | Default results per query |
| `timeoutSeconds` | `number` | `10` | Per-provider request timeout |
| `cacheTtlMinutes` | `number` | `15` | Result cache duration |
| `defaultCountry` | `string?` | — | Default regional filter |
| `defaultLanguage` | `string?` | — | Default language filter |
| `safeSearch` | `'off' \| 'moderate' \| 'strict'` | `'moderate'` | Content filtering |

**Mode behavior:**

- `auto` — search tools injected only for non-Claude providers (Claude has built-in web search)
- `always` — search tools injected for all providers, overriding built-in search
- `manual` — search tools only used when explicitly called

## MCP Server (`shared/mcp/search-server.ts`)

Three tools exposed to agents:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `web_search` | `query`, `max_results` (1–10), `freshness`, `country`, `language`, `include_domains`, `exclude_domains` | General web search; returns formatted markdown |
| `web_search_news` | Same as `web_search` | News-specific search (past week freshness) |
| `search_list_providers` | — | Lists configured providers with status and credential info |

Results are formatted as markdown text (not raw JSON) for agent consumption, including title, URL, snippet, content availability indicator, and answer summaries when available.

## API Routes (`app/api/search.ts`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/search/providers` | List configured providers with status |
| `GET` | `/search/presets` | Return all 13 provider preset definitions |
| `GET` | `/search/config` | Current config (API keys masked as `••••••••`) |
| `POST` | `/search/test` | Test provider connectivity (returns `{ok, latencyMs, error}`) |
| `POST` | `/search/query` | Execute search for UI testing |

All endpoints use Zod validation for request bodies.

## Frontend Settings

### SearchSettings Tab (`components/settings/tabs/SearchSettings.tsx`)

- **Master toggle** — enable/disable entire search service
- **Mode selector** — `auto` / `always` / `manual`
- **Provider management** — sortable list by priority (up/down arrows), add/remove, per-provider enable/disable
- **General settings** — max results, timeout, cache TTL, safe search level
- **Test search** — input query and button to test with current config

### ProviderCard (`components/settings/tabs/search/ProviderCard.tsx`)

Per-provider card with:

- Name, description (localized), enable/disable toggle, priority arrows
- API key input (password field) + "Get Key" link
- Base URL input (for self-hosted like SearXNG)
- Extra config fields (e.g., Google CSE's Search Engine ID)
- "No API key required" badge for key-free providers

## Integration Flow

```
Agent → Claude SDK query() → MCP servers loaded (+ search server when enabled) → web_search tool available
                                                                                       ↓
                                                                                  Router.search()
                                                                                       ↓
                                                                              Priority failover → Adapter → HTTP → Provider API
                                                                                       ↓
                                                                              Cache result → Format markdown → Return to agent
```

The search MCP server is registered during both plan and execute phases when search is enabled and at least one provider is configured.

---

*See also: [MCP Integration](mcp.md) · [API Routes](api-routes.md) · [Agent System](agent-system.md)*
