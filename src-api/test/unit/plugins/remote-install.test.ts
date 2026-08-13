import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginInstallError } from '@/shared/plugins/install';
import {
  extractZipToTemp,
  fetchCatalogPlugin,
  fetchUrlPlugin,
  parseGithubRef,
} from '@/shared/plugins/remote-install';

const safeFetchMock = vi.fn();
vi.mock('@/shared/network-policy/fetch', async () => {
  const actual = await vi.importActual<
    typeof import('@/shared/network-policy/fetch')
  >('@/shared/network-policy/fetch');
  return {
    ...actual,
    safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  };
});

async function zipBuffer(
  build: (zip: JSZip) => void | Promise<void>,
): Promise<Buffer> {
  const zip = new JSZip();
  await build(zip);
  // platform UNIX so unixPermissions (symlink mode bits) survive the round trip
  return zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' });
}

describe('parseGithubRef', () => {
  it('parses owner/repo with defaults', () => {
    expect(parseGithubRef('acme/widgets')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      ref: 'HEAD',
      subdir: undefined,
    });
  });

  it('parses github: prefix, ref, and subdir', () => {
    expect(parseGithubRef('github:acme/widgets@v1.2.0#plugins/foo')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      ref: 'v1.2.0',
      subdir: 'plugins/foo',
    });
  });

  it('strips .git suffixes', () => {
    expect(parseGithubRef('acme/widgets.git@main').repo).toBe('widgets');
  });

  it('rejects malformed refs and traversal subdirs', () => {
    expect(() => parseGithubRef('not-a-ref')).toThrow(PluginInstallError);
    expect(() => parseGithubRef('a/b@main#../../etc')).toThrow(
      PluginInstallError,
    );
  });
});

describe('extractZipToTemp', () => {
  it('extracts files and strips a single top-level folder (zipball layout)', async () => {
    const buffer = await zipBuffer((zip) => {
      zip.file('repo-main/.claude-plugin/plugin.json', '{"name":"x"}');
      zip.file('repo-main/skills/foo/SKILL.md', '# skill');
    });
    const { dir, cleanup } = await extractZipToTemp(buffer);
    try {
      const manifest = await readFile(
        join(dir, '.claude-plugin/plugin.json'),
        'utf-8',
      );
      expect(manifest).toBe('{"name":"x"}');
      expect(await readdir(join(dir, 'skills'))).toEqual(['foo']);
    } finally {
      await cleanup();
    }
  });

  it('narrows extraction to a subdir', async () => {
    const buffer = await zipBuffer((zip) => {
      zip.file('repo-main/plugins/foo/.claude-plugin/plugin.json', '{}');
      zip.file('repo-main/plugins/bar/.claude-plugin/plugin.json', '{}');
      zip.file('repo-main/README.md', 'root');
    });
    const { dir, cleanup } = await extractZipToTemp(buffer, 'plugins/foo');
    try {
      expect(await readdir(dir)).toEqual(['.claude-plugin']);
    } finally {
      await cleanup();
    }
  });

  it('rejects traversal and absolute entry paths', async () => {
    const traversal = await zipBuffer((zip) => {
      zip.file('ok.txt', 'fine');
      zip.file('../evil.txt', 'nope');
    });
    await expect(extractZipToTemp(traversal)).rejects.toThrow(/unsafe path/);

    const absolute = await zipBuffer((zip) => {
      zip.file('/etc/evil.txt', 'nope');
    });
    await expect(extractZipToTemp(absolute)).rejects.toThrow(/unsafe path/);
  });

  it('rejects symlink entries', async () => {
    const buffer = await zipBuffer((zip) => {
      zip.file('link', '/etc/passwd', { unixPermissions: 0o120755 });
      zip.file('real.txt', 'data');
    });
    await expect(extractZipToTemp(buffer)).rejects.toThrow(/symlink/);
  });

  it('rejects non-zip payloads and empty archives', async () => {
    await expect(
      extractZipToTemp(Buffer.from('not a zip at all')),
    ).rejects.toThrow(/not a zip/);
    const empty = await zipBuffer(() => {});
    await expect(extractZipToTemp(empty)).rejects.toThrow(/no files/);
  });

  it('errors when the requested subdir has no files', async () => {
    const buffer = await zipBuffer((zip) => {
      zip.file('repo-main/README.md', 'root');
    });
    // The extractor cleans up its own temp dir on this failure path.
    await expect(extractZipToTemp(buffer, 'plugins/none')).rejects.toThrow(
      /no files under/,
    );
  });
});

