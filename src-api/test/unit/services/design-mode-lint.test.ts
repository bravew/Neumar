import { describe, expect, it } from 'vitest';

import { lintDesignArtifact } from '@/shared/services/design-mode/lint';

describe('DesignMode craft lint rules', () => {
  it('flags missing state coverage on obvious stateful UI', () => {
    const findings = lintDesignArtifact(
      `
      <main class="dashboard">
        <section class="kpi-grid"><article>Revenue</article></section>
        <table><tbody><tr><td>Acme</td></tr></tbody></table>
      </main>
      `,
      { path: 'artifacts/dashboard.html' },
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'state.missing-coverage',
          message: expect.stringContaining('loading, empty, error'),
        }),
      ]),
    );
  });

  it('accepts loading, empty, and error state coverage', () => {
    const findings = lintDesignArtifact(
      `
      <main class="dashboard">
        <section aria-busy="true">Loading payments...</section>
        <section class="empty-state">No results. Create your first report.</section>
        <section role="alert">Unable to load payments. Retry.</section>
        <table><tbody><tr><td>Acme</td></tr></tbody></table>
      </main>
      `,
    );

    expect(findings.map((finding) => finding.id)).not.toContain(
      'state.missing-coverage',
    );
  });

  it('flags indefinite loading motion without a fallback', () => {
    const findings = lintDesignArtifact(
      `
      <style>
        .spinner { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
      <main class="form"><div class="spinner">Loading</div></main>
      `,
    );

    expect(findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        'state.indefinite-spinner',
        'motion.missing-reduced-motion',
      ]),
    );
  });

  it('flags transform transitions over 500 ms outside page transitions', () => {
    const findings = lintDesignArtifact(
      `
      <style>
        .card { transition: transform 0.7s ease; }
        .card:hover { transform: translateY(-8px); }
      </style>
      <main class="kanban">Loading done. No data. Retry on error.</main>
      `,
    );

    expect(findings.map((finding) => finding.id)).toContain(
      'motion.long-transition',
    );
  });

  it('does not flag reduced-motion-aware transform transitions', () => {
    const findings = lintDesignArtifact(
      `
      <style>
        .card { transition: transform 300ms ease; }
        .card:hover { transform: translateY(-3px); }
        @media (prefers-reduced-motion: reduce) {
          .card { transition: none; transform: none; }
        }
      </style>
      <main class="kanban">Loading done. Empty state. Error retry.</main>
      `,
    );

    expect(findings.map((finding) => finding.id)).not.toEqual(
      expect.arrayContaining([
        'motion.missing-reduced-motion',
        'motion.long-transition',
      ]),
    );
  });
});
