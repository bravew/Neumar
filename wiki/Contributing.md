# Contributing

This guide covers conventions, coding standards, and the PR workflow for contributing to Neuma.

---

## Getting Started

1. Fork the repository and clone your fork
2. Follow [[Getting Started]] to set up your development environment
3. Create a branch: `git checkout -b feat/your-feature` or `fix/your-bug`
4. Make changes, write tests, validate
5. Open a pull request

---

## Branch Naming

| Type | Pattern | Example |
|---|---|---|
| Feature | `feat/<description>` | `feat/voice-cloning` |
| Bug fix | `fix/<description>` | `fix/sse-reconnect` |
| Chore | `chore/<description>` | `chore/update-deps` |
| Documentation | `docs/<description>` | `docs/memory-system` |
| Refactor | `refactor/<description>` | `refactor/agent-registry` |

---

## Before Opening a PR

Run the full validation suite:

```bash
pnpm validate          # lint + typecheck + format check
pnpm test:fast         # frontend + API integration tests
```

All checks must pass. The CI will also run these automatically.

---

## Coding Conventions

### General

- **TypeScript strict mode** — no `any`, no `!` assertions without justification
- **No `console.*`** in the API — use `createLogger()`
- **No `process.cwd()`** in the API — use `getSetting('workDir')`
- **`crypto.randomUUID()`** for IDs — never `Date.now()`
- **`ContentfulStatusCode`** for dynamic HTTP status codes in Hono

### Frontend

- Max **350 lines per component file** — extract sub-components when exceeded
- **Functional `setState(prev => ...)`** in async/streaming callbacks
- **`AbortController`** cleanup in every `useEffect` with `fetch()`
- **`cn()` utility** for conditional Tailwind classes
- **Module-level constants** for regex, configs, and stable props
- **No inline objects** in JSX props (breaks memoization)

### i18n

**All user-visible strings must use `t()`** — never hardcode English text:

```tsx
// CORRECT
const { t } = useLanguage();
return <button>{t('settings.save')}</button>;

// WRONG
return <button>Save</button>;
```

When adding a new string, add it to all **four locale files**:
- `src/config/locale/messages/en/`
- `src/config/locale/messages/zh/`
- `src/config/locale/messages/es/`
- `src/config/locale/messages/fr/`

### Security

- **Validate user-supplied URLs** before server-side `fetch()` — use the SSRF validator
- **GitHub Actions `run:` blocks** — use `env:` variables, never `${{ }}` interpolation
- **Encrypted storage** for all secrets — never plaintext files
- **Zod validation** on all API endpoint inputs

### Import Sorting

Imports are sorted automatically by Prettier with `@ianvs/prettier-plugin-sort-imports`. Run `pnpm format` before committing.

---

## Backend Service Pattern

Services use the **functional module pattern** (not classes):

```typescript
// src-api/src/shared/services/my-service.ts
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('MyService');

// Module-level state
let initialized = false;

// Exported functions
export async function initialize(): Promise<void> {
  if (initialized) return;
  logger.info('Initializing...');
  initialized = true;
}

export async function doWork(input: string): Promise<string> {
  logger.debug('Processing', { input });
  return input.toUpperCase();
}
```

Do not use classes for services — they complicate testing and `this` binding.

---

## Writing Tests

Every new feature or bug fix should include tests.

### Frontend
- Use React Testing Library — test user-visible behaviour
- Mock the API layer with `vi.mock()`
- Avoid `getByTestId` — use `getByRole`, `getByText`, `getByLabelText`

### API Integration
- Use `app.request()` for fast route tests
- Test both happy path and validation errors (422)
- Cover auth flows where applicable

### API E2E
- Use sparingly — prefer integration tests
- Reserve for flows that require real server startup (WebSocket, SSE)

See [[Testing]] for full test patterns and helpers.

---

## Commit Messages

Follow Conventional Commits:

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`

Examples:
```
feat(memory): add LRU eviction for capacity limit
fix(agent): prevent stale closure in streaming callback
chore(deps): upgrade @anthropic-ai/claude-agent-sdk to 0.8.0
```

---

## Pull Request Guidelines

- **Keep PRs focused** — one feature or fix per PR
- **Write a clear description** explaining what and why
- **Link related issues** with `Fixes #123` or `Closes #123`
- **Add tests** for new behaviour
- **Update documentation** if you change architecture, APIs, or configuration
- **Update all locale files** if you add user-visible strings

### PR Description Template

```markdown
## Summary
- What does this PR do?
- Why is it needed?

## Changes
- List key files changed
- Note any breaking changes

## Testing
- [ ] Frontend unit tests pass
- [ ] API integration tests pass
- [ ] Manually tested on macOS/Linux
- [ ] New tests added for changed behaviour

## Notes
Any caveats, follow-ups, or decisions worth documenting
```

---

## Adding a New AI Provider

1. Create `src-api/src/extensions/agent/<provider>/` directory
2. Implement the `AgentPlugin` interface (see `src-api/src/core/agent/plugin.ts`)
3. Register in `src-api/src/extensions/agent/index.ts`
4. Add provider to `src-api/src/shared/provider/registry.ts`
5. Add UI option in `src/components/settings/ProvidersSettings.tsx`
6. Write integration tests

---

## Adding a New MCP Server

1. Create `src-api/src/shared/mcp/<name>-server.ts`
2. Implement using `@modelcontextprotocol/sdk`
3. Register in `src-api/src/shared/mcp/index.ts`
4. Document in [[MCP Integration]]

---

## Versioning

The project uses **CalVer** (calendar versioning): `YY.M.D` (e.g., `26.2.22` = February 22, 2026).

Version is set in `package.json` at the workspace root. Update it for each release.

---

## Further Reading

- [[Getting Started]] — Development environment
- [[Architecture]] — System overview before making structural changes
- [[Testing]] — Test patterns and running tests
- [[Security]] — Security rules to follow
