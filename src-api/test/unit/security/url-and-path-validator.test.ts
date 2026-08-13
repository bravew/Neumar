import { homedir } from 'os';
import { resolve } from 'path';

import { describe, expect, it, vi } from 'vitest';

import { validateBaseUrl } from '@/shared/utils/url-validator';

// checkPermission uses getAppDir() internally, so we mock it to a known path
vi.mock('@/config/constants', () => ({
  getAppDir: () => '/tmp/neuma-test-app-dir',
}));

// Import after mock setup so the module picks up the mock
const { validateWorkDir, checkPermission } =
  await import('@/shared/utils/path-validator');
type AllowedFolder = import('@/shared/utils/path-validator').AllowedFolder;

// ---------------------------------------------------------------------------
// 1. URL Validator — SSRF protection
// ---------------------------------------------------------------------------

describe('validateBaseUrl (SSRF protection)', () => {
  describe('allowed URLs', () => {
    it('allows HTTPS external URLs', () => {
      const result = validateBaseUrl('https://api.example.com');
      expect(result).toEqual({ valid: true });
    });

    it('allows http://localhost with port (e.g. Ollama)', () => {
      const result = validateBaseUrl('http://localhost:11434');
      expect(result).toEqual({ valid: true });
    });

    it('allows http://127.0.0.1 with port', () => {
      const result = validateBaseUrl('http://127.0.0.1:8080');
      expect(result).toEqual({ valid: true });
    });

    it.each(['http://localhost./', 'http://127.0.0.1./', 'http://127.0.0.5./'])(
      'allows trailing-dot loopback URL %s',
      (url) => {
        const result = validateBaseUrl(url);
        expect(result).toEqual({ valid: true });
      },
    );

    it('allows HTTPS URLs with paths', () => {
      const result = validateBaseUrl('https://api.openai.com/v1');
      expect(result).toEqual({ valid: true });
    });

    it('allows HTTPS public host with trailing dot', () => {
      const result = validateBaseUrl('https://api.example.com.');
      expect(result).toEqual({ valid: true });
    });
  });

  describe('blocked private IP ranges', () => {
    it('blocks 10.x.x.x (RFC 1918)', () => {
      const result = validateBaseUrl('http://10.0.0.1/api');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/private|internal/i);
    });

    it('blocks 172.16-31.x.x (RFC 1918)', () => {
      const result = validateBaseUrl('http://172.16.0.1/api');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/private|internal/i);
    });

    it('blocks 192.168.x.x (RFC 1918)', () => {
      const result = validateBaseUrl('http://192.168.1.1/api');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/private|internal/i);
    });

    it('blocks 169.254.x.x — AWS metadata / link-local', () => {
      const result = validateBaseUrl('http://169.254.169.254/latest');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/private|internal/i);
    });

    it('blocks 0.0.0.0', () => {
      const result = validateBaseUrl('http://0.0.0.0');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/private|internal/i);
    });

    it('blocks 100.64.x.x (CGN / shared address space)', () => {
      const result = validateBaseUrl('http://100.64.0.1');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/private|internal/i);
    });

    it.each([
      'http://169.254.169.254./',
      'http://192.168.1.5./',
      'http://10.0.0.5./',
      'http://0.0.0.0./',
      'http://100.64.0.5./',
      'http://172.16.0.1./',
      'http://224.0.0.1./',
    ])('blocks trailing-dot private/internal URL %s', (url) => {
      const result = validateBaseUrl(url);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/private|internal/i);
    });
  });

  describe('blocked IPv6 addresses', () => {
    it('blocks IPv6 loopback [::1]', () => {
      const result = validateBaseUrl('http://[::1]');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/private|internal/i);
    });

    it('blocks IPv6 link-local fe80::1', () => {
      const result = validateBaseUrl('http://[fe80::1]');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/private|internal/i);
    });

    it('blocks IPv4-mapped IPv6 ::ffff:10.0.0.1', () => {
      const result = validateBaseUrl('http://[::ffff:10.0.0.1]');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/private|internal/i);
    });
  });

  describe('blocked cloud metadata endpoints', () => {
    it('blocks metadata.google.internal', () => {
      const result = validateBaseUrl('http://metadata.google.internal');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/blocked hostname/i);
    });

    it('blocks trailing-dot metadata.google.internal', () => {
      const result = validateBaseUrl('http://metadata.google.internal.');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/blocked hostname/i);
    });

    it('blocks Azure IMDS (168.63.129.16)', () => {
      const result = validateBaseUrl('http://168.63.129.16');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/blocked hostname/i);
    });
  });

  describe('blocked protocols', () => {
    it('blocks ftp:// protocol', () => {
      const result = validateBaseUrl('ftp://files.example.com');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/unsupported protocol/i);
    });

    it('blocks file:// protocol', () => {
      const result = validateBaseUrl('file:///etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/unsupported protocol/i);
    });
  });

  describe('HTTPS enforcement', () => {
    it('blocks plain HTTP for non-localhost external URLs', () => {
      const result = validateBaseUrl('http://external.com');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/https required/i);
    });
  });

  describe('invalid input handling', () => {
    it('rejects completely invalid URL strings', () => {
      const result = validateBaseUrl('not-a-url');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/invalid url/i);
    });

    it('rejects empty string', () => {
      const result = validateBaseUrl('');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/invalid url/i);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Path Validator — workspace & permission checks
// ---------------------------------------------------------------------------

describe('validateWorkDir (workspace path validation)', () => {
  it('accepts a valid user workspace path', () => {
    // Use the project's own directory — guaranteed to exist and not be a blocked system path
    const testPath = resolve(__dirname, '..', '..', '..');
    const result = validateWorkDir(testPath);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(typeof result.resolved).toBe('string');
    }
  });

  it('rejects paths containing ".." traversal', () => {
    const result = validateWorkDir('/home/user/project/../../../etc/shadow');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/traversal/i);
    }
  });

  it('rejects paths with null bytes', () => {
    const result = validateWorkDir('/home/user/project\0/evil');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/null byte/i);
    }
  });

  it('rejects root "/" as workspace', () => {
    const result = validateWorkDir('/');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/system path/i);
    }
  });

  it('rejects /etc as workspace', () => {
    const result = validateWorkDir('/etc');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/system path/i);
    }
  });

  it('rejects /usr as workspace', () => {
    const result = validateWorkDir('/usr');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/system path/i);
    }
  });

  it('rejects the home directory itself (too broad)', () => {
    const result = validateWorkDir(homedir());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/home directory/i);
    }
  });

  it('rejects empty string', () => {
    const result = validateWorkDir('');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/empty/i);
    }
  });
});

