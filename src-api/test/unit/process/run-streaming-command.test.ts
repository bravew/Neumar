import { describe, expect, it } from 'vitest';

import {
  runStreamingCommand,
  StreamingCommandError,
} from '@/shared/process/run-streaming-command';

describe('runStreamingCommand', () => {
  it('captures output and streams complete lines', async () => {
    const lines: string[] = [];
    const result = await runStreamingCommand({
      bin: process.execPath,
      args: ['-e', "process.stdout.write('one\\ntwo\\n')"],
      cwd: process.cwd(),
      onLine: (line) => lines.push(line),
    });
    expect(result.stdout).toBe('one\ntwo\n');
    expect(lines).toEqual(['one', 'two']);
  });

  it('returns a typed failure for a non-zero process', async () => {
    await expect(
      runStreamingCommand({
        bin: process.execPath,
        args: ['-e', 'process.exit(7)'],
        cwd: process.cwd(),
      }),
    ).rejects.toMatchObject({
      name: 'StreamingCommandError',
      code: 'failed',
      exitCode: 7,
    } satisfies Partial<StreamingCommandError>);
  });
});
