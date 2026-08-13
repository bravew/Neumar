import { describe, expect, it } from 'vitest';

import { LoopGuard } from '@/core/agent/loop-guard';

describe('LoopGuard', () => {
  it('allows distinct tool calls', () => {
    const guard = new LoopGuard();
    expect(guard.check('Read', 'a.ts')).toBeNull();
    expect(guard.check('Read', 'b.ts')).toBeNull();
    expect(guard.check('Bash', 'ls')).toBeNull();
    expect(guard.isTripped).toBe(false);
  });

  it('trips on identical-call thrashing at the repeat threshold', () => {
    const guard = new LoopGuard(4, 20);
    expect(guard.check('Skill', 'yt-dlp')).toBeNull(); // 1
    expect(guard.check('Skill', 'yt-dlp')).toBeNull(); // 2
    expect(guard.check('Skill', 'yt-dlp')).toBeNull(); // 3
    const stop = guard.check('Skill', 'yt-dlp'); // 4
    expect(stop).toMatch(/Loop detected/);
    expect(guard.isTripped).toBe(true);
  });

  it('trips on runaway sub-agent fan-out even with varied inputs', () => {
    const guard = new LoopGuard(4, 5);
    // Reworded prompts each time → never identical, but same spawning tool.
    expect(guard.check('Agent', 'download audio v1')).toBeNull();
    expect(guard.check('Agent', 'download audio v2')).toBeNull();
    expect(guard.check('Agent', 'run yt-dlp v3')).toBeNull();
    expect(guard.check('Agent', 'capture output v4')).toBeNull();
    const stop = guard.check('Agent', 'list dir v5'); // 5th spawn hits cap
    expect(stop).toMatch(/sub-agents|Loop detected/);
    expect(guard.isTripped).toBe(true);
  });

  it('stays tripped and denies every subsequent call once tripped', () => {
    const guard = new LoopGuard(2, 20);
    expect(guard.check('Agent', 'x')).toBeNull();
    expect(guard.check('Agent', 'x')).toMatch(/Loop detected/);
    // A different, otherwise-allowed tool is now also denied.
    expect(guard.check('Read', 'unrelated.ts')).toMatch(/Loop detected/);
  });

  it('does not trip non-spawn tools on volume alone', () => {
    const guard = new LoopGuard(4, 5);
    // 10 distinct Read calls — legitimate, must not trip.
    for (let i = 0; i < 10; i++) {
      expect(guard.check('Read', `file-${i}.ts`)).toBeNull();
    }
    expect(guard.isTripped).toBe(false);
  });

  it('reset clears state', () => {
    const guard = new LoopGuard(2, 20);
    guard.check('Agent', 'x');
    guard.check('Agent', 'x');
    expect(guard.isTripped).toBe(true);
    guard.reset();
    expect(guard.isTripped).toBe(false);
    expect(guard.check('Agent', 'x')).toBeNull();
  });
});
