import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

import { resolveHyperframesCommand } from './hyperframes-command';

const execFileAsync = promisify(execFile);
const requireFromHere = createRequire(import.meta.url);
const CACHE_MS = 10_000;

export type DesignDependencyState = 'available' | 'missing' | 'not-configured';

export interface DesignDependencyStatus {
  id: string;
  label: string;
  kind: 'binary' | 'node-package' | 'renderer';
  state: DesignDependencyState;
  usedFor: string[];
  version?: string;
  reason?: string;
  installHint?: string;
}

let cached: {
  at: number;
  dependencies: DesignDependencyStatus[];
} | null = null;

export async function getDesignDependencies() {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.dependencies;
  const dependencies = await Promise.all([
    nodePackageDependency({
      id: 'sharp',
      label: 'sharp',
      packageNames: ['sharp'],
      usedFor: ['PNG/JPEG/WEBP image conversion'],
      installHint: 'Install the sharp package in the API workspace.',
    }),
    playwrightDependency(),
    binaryDependency({
      id: 'pandoc',
      label: 'Pandoc',
      binary: 'pandoc',
      args: ['--version'],
      usedFor: ['DOCX export', 'document PDF export'],
      installHint: 'Install pandoc and ensure it is on PATH.',
    }),
    {
      id: 'docx-renderer',
      label: 'DOCX renderer',
      kind: 'renderer',
      state: 'available',
      usedFor: ['DOCX export from Markdown/HTML text'],
      version: 'built-in-ooxml',
      reason: 'Built-in deterministic OOXML renderer is active.',
    } satisfies DesignDependencyStatus,
    {
      id: 'pptxgenjs',
      label: 'PPTX renderer',
      kind: 'renderer',
      state: 'available',
      usedFor: ['PPTX export from slides.json'],
      version: 'built-in-ooxml',
      reason: 'Built-in deterministic OOXML renderer is active.',
    } satisfies DesignDependencyStatus,
    binaryDependency({
      id: 'ffmpeg',
      label: 'ffmpeg',
      binary: 'ffmpeg',
      args: ['-version'],
      usedFor: ['MP3 export', 'MP4 composition export'],
      installHint: 'Install ffmpeg and ensure it is on PATH.',
    }),
    hyperframesDependency(),
  ]);
  cached = { at: now, dependencies };
  return dependencies;
}

async function binaryDependency({
  id,
  label,
  binary,
  args,
  usedFor,
  installHint,
}: {
  id: string;
  label: string;
  binary: string;
  args: string[];
  usedFor: string[];
  installHint: string;
}): Promise<DesignDependencyStatus> {
  try {
    const result = await execFileAsync(binary, args, {
      timeout: 1500,
      maxBuffer: 16 * 1024,
    });
    return {
      id,
      label,
      kind: 'binary',
      state: 'available',
      usedFor,
      version: firstVersionLine(result.stdout || result.stderr),
    };
  } catch (error) {
    return {
      id,
      label,
      kind: 'binary',
      state: 'missing',
      usedFor,
      reason: error instanceof Error ? error.message : String(error),
      installHint,
    };
  }
}

async function nodePackageDependency({
  id,
  label,
  packageNames,
  usedFor,
  installHint,
}: {
  id: string;
  label: string;
  packageNames: string[];
  usedFor: string[];
  installHint: string;
}): Promise<DesignDependencyStatus> {
  const resolved = resolveFirstPackage(packageNames);
  if (resolved) {
    return {
      id,
      label,
      kind: 'node-package',
      state: 'available',
      usedFor,
      version: resolved.version,
    };
  }
  return {
    id,
    label,
    kind: 'node-package',
    state: 'missing',
    usedFor,
    reason: `${packageNames.join(' or ')} is not installed`,
    installHint,
  };
}

async function playwrightDependency(): Promise<DesignDependencyStatus> {
  const resolved = resolveFirstPackage(['playwright', '@playwright/test']);
  if (!resolved) {
    return {
      id: 'playwright',
      label: 'Playwright renderer',
      kind: 'renderer',
      state: 'missing',
      usedFor: ['PDF export', 'HTML screenshot export'],
      reason: 'playwright or @playwright/test is not installed',
      installHint: 'Install Playwright and its Chromium browser.',
    };
  }
  try {
    const playwright = requireFromHere(resolved.packageName) as {
      chromium?: { executablePath: () => string };
    };
    const browserPath = playwright.chromium?.executablePath();
    if (browserPath && existsSync(browserPath)) {
      return {
        id: 'playwright',
        label: 'Playwright renderer',
        kind: 'renderer',
        state: 'available',
        usedFor: ['PDF export', 'HTML screenshot export'],
        version: resolved.version,
      };
    }
    return {
      id: 'playwright',
      label: 'Playwright renderer',
      kind: 'renderer',
      state: 'missing',
      usedFor: ['PDF export', 'HTML screenshot export'],
      version: resolved.version,
      reason: 'Playwright is installed but Chromium is not installed.',
      installHint: 'Run the project Playwright browser install command.',
    };
  } catch (error) {
    return {
      id: 'playwright',
      label: 'Playwright renderer',
      kind: 'renderer',
      state: 'missing',
      usedFor: ['PDF export', 'HTML screenshot export'],
      version: resolved.version,
      reason: error instanceof Error ? error.message : String(error),
      installHint: 'Install Playwright and its Chromium browser.',
    };
  }
}

async function hyperframesDependency(): Promise<DesignDependencyStatus> {
  const resolved = resolveFirstPackage(['hyperframes']);
  const command = resolveHyperframesCommand();
  const installHint =
    'Install HyperFrames and set NEUMA_HYPERFRAMES_BIN when the renderer command is not on PATH.';
  try {
    const result = await execFileAsync(command, ['--version'], {
      timeout: 1500,
      maxBuffer: 16 * 1024,
    });
    return {
      id: 'hyperframes',
      label: 'HyperFrames renderer',
      kind: 'renderer',
      state: 'available',
      usedFor: ['HTML video rendering'],
      version:
        firstVersionLine(result.stdout || result.stderr) ?? resolved?.version,
    };
  } catch (error) {
    if (resolved) {
      return {
        id: 'hyperframes',
        label: 'HyperFrames renderer',
        kind: 'renderer',
        state: 'not-configured',
        usedFor: ['HTML video rendering'],
        version: resolved.version,
        reason: `${command} is not executable: ${
          error instanceof Error ? error.message : String(error)
        }`,
        installHint,
      };
    }
    return {
      id: 'hyperframes',
      label: 'HyperFrames renderer',
      kind: 'renderer',
      state: 'missing',
      usedFor: ['HTML video rendering'],
      reason: `hyperframes package or ${command} command is not installed`,
      installHint,
    };
  }
}

function resolveFirstPackage(packageNames: string[]) {
  for (const packageName of packageNames) {
    try {
      const packageJsonPath = requireFromHere.resolve(
        `${packageName}/package.json`,
      );
      const packageJson = requireFromHere(packageJsonPath) as {
        version?: string;
      };
      return {
        packageName,
        version: packageJson.version,
      };
    } catch {
      // Try the next package alias.
    }
  }
  return null;
}

function firstVersionLine(output: string) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
}
