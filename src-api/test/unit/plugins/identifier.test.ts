import { describe, expect, it } from 'vitest';

import {
  formatIdentifier,
  parsePluginIdentifier,
} from '@/shared/plugins/identifier';

describe('parsePluginIdentifier', () => {
  it('parses canonical plugin:skill', () => {
    expect(parsePluginIdentifier('demo:hello')).toEqual({
      plugin: 'demo',
      skill: 'hello',
    });
  });

  it('parses bare legacy skill names', () => {
    expect(parsePluginIdentifier('hello')).toEqual({
      plugin: null,
      skill: 'hello',
    });
  });

  it('parses the CLI plugin_<name>_<tool> shape', () => {
    expect(parsePluginIdentifier('plugin_demo_hello')).toEqual({
      plugin: 'demo',
      skill: 'hello',
    });
  });

  it('rejects empty input', () => {
    expect(parsePluginIdentifier('')).toBeNull();
    expect(parsePluginIdentifier('   ')).toBeNull();
  });

  it('rejects malformed plugin names', () => {
    expect(parsePluginIdentifier('Bad:hello')).toBeNull();
    expect(parsePluginIdentifier(':hello')).toBeNull();
  });

  it('round-trips through formatIdentifier', () => {
    const id = formatIdentifier('demo', 'hello');
    expect(id).toBe('demo:hello');
    expect(parsePluginIdentifier(id)).toEqual({
      plugin: 'demo',
      skill: 'hello',
    });
  });

  it('formats bare names without a colon', () => {
    expect(formatIdentifier(null, 'hello')).toBe('hello');
  });
});
