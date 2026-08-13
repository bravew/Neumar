import { describe, expect, it } from 'vitest';

import { ArtifactEnvelopeTextFilter } from '@/core/agent/artifact-envelope-filter';

function collect(filter: ArtifactEnvelopeTextFilter, chunks: string[]): string {
  return chunks.map((chunk) => filter.push(chunk)).join('') + filter.flush();
}

describe('ArtifactEnvelopeTextFilter', () => {
  it('passes through ordinary text', () => {
    const text = collect(new ArtifactEnvelopeTextFilter(), ['hello ', 'world']);
    expect(text).toBe('hello world');
  });

  it('suppresses complete artifact envelopes', () => {
    const text = collect(new ArtifactEnvelopeTextFilter(), [
      'before <artifact>{"kind":"html","content":"<main />"}</artifact> after',
    ]);
    expect(text).toBe('before  after');
  });

  it('suppresses artifact envelopes split across chunks', () => {
    const text = collect(new ArtifactEnvelopeTextFilter(), [
      'before <arti',
      'fact>{"kind":"html"',
      '}</artifact> after',
    ]);
    expect(text).toBe('before  after');
  });

  it('suppresses DSML-style aliases', () => {
    const text = collect(new ArtifactEnvelopeTextFilter(), [
      'a <dsml>{"component":"card"}</dsml> b ',
      '<design-artifact>{"id":"x"}</design-artifact> c',
    ]);
    expect(text).toBe('a  b  c');
  });

  it('does not suppress artifact examples inside markdown code fences', () => {
    const text = collect(new ArtifactEnvelopeTextFilter(), [
      '```xml\n',
      '<artifact>{"kind":"html"}</artifact>\n',
      '```\n',
      'done',
    ]);
    expect(text).toContain('<artifact>{"kind":"html"}</artifact>');
    expect(text).toContain('done');
  });

  it('does not let hidden artifact code fences affect later markdown parsing', () => {
    const text = collect(new ArtifactEnvelopeTextFilter(), [
      'before <artifact>```html\n',
      '<main>hidden</main>',
      '</artifact>\n',
      '```xml\n',
      '<artifact>{"kind":"example"}</artifact>\n',
      '```\nafter',
    ]);

    expect(text).toBe(
      'before \n```xml\n<artifact>{"kind":"example"}</artifact>\n```\nafter',
    );
  });

  it('drops unterminated artifact envelopes at stream end', () => {
    const text = collect(new ArtifactEnvelopeTextFilter(), [
      'visible <artifact>{"huge":"body"',
    ]);
    expect(text).toBe('visible ');
  });
});
