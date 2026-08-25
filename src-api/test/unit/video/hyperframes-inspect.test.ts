import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StreamingCommandError } from '@/shared/process/run-streaming-command';
import {
  checkHyperframesComposition,
  compareHyperframesGrades,
  compareHyperframesVariants,
  HyperframesInspectError,
  parseTrailingJson,
  summarizeHyperframesCheck,
} from '@/shared/video/hyperframes-inspect';

const VERSION_STDOUT = '0.8.7\n';
const DOCTOR_STDOUT = JSON.stringify({
  checks: [{ name: 'Chrome', ok: true, detail: '140.0.0' }],
  _meta: { version: '0.8.7' },
});

interface Recorded {
  args: string[];
  cwd: string;
}

function runner(
  responses: (input: Recorded) => { stdout: string } | Error,
  recorded: Recorded[] = [],
) {
  return async (input: { bin: string; args: string[]; cwd: string }) => {
    const entry = { args: input.args, cwd: input.cwd };
    recorded.push(entry);
    if (input.args[0] === '--version')
      return { stdout: VERSION_STDOUT, stderr: '' };
    if (input.args[0] === 'doctor')
      return { stdout: DOCTOR_STDOUT, stderr: '' };
    const result = responses(entry);
    if (result instanceof Error) throw result;
    return { stdout: result.stdout, stderr: '' };
  };
}

describe('parseTrailingJson', () => {
  it('takes the JSON object that follows the CLI preamble lines', () => {
    const stdout = [
      '[StaticGuard] Invalid HyperFrame contract: missing id',
      '[hyperframes] browserGpuMode probe → hardware',
      '{"ok":true,"sheet":"cmp.png"}',
    ].join('\n');
    expect(parseTrailingJson(stdout)).toEqual({ ok: true, sheet: 'cmp.png' });
  });

  it('ignores a brace inside a preamble string', () => {
    const stdout = 'note: use {curly} braces\n{"ok":false,"error":"nope"}';
    expect(parseTrailingJson(stdout)).toEqual({ ok: false, error: 'nope' });
  });

  it('throws a typed error when there is no JSON at all', () => {
    expect(() => parseTrailingJson('nothing here')).toThrow(
      HyperframesInspectError,
    );
  });

  it('takes the last top-level object, not the first, when the CLI logs a valid JSON object before the result', () => {
    const stdout = [
      '{"ok":true,"note":"preamble diagnostics, not the result"}',
      '{"ok":false,"sheet":"cmp.png"}',
    ].join('\n');
    expect(parseTrailingJson(stdout)).toEqual({
      ok: false,
      sheet: 'cmp.png',
    });
  });

  it('does not mistake a nested field for a separate top-level object', () => {
    const stdout =
      'noise\n{"ok":true,"nested":{"ok":false,"other":"x"},"sheet":"cmp.png"}';
    expect(parseTrailingJson(stdout)).toEqual({
      ok: true,
      nested: { ok: false, other: 'x' },
      sheet: 'cmp.png',
    });
  });
});

