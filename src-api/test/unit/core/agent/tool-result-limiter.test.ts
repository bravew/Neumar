import { describe, expect, it } from 'vitest';

import { limitForDisplay } from '@/core/agent/tool-result-limiter';

describe('tool-result-limiter', () => {
  it('passes through results under the limit', () => {
    const { result, truncated } = limitForDisplay('Bash', 'short output');
    expect(result).toBe('short output');
    expect(truncated).toBe(false);
  });

  it('passes through empty results', () => {
    const { result, truncated } = limitForDisplay('Bash', '');
    expect(result).toBe('');
    expect(truncated).toBe(false);
  });

  it('truncates Bash output at 50K', () => {
    const longOutput = 'x'.repeat(60_000);
    const { result, truncated } = limitForDisplay('Bash', longOutput);
    expect(truncated).toBe(true);
    expect(result.length).toBeLessThan(longOutput.length);
    expect(result).toContain('[Output truncated for display');
    // First 50K chars preserved
    expect(result.startsWith('x'.repeat(50_000))).toBe(true);
  });

  it('truncates Grep output at 30K', () => {
    const longOutput = 'y'.repeat(35_000);
    const { result, truncated } = limitForDisplay('Grep', longOutput);
    expect(truncated).toBe(true);
    expect(result.startsWith('y'.repeat(30_000))).toBe(true);
  });

  it('truncates Glob output at 20K', () => {
    const longOutput = 'z'.repeat(25_000);
    const { result, truncated } = limitForDisplay('Glob', longOutput);
    expect(truncated).toBe(true);
    expect(result.startsWith('z'.repeat(20_000))).toBe(true);
  });

  it('allows Read up to 100K', () => {
    const output = 'r'.repeat(90_000);
    const { result, truncated } = limitForDisplay('Read', output);
    expect(truncated).toBe(false);
    expect(result).toBe(output);
  });

  it('truncates Read over 100K', () => {
    const output = 'r'.repeat(110_000);
    const { result, truncated } = limitForDisplay('Read', output);
    expect(truncated).toBe(true);
    expect(result.startsWith('r'.repeat(100_000))).toBe(true);
  });

  it('uses default limit for unknown tools', () => {
    const longOutput = 'u'.repeat(60_000);
    const { result, truncated } = limitForDisplay('UnknownTool', longOutput);
    expect(truncated).toBe(true);
    // Default is 50K
    expect(result.startsWith('u'.repeat(50_000))).toBe(true);
  });

  it('does not truncate result exactly at the limit', () => {
    const exactOutput = 'e'.repeat(50_000);
    const { result, truncated } = limitForDisplay('Bash', exactOutput);
    expect(truncated).toBe(false);
    expect(result).toBe(exactOutput);
  });
});
