import type { DesignSystemRecord } from '@/shared/types/design-mode';

import {
  colorsFor,
  designSystemTheme,
  isColorToken,
} from './designSystemTheme';

export function DesignSystemTokensView({
  system,
  testId,
}: {
  system: DesignSystemRecord;
  testId?: string;
}) {
  const theme = designSystemTheme(system);
  const colors = colorsFor(system);
  const tokens = system.tokens.length > 0 ? system.tokens : colors;

  return (
    <div
      className="min-h-full space-y-8 p-8"
      data-testid={testId}
      style={{ background: theme.surface, color: theme.text }}
    >
      <section>
        <p
          className="text-xs font-semibold tracking-normal uppercase"
          style={{ color: theme.muted }}
        >
          Palette
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {colors.map((color, index) => (
            <div
              key={`${color}-${index}`}
              className="rounded-md border p-3"
              style={{ background: theme.layer, borderColor: theme.border }}
            >
              <div
                className="h-20 rounded-md border"
                style={{ background: color, borderColor: theme.border }}
              />
              <p className="mt-3 font-mono text-xs">{color}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <article
          className="rounded-md border p-5"
          style={{ background: theme.layer, borderColor: theme.border }}
        >
          <p
            className="text-xs font-semibold tracking-normal uppercase"
            style={{ color: theme.muted }}
          >
            Typography
          </p>
          <div className="mt-4 space-y-3">
            <p className="text-4xl font-bold" style={{ color: theme.text }}>
              Display headline
            </p>
            <p className="text-sm leading-6" style={{ color: theme.muted }}>
              Body copy should stay legible, calm, and predictable across
              product workflows.
            </p>
          </div>
        </article>
        <article
          className="rounded-md border p-5"
          style={{ background: theme.layer, borderColor: theme.border }}
        >
          <p
            className="text-xs font-semibold tracking-normal uppercase"
            style={{ color: theme.muted }}
          >
            Components
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md px-4 py-2 text-sm font-medium"
              style={{ background: theme.primary, color: theme.onPrimary }}
            >
              Primary
            </button>
            <button
              type="button"
              className="rounded-md border px-4 py-2 text-sm"
              style={{
                background: theme.layerElevated,
                borderColor: theme.border,
                color: theme.text,
              }}
            >
              Secondary
            </button>
            <span
              className="rounded-full px-3 py-2 text-xs font-medium"
              style={{
                background: `${theme.success}22`,
                color: theme.success,
              }}
            >
              Success
            </span>
          </div>
        </article>
      </section>
      <section
        className="rounded-md border"
        style={{ background: theme.layer, borderColor: theme.border }}
      >
        <div
          className="border-b px-4 py-3 text-sm font-medium"
          style={{ borderColor: theme.border }}
        >
          Tokens
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {tokens.slice(0, 24).map((token) => (
            <div
              key={token}
              className="flex items-center gap-2 rounded-md border p-2 text-xs"
              style={{
                background: theme.layerElevated,
                borderColor: theme.border,
              }}
            >
              {isColorToken(token) && (
                <span
                  className="size-5 rounded border"
                  style={{ background: token }}
                />
              )}
              <span className="min-w-0 truncate font-mono">{token}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
