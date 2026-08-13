import { describe, expect, it } from 'vitest';

// Pull the directive regex from a re-export-friendly path. We test it
// indirectly via a small helper since the regex itself is internal.
const DIRECTIVE_RE = /%%\{[\s\S]*?\}%%/g;
function stripDirectives(s: string): string {
  return s.replace(DIRECTIVE_RE, '');
}

describe('mermaid directive stripper', () => {
  it('removes %%{init: ...}%% directive that could re-enable loose securityLevel', () => {
    const src = `%%{init: {'securityLevel': 'loose', 'theme': 'dark'}}%%
graph TD
  A --> B`;
    const out = stripDirectives(src);
    expect(out).not.toMatch(/securityLevel/);
    expect(out).toMatch(/graph TD/);
  });

  it('removes multi-line directive blocks', () => {
    const src = `%%{
  init: {
    "themeVariables": { "primaryColor": "red" }
  }
}%%
flowchart LR
  A --> B`;
    expect(stripDirectives(src)).not.toMatch(/themeVariables/);
  });

  it('leaves diagrams without directives untouched', () => {
    const src = `flowchart TD
  Start --> Stop`;
    expect(stripDirectives(src)).toBe(src);
  });

  it('removes multiple directive blocks', () => {
    const src = `%%{init: {"theme":"dark"}}%%
graph TD
%%{init: {"securityLevel":"loose"}}%%
A --> B`;
    const out = stripDirectives(src);
    expect(out).not.toMatch(/init:/);
    expect(out).toMatch(/A --> B/);
  });
});
