import { describe, expect, it } from 'vitest';

import {
  analyseCtaHierarchy,
  lintDesignArtifact,
} from '@/shared/services/design-mode/lint';

describe('DesignMode CTA hierarchy lint', () => {
  it('accepts one primary CTA paired with a secondary CTA', () => {
    const report = analyseCtaHierarchy(`
      <section>
        <a class="btn btn-primary" href="/signup">Get started</a>
        <a class="btn" href="/learn-more">Learn more</a>
      </section>
    `);

    expect(report.issues).toEqual([]);
    expect(report.primaryCount).toBe(1);
    expect(report.secondaryCount).toBe(1);
  });

  it('flags multiple primary CTAs in one section as guidance', () => {
    const findings = lintDesignArtifact(
      `
      <section>
        <a class="btn btn-primary" href="/signup">Sign up</a>
        <a class="btn btn-primary" href="/buy">Buy now</a>
      </section>
      `,
      { path: 'artifacts/index.html' },
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'qa.cta-hierarchy.multiple-primary',
          severity: 'p1',
          path: 'artifacts/index.html',
        }),
      ]),
    );
  });

  it('flags ambiguous CTA weight when section actions are visually identical', () => {
    const findings = lintDesignArtifact(`
      <header>
        <a class="btn" href="/start">Get started</a>
        <a class="btn" href="/subscribe">Subscribe</a>
        <a class="btn" href="/buy">Buy</a>
      </header>
    `);

    expect(findings.map((finding) => finding.id)).toContain(
      'qa.cta-hierarchy.ambiguous-weight',
    );
  });

  it('flags secondary copy styled as a primary CTA', () => {
    const findings = lintDesignArtifact(`
      <section>
        <a class="btn btn-primary" href="/buy">Buy now</a>
        <a class="btn" style="background-color: #1d4ed8; color: white" href="/learn">
          Learn more
        </a>
      </section>
    `);

    expect(findings.map((finding) => finding.id)).toContain(
      'qa.cta-hierarchy.misleading-prominence',
    );
  });

  it('keeps unrelated sections isolated', () => {
    const findings = lintDesignArtifact(`
      <article>
        <section><a class="btn" href="/a">Get started</a></section>
        <section><a class="btn" href="/b">Subscribe</a></section>
      </article>
    `);

    expect(findings.map((finding) => finding.id)).not.toContain(
      'qa.cta-hierarchy.ambiguous-weight',
    );
  });
});
