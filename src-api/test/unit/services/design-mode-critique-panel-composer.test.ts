import { describe, expect, it } from 'vitest';

import { composeCritiquePanelPrompt } from '@/shared/services/design-mode/critique/panel-composer';

describe('Critique panel composer', () => {
  it('builds a deterministic five-role panel prompt with annotations preserved', () => {
    const input = {
      artifactPath: 'artifacts/index.html',
      subject:
        '<main data-neuma-id="hero" data-neuma-source-path="artifacts/index.html"><h1>Launch</h1></main>',
    };

    const first = composeCritiquePanelPrompt(input);
    const second = composeCritiquePanelPrompt(input);

    expect(first.promptHash).toBe(second.promptHash);
    expect(first.system).toContain('designer');
    expect(first.system).toContain('critic');
    expect(first.system).toContain('brand');
    expect(first.system).toContain('accessibility');
    expect(first.system).toContain('copy');
    expect(first.system).toContain('data-neuma-id="hero"');
    expect(first.system).toContain('data-neuma-source-path');
    expect(first.system).toContain('score variance is <= 0.01');
  });

  it('changes the prompt hash when round configuration changes', () => {
    const base = composeCritiquePanelPrompt({
      artifactPath: 'artifacts/index.html',
      subject: '<main>Launch</main>',
    });
    const changed = composeCritiquePanelPrompt({
      artifactPath: 'artifacts/index.html',
      subject: '<main>Launch</main>',
      maxRounds: 5,
    });

    expect(changed.promptHash).not.toBe(base.promptHash);
    expect(changed.system).toContain('Rounds 2..5');
  });
});
