# Testing

All testing uses **Vitest** across the full stack. Three distinct suites cover different layers of the system.

---

## Test Suites

| Suite | Config | Runner | Description |
|---|---|---|---|
| Frontend unit | `vitest.config.ts` | jsdom | React components, hooks, utilities |
| API integration | `src-api/vitest.config.ts` | node | Hono routes via `app.request()` |
| API E2E | `src-api/vitest.e2e.config.ts` | node | Real server spawn |

---

## Running Tests

```bash
# Fast feedback (no E2E)
pnpm test:fast

# All suites including E2E
pnpm test:all

# Individual suites
pnpm test                  # Frontend unit
pnpm test:api              # API integration
pnpm test:e2e              # API E2E

# Watch modes
pnpm test:watch            # Frontend interactive
pnpm test:api:watch        # API integration interactive

# Coverage
pnpm test:coverage         # Frontend + API combined
```

---

## Frontend Tests (`src/__tests__/`)

**Framework:** React Testing Library + jsdom

Tests render components in a simulated DOM and assert on user-visible behaviour, not implementation details.

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskInput } from '@/components/home/TaskInput';

test('submits task on Enter', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<TaskInput onSubmit={onSubmit} />);

  await user.type(screen.getByRole('textbox'), 'Hello{Enter}');
  expect(onSubmit).toHaveBeenCalledWith('Hello');
});
```

**Key conventions:**
- Test user-visible behaviour, not implementation
- Use `screen.getByRole()` (not `getByTestId`) where possible
- `userEvent` for simulating real interactions
- Mock the API layer (`vi.mock('@/shared/lib/api-client')`)

---

## API Integration Tests (`src-api/test/integration/`)

**Approach:** Use Hono's `app.request()` to call routes without starting a real HTTP server. Fast, isolated, no network.

```typescript
import { app } from '@/app';

test('GET /health returns 200', async () => {
  const res = await app.request('/health');
  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.status).toBe('ok');
});

test('POST /agent/plan validates input', async () => {
  const res = await app.request('/agent/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ /* invalid */ })
  });
  expect(res.status).toBe(422);
});
```

---

## API E2E Tests (`src-api/test/e2e/`)

**Approach:** Spawn a real server process and hit it with real HTTP requests.

```typescript
import { spawnApiInstance } from '../helpers/spawn-api';

let url: string;
let kill: () => Promise<void>;

beforeAll(async () => {
  ({ url, kill } = await spawnApiInstance());
});

afterAll(async () => {
  await kill();
});

test('health endpoint', async () => {
  const res = await fetch(`${url}/health`);
  expect(res.status).toBe(200);
});
```

E2E tests are slower but catch issues that only appear with a real server (port binding, middleware order, async initialization).

---

## Test Helpers (`src-api/test/helpers/`)

| Helper | Purpose |
|---|---|
| `spawn-api.ts` | Spawn and kill a real API instance on a free port |
| `http-client.ts` | Typed fetch wrapper with base URL |
| `poll.ts` | Retry until assertion passes (for async operations) |
| `free-port.ts` | Find a random available TCP port |
| `temp-home.ts` | Create a temporary `$HOME` directory for test isolation |
| `mock-llm.ts` | Mock Anthropic/OpenAI API responses |
| `mock-mcp.ts` | Mock MCP server responses |

---

## Test Environment Isolation

`test/global-setup.ts` runs once before all API tests:

```typescript
export async function setup() {
  // Create isolated temp HOME — prevents polluting real config
  process.env.HOME = await fs.mkdtemp('/tmp/neuma-test-');

  // Ensure no real API keys are active
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
}
```

This prevents tests from accidentally reading real configuration or writing to the user's actual data directory.

---

## Coverage Requirements

Coverage thresholds for the API (enforced in CI):

| Metric | Threshold |
|---|---|
| Lines | 70% |
| Functions | 70% |
| Statements | 70% |
| Branches | 55% |

Coverage is collected with V8 (no instrumentation overhead). Run:

```bash
pnpm test:coverage
```

Reports are written to `coverage/` in both HTML (browser preview) and JSON formats.

---

## CI Integration

Tests run on every push and PR in GitHub Actions (`.github/workflows/ci.yml`):

```yaml
steps:
  - pnpm install
  - pnpm validate        # lint + typecheck + format
  - pnpm test:fast       # frontend + API integration
  # E2E tests run in a separate job with longer timeout
  - pnpm test:e2e
```

The CI matrix runs on Ubuntu (primary) and macOS (secondary for Tauri-specific tests).

---

## Writing New Tests

### Frontend component test template

```typescript
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { MyComponent } from '@/components/feature/MyComponent';

// Wrap in necessary providers
const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <LanguageProvider>
      <ThemeProvider>{ui}</ThemeProvider>
    </LanguageProvider>
  );
};

describe('MyComponent', () => {
  it('renders correctly', () => {
    renderWithProviders(<MyComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });
});
```

### API route test template

```typescript
import { describe, expect, it } from 'vitest';
import { app } from '@/app';

describe('POST /my-route', () => {
  it('returns 200 for valid input', async () => {
    const res = await app.request('/my-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field: 'value' }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 422 for invalid input', async () => {
    const res = await app.request('/my-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: true }),
    });
    expect(res.status).toBe(422);
  });
});
```

---

## Further Reading

- [[Build and Deployment]] — CI/CD pipeline
- [[Backend]] — API architecture to understand what to test
- [[Frontend]] — React patterns that affect testability