describe('checkPermission (folder-level access control)', () => {
  const allowedFolders: AllowedFolder[] = [
    {
      path: '/tmp/test-workspace',
      permissions: { read: true, write: true, delete: false },
    },
    {
      path: '/tmp/read-only-workspace',
      permissions: { read: true, write: false, delete: false },
    },
  ];

  it('allows read within an allowed folder', () => {
    const result = checkPermission(
      '/tmp/test-workspace/src/index.ts',
      'read',
      allowedFolders,
    );
    expect(result.allowed).toBe(true);
  });

  it('allows write within an allowed folder with write permission', () => {
    const result = checkPermission(
      '/tmp/test-workspace/src/index.ts',
      'write',
      allowedFolders,
    );
    expect(result.allowed).toBe(true);
  });

  it('denies write in a read-only folder', () => {
    const result = checkPermission(
      '/tmp/read-only-workspace/data.json',
      'write',
      allowedFolders,
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/does not grant write/i);
    }
  });

  it('denies access to paths outside all allowed folders', () => {
    const result = checkPermission(
      '/home/user/secret/keys.pem',
      'read',
      allowedFolders,
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/not within any allowed folder/i);
    }
  });

  it('denies all operations when allowedFolders is empty', () => {
    const result = checkPermission('/tmp/test-workspace/file.txt', 'read', []);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/no folders/i);
    }
  });

  it('always denies delete operations (requires per-operation consent)', () => {
    const result = checkPermission(
      '/tmp/test-workspace/file.txt',
      'delete',
      allowedFolders,
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/delete.*consent/i);
    }
  });
});
