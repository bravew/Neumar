import { describe, expect, it } from 'vitest';

import {
  enqueueEditedCommand,
  flushEditedCommand,
} from '@/components/task/edited-command-queue';

describe('edited command queue', () => {
  it('holds the command while the run is active', () => {
    expect(enqueueEditedCommand(true, 'ls output')).toEqual({
      queued: 'ls output',
      deliver: null,
    });
  });

  it('delivers immediately when the run is idle', () => {
    expect(enqueueEditedCommand(false, 'ls output')).toEqual({
      queued: null,
      deliver: 'ls output',
    });
  });

  it('flushes the queued command once the run stops', () => {
    expect(flushEditedCommand(true, 'ls output')).toEqual({
      queued: 'ls output',
      deliver: null,
    });
    expect(flushEditedCommand(false, 'ls output')).toEqual({
      queued: null,
      deliver: 'ls output',
    });
  });
});
