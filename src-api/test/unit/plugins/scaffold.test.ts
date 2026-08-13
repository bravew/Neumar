import fs from 'fs/promises';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseManifest } from '@/shared/plugins/manifest';
import { compileTmpl, createPlugin } from '@/shared/plugins/scaffold';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'neuma-scaffold-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('compileTmpl', () => {
  it('substitutes {{TOKEN}} placeholders', async () => {
    const tmpl = join(workDir, 't.tmpl');
    await fs.writeFile(tmpl, 'hello {{NAME}}, today is {{TODAY}}', 'utf-8');
    const out = await compileTmpl(tmpl, { NAME: 'world', TODAY: '2026-04-23' });
    expect(out).toBe('hello world, today is 2026-04-23');
  });

  it('leaves missing tokens intact and warns', async () => {
    const tmpl = join(workDir, 't.tmpl');
    await fs.writeFile(tmpl, 'hi {{KNOWN}} and {{UNKNOWN}}', 'utf-8');
    const out = await compileTmpl(tmpl, { KNOWN: 'hello' });
    expect(out).toBe('hi hello and {{UNKNOWN}}');
  });

  it('handles a template with no tokens', async () => {
    const tmpl = join(workDir, 't.tmpl');
    await fs.writeFile(tmpl, 'no tokens here', 'utf-8');
    const out = await compileTmpl(tmpl, { ANY: 'value' });
    expect(out).toBe('no tokens here');
  });
});

describe('createPlugin', () => {
  it('writes a manifest that parseManifest accepts (basic template)', async () => {
    const result = await createPlugin({
      name: 'demo-plugin',
      dir: workDir,
      template: 'basic',
    });

    const raw = await fs.readFile(result.manifestPath, 'utf-8');
    const parsed = parseManifest(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.manifest?.name).toBe('demo-plugin');
    expect(parsed.manifest?.version).toBe('0.1.0');

    // SKILL.md exists with substituted name
    const skill = await fs.readFile(
      join(result.pluginDir, 'skills', 'demo-plugin', 'SKILL.md'),
      'utf-8',
    );
    expect(skill).toContain('name: demo-plugin');
    expect(skill).not.toContain('{{NAME}}');
  });

  it('writes an executable run.sh for the with-script template', async () => {
    const result = await createPlugin({
      name: 'scripted',
      dir: workDir,
      template: 'with-script',
    });
    const scriptPath = join(
      result.pluginDir,
      'skills',
      'scripted',
      'scripts',
      'run.sh',
    );
    const stat = await fs.stat(scriptPath);
    // owner-executable bit set
    expect(stat.mode & 0o100).toBe(0o100);
    const body = await fs.readFile(scriptPath, 'utf-8');
    expect(body).toContain('Hello from scripted');
  });

  it('writes a .mcp.json stub for the with-mcp template', async () => {
    const result = await createPlugin({
      name: 'mcp-demo',
      dir: workDir,
      template: 'with-mcp',
    });
    const mcpPath = join(result.pluginDir, '.mcp.json');
    const raw = await fs.readFile(mcpPath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.mcpServers['mcp-demo']).toBeDefined();
    // manifest should reference the .mcp.json
    const manifestRaw = await fs.readFile(result.manifestPath, 'utf-8');
    const manifest = parseManifest(manifestRaw);
    expect(manifest.ok).toBe(true);
    expect(manifest.manifest?.mcp).toBe('.mcp.json');
  });

  it('refuses to overwrite an existing plugin dir', async () => {
    await createPlugin({ name: 'twin', dir: workDir });
    await expect(createPlugin({ name: 'twin', dir: workDir })).rejects.toThrow(
      /Refusing to overwrite/,
    );
  });

  it('passes custom vars through to templates', async () => {
    const result = await createPlugin({
      name: 'with-vars',
      dir: workDir,
      template: 'basic',
      description: 'A custom description',
      vars: { HOST_VERSION: '99.99.99' },
    });
    const skill = await fs.readFile(
      join(result.pluginDir, 'skills', 'with-vars', 'SKILL.md'),
      'utf-8',
    );
    expect(skill).toContain('A custom description');
    expect(skill).toContain('99.99.99');
  });
});
