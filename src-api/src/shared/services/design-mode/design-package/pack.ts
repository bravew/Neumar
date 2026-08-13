import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import JSZip from 'jszip';

import { renderAssetAttributionBlock } from '@/shared/assets';

import { getProjectDir, resolveProjectPath } from '../fs';
import { getDesignProject } from '../projects';

export interface DesignPackageOptions {
  include?: {
    transcript?: boolean;
    assets?: boolean;
    providerKeys?: boolean;
  };
}

export interface DesignPackageResult {
  path: string;
  sha256: string;
  sizeBytes: number;
  manifest: DesignPackageManifest;
}

export interface DesignPackageManifest {
  version: 1;
  schemaVersion: 2;
  createdAt: string;
  generator: 'neuma-design-mode';
  projectId: string;
  title: string;
  project: {
    id: string;
    title: string;
    surface: string;
    intent: string;
    platforms: Array<{
      id: string;
      label: string;
      entryFile: string;
      viewport: { width: number; height: number };
    }>;
  };
  responsive: {
    breakpoints: Array<{ id: string; width: number; height: number }>;
    entryFiles: Array<{ breakpointId: string; file: string }>;
  };
  handoff: { notes: string };
  files: Array<{
    path: string;
    sha256: string;
    bytes: number;
    byteLength: number;
    mediaType: string;
  }>;
  checksums: { manifestSha256: string };
}

