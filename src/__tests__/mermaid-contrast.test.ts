import { describe, expect, it } from 'vitest';

import {
  injectMermaidContrast,
  preprocessMermaidInMarkdown,
} from '@/shared/lib/mermaid-contrast';

describe('injectMermaidContrast', () => {
  it('appends dark text color to a light fill', () => {
    const out = injectMermaidContrast('style Show fill:#90EE90');
    expect(out).toContain('fill:#90EE90');
    expect(out).toContain('color:#0f172a');
  });

  it('appends light text color to a dark fill', () => {
    const out = injectMermaidContrast('style End fill:#1f2937');
    expect(out).toContain('color:#f8fafc');
  });

  it('respects explicit color: clause', () => {
    const src = 'style Foo fill:#90EE90,color:#ff0000';
    expect(injectMermaidContrast(src)).toBe(src);
  });

  it('handles 3-digit hex shorthand', () => {
    const out = injectMermaidContrast('style A fill:#fff');
    expect(out).toContain('color:#0f172a');
  });

  it('leaves non-style lines alone', () => {
    const src = 'flowchart TD\n  A --> B\n';
    expect(injectMermaidContrast(src)).toBe(src);
  });

  it('handles multiple style lines independently', () => {
    const src = 'style A fill:#90EE90\nstyle B fill:#1f2937';
    const out = injectMermaidContrast(src);
    expect(out).toMatch(/fill:#90EE90,color:#0f172a/);
    expect(out).toMatch(/fill:#1f2937,color:#f8fafc/);
  });
});

describe('preprocessMermaidInMarkdown', () => {
  it('processes only inside fenced ```mermaid blocks', () => {
    const md = [
      '# Title',
      '',
      '```mermaid',
      'flowchart TD',
      'style Foo fill:#90EE90',
      '```',
      '',
      '```js',
      'style X fill:#90EE90  // not mermaid; leave alone',
      '```',
    ].join('\n');
    const out = preprocessMermaidInMarkdown(md);
    // Mermaid block got the contrast color
    expect(out).toMatch(/style Foo fill:#90EE90,color:#0f172a/);
    // JS block untouched (still has the original style line, no color appended)
    expect(out).toContain('style X fill:#90EE90  // not mermaid');
    expect(out.match(/style X fill:#90EE90,color:/)).toBeNull();
  });

  it('handles markdown without any mermaid blocks', () => {
    expect(preprocessMermaidInMarkdown('Hello world')).toBe('Hello world');
  });
});