describe('compareHyperframesVariants', () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hf-compare-'));
  });
  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('passes labels, --at, and an absolute --out', async () => {
    const recorded: Recorded[] = [];
    const result = await compareHyperframesVariants(
      {
        variants: [
          { label: 'A', compositionPath: path.join(workDir, 'a') },
          { label: 'B', compositionPath: path.join(workDir, 'b') },
        ],
        atSec: 2.5,
        outputPath: path.join(workDir, 'out', 'cmp.png'),
        cwd: workDir,
      },
      {
        command: 'hyperframes',
        runCommand: runner(
          () => ({ stdout: '{"ok":true,"sheet":"cmp.png","rendered":2}' }),
          recorded,
        ),
      },
    );
    expect(result.rendered).toBe(2);
    const call = recorded.at(-1)!;
    expect(call.args[0]).toBe('compare');
    expect(call.args).toContain('--labels');
    expect(call.args[call.args.indexOf('--labels') + 1]).toBe('A,B');
    expect(call.args[call.args.indexOf('--at') + 1]).toBe('2.5');
    expect(path.isAbsolute(call.args[call.args.indexOf('--out') + 1]!)).toBe(
      true,
    );
  });

  it('refuses a single variant before spawning anything', async () => {
    await expect(
      compareHyperframesVariants(
        {
          variants: [{ label: 'A', compositionPath: workDir }],
          outputPath: path.join(workDir, 'cmp.png'),
          cwd: workDir,
        },
        {
          command: 'hyperframes',
          runCommand: runner(() => ({ stdout: '{}' })),
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('surfaces the CLI ok:false payload as a typed failure', async () => {
    await expect(
      compareHyperframesVariants(
        {
          variants: [
            { label: 'A', compositionPath: path.join(workDir, 'a') },
            { label: 'B', compositionPath: path.join(workDir, 'b') },
          ],
          outputPath: path.join(workDir, 'cmp.png'),
          cwd: workDir,
        },
        {
          command: 'hyperframes',
          runCommand: runner(() => ({
            stdout: '{"ok":false,"error":"variant render failed"}',
          })),
        },
      ),
    ).rejects.toMatchObject({
      code: 'command-failed',
      message: 'variant render failed',
    });
  });
});

describe('compareHyperframesGrades', () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hf-grade-'));
  });
  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('writes grades to a file (the CLI takes a path, not inline JSON) and cleans it up', async () => {
    const recorded: Recorded[] = [];
    let gradesFileContents: string | undefined;
    await compareHyperframesGrades(
      {
        referencePath: path.join(workDir, 'ref.png'),
        grades: [{ label: 'warm', grading: { adjust: { temperature: 15 } } }],
        outputPath: path.join(workDir, 'grade.png'),
        projectDir: workDir,
        cwd: workDir,
      },
      {
        command: 'hyperframes',
        runCommand: async (input) => {
          recorded.push({ args: input.args, cwd: input.cwd });
          if (input.args[0] === '--version') {
            return { stdout: VERSION_STDOUT, stderr: '' };
          }
          if (input.args[0] === 'doctor') {
            return { stdout: DOCTOR_STDOUT, stderr: '' };
          }
          const gradesPath = input.args[input.args.indexOf('--grades') + 1]!;
          gradesFileContents = await fs.readFile(gradesPath, 'utf8');
          return {
            stdout: '{"ok":true,"sheet":"grade.png","cells":2}',
            stderr: '',
          };
        },
      },
    );
    expect(JSON.parse(gradesFileContents!)).toEqual([
      { label: 'warm', grading: { adjust: { temperature: 15 } } },
    ]);
    const gradesPath =
      recorded.at(-1)!.args[recorded.at(-1)!.args.indexOf('--grades') + 1]!;
    await expect(fs.stat(gradesPath)).rejects.toThrow();
  });

  it('needs at least one candidate', async () => {
    await expect(
      compareHyperframesGrades(
        {
          referencePath: path.join(workDir, 'ref.png'),
          outputPath: path.join(workDir, 'grade.png'),
          projectDir: workDir,
          cwd: workDir,
        },
        {
          command: 'hyperframes',
          runCommand: runner(() => ({ stdout: '{}' })),
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });
});

describe('checkHyperframesComposition', () => {
  const cleanReport = {
    ok: true,
    lint: {
      ok: true,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      findings: [],
    },
    runtime: {
      ok: true,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      findings: [],
    },
    layout: {
      ok: true,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      findings: [],
    },
    motion: {
      ok: true,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      findings: [],
      enabled: false,
    },
    contrast: {
      ok: false,
      errorCount: 1,
      warningCount: 2,
      infoCount: 0,
      findings: [
        { code: 'contrast_low', severity: 'error', message: 'AA failure' },
      ],
      enabled: true,
    },
  };

  it('reads the report off a non-zero exit — findings are a result, not a failure', async () => {
    const report = await checkHyperframesComposition(
      { compositionDir: '/tmp/comp', cwd: '/tmp' },
      {
        command: 'hyperframes',
        runCommand: async (input) => {
          if (input.args[0] === '--version') {
            return { stdout: VERSION_STDOUT, stderr: '' };
          }
          if (input.args[0] === 'doctor') {
            return { stdout: DOCTOR_STDOUT, stderr: '' };
          }
          throw new StreamingCommandError(
            'failed',
            'hyperframes exited with code 1',
            1,
            `[StaticGuard] noise\n${JSON.stringify({ ...cleanReport, ok: false })}`,
            '',
          );
        },
      },
    );
    expect(report.ok).toBe(false);
    expect(report.contrast?.errorCount).toBe(1);
  });

  it('summarizes every enabled pass', () => {
    const summary = summarizeHyperframesCheck(cleanReport);
    expect(summary.errorCount).toBe(1);
    expect(summary.warningCount).toBe(2);
    expect(summary.passes.map((pass) => pass.key)).toEqual([
      'lint',
      'runtime',
      'layout',
      'motion',
      'contrast',
    ]);
    expect(summary.passes.find((pass) => pass.key === 'motion')?.enabled).toBe(
      false,
    );
  });

  it('escalates the typed availability reason before running', async () => {
    await expect(
      checkHyperframesComposition(
        { compositionDir: '/tmp/comp', cwd: '/tmp' },
        {
          command: 'hyperframes',
          runCommand: async () => {
            throw new StreamingCommandError('not-found', 'ENOENT');
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});