describe('fetchUrlPlugin SSRF policy', () => {
  it('rejects private and metadata URLs without any network call', async () => {
    for (const url of [
      'https://10.1.2.3/plugin.zip',
      'https://169.254.169.254/plugin.zip',
      'https://192.168.0.5/plugin.zip',
      'ftp://example.com/plugin.zip',
    ]) {
      await expect(fetchUrlPlugin(url)).rejects.toThrow(PluginInstallError);
    }
  });
});

describe('fetchCatalogPlugin source resolution', () => {
  const RAW_MARKETPLACE_URL =
    'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json';

  beforeEach(() => {
    safeFetchMock.mockReset();
  });

  function mockZipballOnce(buffer: Buffer) {
    safeFetchMock.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/zip' },
      body: buffer,
      finalUrl: 'https://codeload.github.com/x/y/zip/HEAD',
      redirectChain: [],
    });
  }

  async function repoZip(prefix: string) {
    return zipBuffer((zip) => {
      zip.file(`${prefix}/plugins/foo/.claude-plugin/plugin.json`, '{}');
      zip.file(`${prefix}/plugins/foo/SKILL.md`, '# foo');
      zip.file(`${prefix}/README.md`, 'root');
    });
  }

  it('resolves a git-subdir object to a github zipball + subdir, from codeload', async () => {
    mockZipballOnce(await repoZip('skills-main'));
    const result = await fetchCatalogPlugin(
      {
        source: 'git-subdir',
        url: 'https://github.com/adobe/skills.git',
        path: 'plugins/foo',
        ref: 'main',
      },
      RAW_MARKETPLACE_URL,
    );
    try {
      expect(result.installKind).toBe('github');
      expect(safeFetchMock.mock.calls[0]?.[0]).toBe(
        'https://codeload.github.com/adobe/skills/zip/main',
      );
      expect(await readdir(result.dir)).toEqual(['.claude-plugin', 'SKILL.md']);
    } finally {
      await result.cleanup();
    }
  });

  it('resolves a relative source against the catalog repository', async () => {
    mockZipballOnce(await repoZip('claude-plugins-official-main'));
    const result = await fetchCatalogPlugin(
      './plugins/foo',
      RAW_MARKETPLACE_URL,
    );
    try {
      expect(result.installKind).toBe('github');
      expect(safeFetchMock.mock.calls[0]?.[0]).toBe(
        'https://codeload.github.com/anthropics/claude-plugins-official/zip/main',
      );
      expect(await readdir(result.dir)).toEqual(['.claude-plugin', 'SKILL.md']);
    } finally {
      await result.cleanup();
    }
  });

  it('prefers sha over ref for a github object source', async () => {
    mockZipballOnce(await repoZip('repo-abc123'));
    const result = await fetchCatalogPlugin(
      { source: 'github', repo: 'owner/repo', ref: 'main', sha: 'abc123' },
      RAW_MARKETPLACE_URL,
    );
    try {
      expect(safeFetchMock.mock.calls[0]?.[0]).toBe(
        'https://codeload.github.com/owner/repo/zip/abc123',
      );
    } finally {
      await result.cleanup();
    }
  });

  it('rejects non-github git repos and unsupported source kinds', async () => {
    await expect(
      fetchCatalogPlugin(
        { source: 'url', url: 'https://gitlab.com/team/repo.git' },
        RAW_MARKETPLACE_URL,
      ),
    ).rejects.toThrow(/unsupported source host|github/);

    await expect(
      fetchCatalogPlugin(
        { source: 'npm', url: 'https://npm.example.com/pkg' },
        RAW_MARKETPLACE_URL,
      ),
    ).rejects.toThrow(/unsupported catalog source/);

    await expect(
      fetchCatalogPlugin('./plugins/foo', 'https://example.com/catalog.json'),
    ).rejects.toThrow(/cannot be resolved/);
  });
});
