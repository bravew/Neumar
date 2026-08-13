# Frontend

The frontend is a React 19 + Vite 7 single-page application embedded in the Tauri WebView. It communicates with the API server over HTTP and Server-Sent Events.

---

## Directory Structure

```
src/
├── app/
│   ├── pages/
│   │   ├── Home.tsx          New task input + agent chat
│   │   ├── TaskDetail.tsx    Active task view (plan → execution)
│   │   ├── Library.tsx       Generated file browser
│   │   └── Setup.tsx         First-run wizard
│   ├── App.tsx               Root component
│   └── router.tsx            React Router v7 config
│
├── components/               Feature-organized component tree
│   ├── artifacts/            File renderers (PDF, HTML, code, images)
│   ├── auth/                 OAuth flow cards
│   ├── automation/           Automation trigger config
│   ├── common/               Logo, brand visuals
│   ├── home/                 AgentMessages, TaskInput
│   ├── layout/               Sidebars, layout context
│   ├── library/              Library page components
│   ├── settings/             Settings modal tabs
│   ├── shared/               ChatInput, FolderPicker, LazyImage
│   ├── task/                 PlanApproval, ToolExecution, streaming
│   ├── workspace/            Workspace selector
│   └── ui/                   Radix UI primitive wrappers
│
├── config/
│   ├── index.ts              API base URLs, app metadata
│   ├── locale/               i18n messages (en / zh / es / fr)
│   └── style/                Global CSS, Tailwind theme variables
│
├── shared/
│   ├── db/                   Dual-backend DB abstraction (SQLite/IndexedDB)
│   ├── hooks/                useAgent, useProviders, useVitePreview, …
│   ├── lib/                  API clients, attachment utils, path helpers
│   ├── types/                TypeScript interfaces
│   ├── auth/                 Auth context, Tauri keychain bridge
│   └── providers/            ThemeProvider, LanguageProvider
│
├── core/
│   └── i18n/                 Translation type definitions
│
└── main.tsx                  Entry point
```

---

## Bootstrap Sequence

```
index.html
  └── main.tsx
        └── <ErrorBoundary>
              └── <LanguageProvider>       i18n context
                    └── <ThemeProvider>    light/dark theme
                          └── <RouterProvider>
                                ├── /               Home       (lazy)
                                ├── /task/:taskId   TaskDetail (lazy)
                                ├── /library        Library    (lazy)
                                └── /setup          Setup      (lazy)
```

All pages load via `React.lazy()` with a `<Suspense>` spinner fallback. The root `/` route is guarded by `<SetupGuard>` which redirects to `/setup` if Claude Code CLI is not found.

---

## Routing

| Path | Component | Guard |
|---|---|---|
| `/` | `Home` | `SetupGuard` |
| `/task/:taskId` | `TaskDetail` | — |
| `/library` | `Library` | — |
| `/setup` | `Setup` | — |

React Router v7 is used with the data router API.

---

## State Management

State is kept local to features — there is no global Redux/Zustand store. The primary patterns are:

### useAgent hook
Manages the full task lifecycle: sending prompts, subscribing to SSE streams, accumulating messages, tracking cost, and cancellation. See [[Agent System]] for the server side.

### Database abstraction layer
`src/shared/db/` provides a unified API over two backends:

- **Tauri context** — calls the Rust SQLite plugin (`tauri-plugin-sql`)
- **Browser context** — falls back to IndexedDB (for `pnpm dev:web`)

All queries use the same interface; the active backend is resolved at runtime by checking if the Tauri API is available.

### React patterns in use

| Pattern | Why |
|---|---|
| Functional `setState(prev => ...)` | Prevents stale closures in async/streaming callbacks |
| `useRef` for current values | Avoids stale closure capture in sparse `useCallback` deps |
| `AbortController` in `useEffect` | Cancels in-flight requests on unmount (React 19 StrictMode-safe) |
| Interaction ref | Tracks user actions to skip auto-behavior when user has manually acted |
| `try/catch/finally` flag | Prevents `finally` from overwriting error state set in `catch` |
| `crypto.randomUUID()` | Collision-free IDs (never `Date.now()`) |
| Module-level constants | Regex, configs, stable props extracted to avoid re-creating on render |

---

## Styling

- **Tailwind CSS 4** with design tokens defined in `src/config/style/`
- **Radix UI** primitives for accessible components (Dialog, Dropdown, Tooltip, etc.)
- **`cn()` utility** (clsx + tailwind-merge) for conditional class names
- Dark mode toggled via CSS custom properties; no class-based switching
- Brand colors injected as CSS variables from `branding.json` (`primaryColor`, `primaryColorDark`)

---

## Internationalization (i18n)

Four locales are supported: **English**, **Chinese (Simplified)**, **Spanish**, **French**.

```
src/config/locale/messages/
├── en/    English (source of truth)
├── zh/    Chinese
├── es/    Spanish
└── fr/    French
```

Usage in components:
```tsx
import { useLanguage } from '@/shared/providers/LanguageProvider';

function MyComponent() {
  const { t } = useLanguage();
  return <p>{t('home.placeholder')}</p>;
}
```

**Rule:** All user-visible strings must use `t()` — never hardcode English. When adding a string, update all four locale files.

The system is custom (not a library) to avoid bundle overhead and to be fully type-safe.

---

## Component Guidelines

| Rule | Detail |
|---|---|
| Max 350 lines per file | Extract sub-components when exceeded |
| Feature-organized | Place in `components/<feature>/`, not a flat list |
| No inline objects in JSX | Extract to module-level constants to preserve memoization |
| Radix primitives | Use for all interactive/accessible components |
| `cn()` for conditional classes | Never string-concatenate class names |

---

## Artifact Preview

The `components/artifacts/` subtree renders agent-generated files:

| File type | Renderer |
|---|---|
| HTML | Sandboxed iframe with live reload |
| React component | Vite preview server (spawned by API) |
| PDF | Native PDF viewer |
| Images | `LazyImage` with thumbnail support |
| Code | Syntax-highlighted viewer |

---

## Path Alias

`@/*` maps to `src/*` — use this everywhere instead of relative imports.

```ts
import { useAgent } from '@/shared/hooks/useAgent';
```

---

## Further Reading

- [[Architecture]] — How the frontend fits in the overall system
- [[Agent System]] — The `useAgent` hook's server-side counterpart
- [[Backend]] — API endpoints the frontend calls
