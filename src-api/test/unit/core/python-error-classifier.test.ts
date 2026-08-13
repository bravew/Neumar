import { describe, expect, it } from 'vitest';

import {
  classifyPythonError,
  pythonErrorHintHook,
} from '@/core/agent/safety/python-error-classifier';

const TRACEBACK_PREFIX = `Traceback (most recent call last):
  File "/tmp/script.py", line 12, in <module>
`;

describe('classifyPythonError', () => {
  it('returns null for empty / non-error output', () => {
    expect(classifyPythonError('')).toBeNull();
    expect(classifyPythonError('Hello world\nDone.')).toBeNull();
  });

  it('classifies SSL certificate errors', () => {
    const stderr = `${TRACEBACK_PREFIX}ssl.SSLCertVerificationError: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed`;
    const c = classifyPythonError(stderr);
    expect(c?.category).toBe('ssl');
    expect(c?.exception).toBe('SSLCertVerificationError');
    expect(c?.hint).toMatch(/certifi/);
  });

  it('classifies HTTPError with status code', () => {
    const stderr = `${TRACEBACK_PREFIX}urllib.error.HTTPError: HTTP Error 404: Not Found`;
    const c = classifyPythonError(stderr);
    expect(c?.category).toBe('http');
    expect(c?.detail).toBe('HTTP 404');
  });

  it('classifies network errors (URLError, getaddrinfo, ConnectionRefused)', () => {
    expect(
      classifyPythonError(
        `${TRACEBACK_PREFIX}urllib.error.URLError: <urlopen error [Errno 8] nodename nor servname provided>`,
      )?.category,
    ).toBe('network');
    expect(
      classifyPythonError(
        `${TRACEBACK_PREFIX}ConnectionRefusedError: [Errno 61] Connection refused`,
      )?.category,
    ).toBe('network');
  });

  it('classifies missing module + extracts module name', () => {
    const c = classifyPythonError(
      `${TRACEBACK_PREFIX}ModuleNotFoundError: No module named 'requests'`,
    );
    expect(c?.category).toBe('module');
    expect(c?.detail).toBe('requests');
    expect(c?.hint).toContain('requests');
  });

  it('classifies file-not-found + extracts path', () => {
    const c = classifyPythonError(
      `${TRACEBACK_PREFIX}FileNotFoundError: [Errno 2] No such file or directory: '/tmp/missing.json'`,
    );
    expect(c?.category).toBe('file');
    expect(c?.detail).toBe('/tmp/missing.json');
  });

  it('classifies permission errors', () => {
    const c = classifyPythonError(
      `${TRACEBACK_PREFIX}PermissionError: [Errno 13] Permission denied: '/etc/hosts'`,
    );
    expect(c?.category).toBe('permission');
    expect(c?.detail).toBe('/etc/hosts');
  });

  it('classifies syntax errors', () => {
    const c = classifyPythonError(`SyntaxError: invalid syntax`);
    expect(c?.category).toBe('syntax');
  });

  it('returns unknown=null for tracebacks we do not recognize', () => {
    const c = classifyPythonError(
      `${TRACEBACK_PREFIX}weird.CustomThing: something nobody anticipated`,
    );
    expect(c).toBeNull();
  });

  it('only scans the tail (8 KiB) — head noise is ignored, tail is matched', () => {
    const head = 'A'.repeat(20_000);
    const stderr = `${head}\n${TRACEBACK_PREFIX}ModuleNotFoundError: No module named 'numpy'`;
    expect(classifyPythonError(stderr)?.detail).toBe('numpy');
  });
});

describe('pythonErrorHintHook', () => {
  async function run(toolResult: unknown) {
    return pythonErrorHintHook.handler({
      toolName: 'Bash',
      toolInput: {},
      toolResult,
      sessionId: 't1',
    });
  }

  it('matches against Bash only and post_tool_use', () => {
    expect(pythonErrorHintHook.matcher).toBe('Bash');
    expect(pythonErrorHintHook.event).toBe('post_tool_use');
  });

  it('returns allow with no message on success', async () => {
    const out = await run({ exit_code: 0, stdout: 'ok', stderr: '' });
    expect(out.action).toBe('allow');
    expect(out.systemMessage).toBeUndefined();
  });

  it('returns allow with no message on failure without recognized error', async () => {
    const out = await run({
      exit_code: 1,
      stderr: 'random shell failure',
    });
    expect(out.systemMessage).toBeUndefined();
  });

  it('attaches a systemMessage on recognized python error', async () => {
    const out = await run({
      is_error: true,
      stderr: `${TRACEBACK_PREFIX}ModuleNotFoundError: No module named 'pandas'`,
    });
    expect(out.systemMessage).toMatch(/python-error-hint/);
    expect(out.systemMessage).toMatch(/pandas/);
  });

  it('handles missing toolResult gracefully', async () => {
    expect((await run(undefined)).action).toBe('allow');
    expect((await run('not an object')).action).toBe('allow');
  });

  it('reads exit_code OR is_error to detect failure', async () => {
    const m1 = await run({
      exit_code: 1,
      stderr: `${TRACEBACK_PREFIX}ModuleNotFoundError: No module named 'x'`,
    });
    const m2 = await run({
      is_error: true,
      stderr: `${TRACEBACK_PREFIX}ModuleNotFoundError: No module named 'x'`,
    });
    expect(m1.systemMessage).toBeDefined();
    expect(m2.systemMessage).toBeDefined();
  });
});