export async function packDesignPackage(
  projectId: string,
  options: DesignPackageOptions = {},
): Promise<DesignPackageResult> {
  if (options.include?.providerKeys) {
    throw new Error('Design packages cannot include provider keys.');
  }

  const project = await getDesignProject(projectId);
  const zip = new JSZip();
  const root = getProjectDir(projectId);
  const files = await collectPackageFiles(root, {
    includeAssets: options.include?.assets !== false,
    includeTranscript: options.include?.transcript !== false,
  });
  const manifestFiles: DesignPackageManifest['files'] = [];

  for (const file of files) {
    const data = await fs.readFile(path.join(root, file));
    const packagePath = packagePathFor(file);
    zip.file(packagePath, data);
    manifestFiles.push({
      path: packagePath,
      sha256: sha256(data),
      bytes: data.byteLength,
      byteLength: data.byteLength,
      mediaType: mimeForPath(packagePath),
    });
  }
  const attribution = renderAssetAttributionBlock({
    scope: 'design_project',
    scopeId: projectId,
    format: 'text',
  });
  if (attribution) {
    const data = Buffer.from(`${attribution}\n`);
    zip.file('attribution.txt', data);
    manifestFiles.push({
      path: 'attribution.txt',
      sha256: sha256(data),
      bytes: data.byteLength,
      byteLength: data.byteLength,
      mediaType: 'text/plain',
    });
  }

  const responsive = buildResponsiveHandoff(
    manifestFiles.map((file) => file.path),
  );
  const manifestBase = {
    version: 1 as const,
    schemaVersion: 2 as const,
    createdAt: new Date().toISOString(),
    generator: 'neuma-design-mode' as const,
    projectId,
    title: project.title,
    project: {
      id: project.id,
      title: project.title,
      surface: project.surface,
      intent: project.intent ?? 'other',
      platforms: responsive.platforms,
    },
    responsive: {
      breakpoints: RESPONSIVE_BREAKPOINTS.map((breakpoint) => ({
        id: breakpoint.id,
        width: breakpoint.width,
        height: breakpoint.height,
      })),
      entryFiles: responsive.entryFiles,
    },
    handoff: {
      notes:
        typeof project.brief.handoffNotes === 'string'
          ? project.brief.handoffNotes
          : '',
    },
    files: manifestFiles.sort((a, b) => a.path.localeCompare(b.path)),
  };
  const manifestSha256 = sha256(JSON.stringify(manifestBase));
  const manifest: DesignPackageManifest = {
    ...manifestBase,
    checksums: { manifestSha256 },
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  zip.file('DESIGN-MANIFEST.json', manifestJson);
  zip.file('manifest.json', manifestJson);

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
  const exportId = `designpkg_${randomUUID()}`;
  const dest = resolveProjectPath(projectId, `exports/${exportId}.designpkg`);
  await fs.mkdir(path.dirname(dest.absolutePath), { recursive: true });
  await fs.writeFile(dest.absolutePath, buffer);
  return {
    path: dest.relativePath,
    sha256: sha256(buffer),
    sizeBytes: buffer.byteLength,
    manifest,
  };
}

async function collectPackageFiles(
  root: string,
  options: { includeAssets: boolean; includeTranscript: boolean },
) {
  const out: string[] = [];
  async function visit(relativeDir: string) {
    const abs = path.join(root, relativeDir);
    const entries = await fs
      .readdir(abs, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      const rel = path.join(relativeDir, entry.name).replace(/\\/g, '/');
      if (shouldSkip(rel, entry.isDirectory(), options)) continue;
      if (entry.isDirectory()) {
        await visit(rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }
  await visit('');
  return out.sort();
}

function shouldSkip(
  relativePath: string,
  isDirectory: boolean,
  options: { includeAssets: boolean; includeTranscript: boolean },
) {
  if (!relativePath) return false;
  if (relativePath.startsWith('exports/')) return true;
  if (relativePath.includes('/.trash/') || relativePath.startsWith('.trash/')) {
    return true;
  }
  if (!options.includeAssets && relativePath.startsWith('assets/')) return true;
  if (!options.includeTranscript && relativePath.startsWith('critique/')) {
    return true;
  }
  if (isDirectory && relativePath === 'node_modules') return true;
  return false;
}

function packagePathFor(relativePath: string) {
  if (relativePath === 'DESIGN.md') return 'DESIGN.md';
  if (relativePath.startsWith('artifacts/')) return `source/${relativePath}`;
  if (relativePath.startsWith('assets/')) return relativePath;
  if (relativePath.startsWith('provenance/')) return relativePath;
  if (relativePath.startsWith('design-system/')) return relativePath;
  if (relativePath.startsWith('craft/')) return relativePath;
  if (relativePath.startsWith('critique/')) return `transcript/${relativePath}`;
  return `source/${relativePath}`;
}

const RESPONSIVE_BREAKPOINTS = [
  { id: 'mobile', width: 390, height: 844 },
  { id: 'tablet', width: 768, height: 1024 },
  { id: 'desktop', width: 1280, height: 720 },
] as const;

function buildResponsiveHandoff(files: string[]) {
  const htmlFiles = files.filter((file) => /\.html?$/i.test(file));
  const fallback =
    htmlFiles.find((file) => /(?:^|\/)index\.html?$/i.test(file)) ??
    htmlFiles[0] ??
    '';
  const entryFiles = RESPONSIVE_BREAKPOINTS.flatMap((breakpoint) => {
    const file =
      htmlFiles.find((item) =>
        path.basename(item).toLowerCase().includes(breakpoint.id.toLowerCase()),
      ) ?? fallback;
    return file ? [{ breakpointId: breakpoint.id, file }] : [];
  });
  return {
    entryFiles,
    platforms: entryFiles.map((entry) => {
      const viewport = RESPONSIVE_BREAKPOINTS.find(
        (breakpoint) => breakpoint.id === entry.breakpointId,
      )!;
      return {
        id: entry.breakpointId,
        label: viewport.id.charAt(0).toUpperCase() + viewport.id.slice(1),
        entryFile: entry.file,
        viewport: { width: viewport.width, height: viewport.height },
      };
    }),
  };
}

function mimeForPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'text/html';
  if (ext === '.css') return 'text/css';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript';
  if (ext === '.json') return 'application/json';
  if (ext === '.md') return 'text/markdown';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mp3') return 'audio/mpeg';
  return 'application/octet-stream';
}

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}
