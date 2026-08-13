import { describe, expect, it } from 'vitest';

import { DenialTracker } from '@/core/agent/denial-tracker';

describe('DenialTracker', () => {
  it('starts with zero denials', () => {
    const tracker = new DenialTracker();
    expect(tracker.getDenialCount('Bash')).toBe(0);
    expect(tracker.shouldFallback('Bash')).toBe(false);
  });

  it('records denials and counts them', () => {
    const tracker = new DenialTracker();
    tracker.record('Bash', 'rm -rf /');
    tracker.record('Bash', 'rm -rf /');
    expect(tracker.getDenialCount('Bash')).toBe(2);
    expect(tracker.shouldFallback('Bash')).toBe(false);
  });

  it('triggers fallback after 3 denials (default threshold)', () => {
    const tracker = new DenialTracker();
    tracker.record('Bash', 'rm -rf /');
    tracker.record('Bash', 'rm -rf /');
    tracker.record('Bash', 'rm -rf /');
    expect(tracker.shouldFallback('Bash')).toBe(true);
  });

  it('tracks different tools independently', () => {
    const tracker = new DenialTracker();
    tracker.record('Bash', 'dangerous');
    tracker.record('Bash', 'dangerous');
    tracker.record('Bash', 'dangerous');
    tracker.record('Write', 'secret.txt');
    expect(tracker.shouldFallback('Bash')).toBe(true);
    expect(tracker.shouldFallback('Write')).toBe(false);
  });

  it('tracks different input patterns separately', () => {
    const tracker = new DenialTracker();
    tracker.record('Bash', 'cmd-a');
    tracker.record('Bash', 'cmd-b');
    tracker.record('Bash', 'cmd-c');
    // Each pattern has 1 denial, none exceeds threshold of 3
    expect(tracker.shouldFallback('Bash')).toBe(false);
    expect(tracker.getDenialCount('Bash')).toBe(3);
  });

  it('supports custom threshold', () => {
    const tracker = new DenialTracker(2);
    tracker.record('Bash', 'rm');
    tracker.record('Bash', 'rm');
    expect(tracker.shouldFallback('Bash')).toBe(true);
  });

  it('generates summary for denied tools', () => {
    const tracker = new DenialTracker();
    tracker.record('Bash', 'rm');
    tracker.record('Bash', 'rm');
    tracker.record('Bash', 'rm');
    const summary = tracker.getSummary();
    expect(summary).toContain('Bash');
    expect(summary).toContain('denied 3x');
    expect(summary).toContain('different approach');
  });

  it('returns empty summary when no tools exceed threshold', () => {
    const tracker = new DenialTracker();
    tracker.record('Bash', 'rm');
    expect(tracker.getSummary()).toBe('');
  });

  it('resets all denials', () => {
    const tracker = new DenialTracker();
    tracker.record('Bash', 'rm');
    tracker.record('Bash', 'rm');
    tracker.record('Bash', 'rm');
    tracker.reset();
    expect(tracker.getDenialCount('Bash')).toBe(0);
    expect(tracker.shouldFallback('Bash')).toBe(false);
  });

  it('truncates input summary to 100 chars', () => {
    const tracker = new DenialTracker();
    const longInput = 'a'.repeat(200);
    tracker.record('Bash', longInput);
    tracker.record('Bash', longInput);
    tracker.record('Bash', longInput);
    expect(tracker.shouldFallback('Bash')).toBe(true);
  });
});
