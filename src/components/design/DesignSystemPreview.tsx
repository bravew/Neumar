import type { DesignSystemRecord } from '@/shared/types/design-mode';

import { designSystemTheme } from './designSystemTheme';

export function DesignSystemThumb({
  system,
  testId,
}: {
  system: DesignSystemRecord;
  testId?: string;
}) {
  const theme = designSystemTheme(system);

  return (
    <div
      className="relative aspect-[4/3] overflow-hidden border-b"
      style={{
        background: `linear-gradient(135deg, ${theme.surface}, ${theme.layer})`,
      }}
      data-testid={testId}
    >
      <div className="absolute inset-x-4 top-4 flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-white/70" />
        <span className="size-2 rounded-full bg-white/50" />
        <span className="size-2 rounded-full bg-white/35" />
      </div>
      <div
        className="absolute inset-x-4 top-10 bottom-4 rounded-md p-4 shadow-sm"
        style={{
          background: theme.layer,
          border: `1px solid ${theme.border}`,
        }}
      >
        <div className="flex gap-3">
          <div className="w-1/4 space-y-2">
            <div
              className="h-2 rounded-full"
              style={{ background: theme.accent }}
            />
            <div
              className="h-2 rounded-full"
              style={{ background: theme.border }}
            />
            <div
              className="h-2 w-3/4 rounded-full"
              style={{ background: theme.border }}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div
              className="h-5 w-2/3 rounded-sm"
              style={{ background: theme.text }}
            />
            <div className="grid grid-cols-2 gap-2">
              <div
                className="h-14 rounded-md"
                style={{ background: theme.layerElevated }}
              />
              <div
                className="h-14 rounded-md"
                style={{ background: theme.border }}
              />
            </div>
            <div className="flex gap-2">
              <div
                className="h-5 w-16 rounded-full"
                style={{ background: theme.primary }}
              />
              <div
                className="h-5 w-12 rounded-full"
                style={{ background: theme.border }}
              />
            </div>
          </div>
        </div>
      </div>
      <span className="absolute right-4 bottom-4 rounded bg-black/70 px-2 py-1 text-xs text-white">
        {system.category}
      </span>
    </div>
  );
}

export function DesignSystemShowcase({
  system,
  testId,
}: {
  system: DesignSystemRecord;
  testId?: string;
}) {
  const theme = designSystemTheme(system);

  return (
    <div
      className="min-h-full bg-white text-slate-950"
      data-testid={testId}
      style={{ color: theme.text, background: theme.surface }}
    >
      <header
        className="flex items-center justify-between border-b px-8 py-5"
        style={{ borderColor: theme.border, background: theme.surface }}
      >
        <div className="flex items-center gap-3">
          <span
            className="size-7 rounded-md"
            style={{ background: theme.primary }}
          />
          <span className="text-sm font-semibold">{system.title}</span>
        </div>
        <nav
          className="hidden items-center gap-6 text-xs md:flex"
          style={{ color: theme.muted }}
        >
          <span>Product</span>
          <span>Workspace</span>
          <span>Pricing</span>
          <span>Docs</span>
        </nav>
        <button
          type="button"
          className="rounded-md px-4 py-2 text-xs font-medium"
          style={{ background: theme.primary, color: theme.onPrimary }}
        >
          Get started
        </button>
      </header>
      <main className="space-y-16 px-8 py-14">
        <section className="max-w-4xl">
          <div
            className="mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs tracking-normal uppercase"
            style={{ borderColor: theme.border, color: theme.muted }}
          >
            <span
              className="size-2 rounded-full"
              style={{ background: theme.primary }}
            />
            {system.category} · live preview
          </div>
          <h2 className="max-w-3xl text-5xl leading-tight font-bold md:text-6xl">
            The system that makes{' '}
            <span style={{ color: theme.primary }}>{system.title}</span> feel
            like {system.title}.
          </h2>
          <p
            className="mt-5 max-w-2xl text-base leading-7"
            style={{ color: theme.muted }}
          >
            {system.summary}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-md px-5 py-3 text-sm font-medium"
              style={{ background: theme.primary, color: theme.onPrimary }}
            >
              Start a free trial
            </button>
            <button
              type="button"
              className="rounded-md border px-5 py-3 text-sm font-medium"
              style={{
                background: theme.layer,
                borderColor: theme.border,
                color: theme.text,
              }}
            >
              See it in action
            </button>
          </div>
          <div
            className="mt-10 flex flex-wrap gap-8 text-xs"
            style={{ color: theme.muted }}
          >
            <strong>4.9 · App Store rating</strong>
            <strong>SOC 2 · Type II compliant</strong>
            <strong>120k+ active teams</strong>
          </div>
        </section>
        <section
          className="border-t pt-10"
          style={{ borderColor: theme.border }}
        >
          <p
            className="mb-5 text-xs font-semibold tracking-normal uppercase"
            style={{ color: theme.primary }}
          >
            What it does
          </p>
          <h3 className="max-w-xl text-3xl leading-tight font-bold">
            Every primitive a fast team needs.
          </h3>
          <p
            className="mt-3 max-w-2xl text-sm leading-6"
            style={{ color: theme.muted }}
          >
            A preview styled from the palette, typography, surfaces, and spacing
            guidance in this design system.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              'Tokens that compose',
              'Light and dark in lockstep',
              'Built for product UI',
            ].map((title, index) => (
              <article
                key={title}
                className="rounded-lg border p-5 shadow-sm"
                style={{
                  background: theme.layer,
                  borderColor: theme.border,
                  color: theme.text,
                }}
              >
                <span
                  className="flex size-8 items-center justify-center rounded-md text-sm font-bold text-white"
                  style={{
                    background:
                      index === 0
                        ? theme.primary
                        : index === 1
                          ? theme.accent
                          : theme.success,
                    color:
                      index === 0
                        ? theme.onPrimary
                        : index === 1
                          ? theme.onAccent
                          : theme.onSuccess,
                  }}
                >
                  {index + 1}
                </span>
                <h4 className="mt-5 text-sm font-semibold">{title}</h4>
                <p
                  className="mt-2 text-xs leading-5"
                  style={{ color: theme.muted }}
                >
                  Components inherit the same rhythm, contrast, and emphasis
                  rules across cards, controls, and dense work surfaces.
                </p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
