import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';

import JSZip from 'jszip';

import {
  getVideoProjectDir,
  getVideoProjectRoot,
  getVideoWorkspaceRoot,
} from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

import { buildEditorHandoffModel } from './build-model';
import { writeCaptionsSrt } from './captions';
import { evaluateHandoffConformance } from './conformance';
import { buildCutList } from './cut-list';
import { writeEdl } from './edl';
import { writeFcpxml } from './fcpxml';
import { buildEditorHandoffManifest } from './manifest';
import { collectHandoffMedia } from './media';
import { writeOtioJson } from './otio-json';
import { writePremiereXml } from './premiere-xml';
import {
  EDITOR_HANDOFF_TARGETS,
  type ConformanceReport,
  type EditorHandoffMediaMode,
  type EditorHandoffOptions,
  type EditorHandoffPackageResult,
  type EditorHandoffTarget,
} from './types';

const DEFAULT_MEDIA_MODE: EditorHandoffMediaMode = 'copy';

export async function createEditorHandoffPackage(
  project: VideoProject,
  options: EditorHandoffOptions,
): Promise<EditorHandoffPackageResult> {
  const targets = normalizeTargets(options.targets);
  const mediaMode = options.mediaMode ?? DEFAULT_MEDIA_MODE;
  const packageDir =
    options.outputRoot ??
    path.join(
      getVideoProjectDir(project.id),
      'outputs',
      'editor-handoff',
      options.jobId,
    );

  await fs.rm(packageDir, { recursive: true, force: true });
  await fs.mkdir(packageDir, { recursive: true });

  const workspaceRoot =
    options.workspaceRoot ?? getVideoProjectRoot(project.id);
  const model = buildEditorHandoffModel(project);
  model.mediaRefs = await collectHandoffMedia({
    workspaceRoot,
    packageDir,
    mediaMode,
    mediaRefs: model.mediaRefs,
  });
  model.featureMap.missingMediaIds = model.mediaRefs
    .filter((ref) => ref.missing)
    .map((ref) => ref.id)
    .sort();

  const conformance = evaluateHandoffConformance(model, targets);
  const generatedSidecars = await writePackageFiles(
    project,
    model,
    packageDir,
    conformance,
  );
  const checksums = await checksumGeneratedFiles(packageDir);
  const referencePath = await copyReferenceRender(project, packageDir);
  if (referencePath) {
    generatedSidecars.push(referencePath);
    checksums[referencePath] = await hashFile(
      path.join(packageDir, referencePath),
    );
  }

  const manifest = buildEditorHandoffManifest({
    model,
    targets,
    mediaMode,
    conformance,
    generatedSidecars: generatedSidecars.sort(),
    checksums,
    referencePath,
  });
  await writeJson(path.join(packageDir, 'manifest.json'), manifest);
  checksums['manifest.json'] = await hashFile(
    path.join(packageDir, 'manifest.json'),
  );

  const packagePath = path.join(packageDir, 'neuma-video-handoff.zip');
  await zipDirectory(packageDir, packagePath);

  return {
    jobId: options.jobId,
    projectId: project.id,
    packageDir,
    packagePath,
    manifestPath: path.join(packageDir, 'manifest.json'),
    conformance,
    targets,
  };
}

async function writePackageFiles(
  project: VideoProject,
  model: ReturnType<typeof buildEditorHandoffModel>,
  packageDir: string,
  conformance: ConformanceReport,
): Promise<string[]> {
  const files: Array<[string, string]> = [
    ['media/manifest.json', JSON.stringify(model.mediaRefs, null, 2)],
    ['media/derivatives.json', JSON.stringify(model.derivatives, null, 2)],
    [
      'analysis/manifest.json',
      JSON.stringify(
        {
          schema: 'neuma.video.editor-handoff.analysis-manifest.v1',
          projectId: project.id,
          artifacts: model.analysisArtifacts,
        },
        null,
        2,
      ),
    ],
    ['actions/action-log.json', JSON.stringify(model.actionBatches, null, 2)],
    ['captions/captions.srt', writeCaptionsSrt(model)],
    ['cut-list.json', JSON.stringify(buildCutList(model), null, 2)],
    ['interchange/timeline.otio', writeOtioJson(model)],
    ['interchange/timeline.fcpxml', writeFcpxml(model)],
    ['interchange/timeline-premiere.xml', writePremiereXml(model)],
    ['interchange/timeline.edl', writeEdl(model)],
    ['conformance.json', JSON.stringify(conformance, null, 2)],
  ];
  for (const [relativePath, contents] of files) {
    await writeText(path.join(packageDir, relativePath), contents);
  }
  return files.map(([relativePath]) => relativePath);
}

async function copyReferenceRender(
  project: VideoProject,
  packageDir: string,
): Promise<string | undefined> {
  const outputPath =
    project.render?.outputPath ?? project.outputs?.at(-1)?.path;
  if (!outputPath) return undefined;
  const absolutePath = resolveWorkspacePath(
    outputPath,
    getVideoProjectRoot(project.id),
  );
  if (!absolutePath) return undefined;
  try {
    await fs.access(absolutePath);
    const referenceDir = path.join(packageDir, 'reference');
    await fs.mkdir(referenceDir, { recursive: true });
    const filename = path.basename(absolutePath) || 'reference.mp4';
    const dest = path.join(referenceDir, filename);
    await fs.copyFile(absolutePath, dest);
    return path.relative(packageDir, dest);
  } catch {
    await writeText(
      path.join(packageDir, 'reference', 'README.txt'),
      'No compatible Neuma reference render was available when this handoff package was generated.\n',
    );
    return 'reference/README.txt';
  }
}

async function checksumGeneratedFiles(
  packageDir: string,
): Promise<Record<string, string>> {
  const files = await listFiles(packageDir);
  const entries = await Promise.all(
    files
      .filter((file) => !file.endsWith('.zip'))
      .map(
        async (file) =>
          [path.relative(packageDir, file), await hashFile(file)] as const,
      ),
  );
  return Object.fromEntries(entries);
}

async function zipDirectory(
  packageDir: string,
  packagePath: string,
): Promise<void> {
  const zip = new JSZip();
  const files = await listFiles(packageDir);
  for (const file of files) {
    if (file === packagePath) continue;
    const relativePath = path.relative(packageDir, file);
    zip.file(relativePath, createReadStream(file));
  }
  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    streamFiles: true,
  });
  await fs.writeFile(packagePath, bytes);
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
    }),
  );
  return files.flat().sort();
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    contents.endsWith('\n') ? contents : `${contents}\n`,
  );
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await streamPipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

function normalizeTargets(
  targets: EditorHandoffTarget[] | undefined,
): EditorHandoffTarget[] {
  const requested: EditorHandoffTarget[] =
    targets && targets.length > 0 ? targets : ['neuma-package'];
  const normalized = Array.from(
    new Set(
      requested.filter((target): target is EditorHandoffTarget =>
        EDITOR_HANDOFF_TARGETS.includes(target),
      ),
    ),
  );
  return normalized.length > 0 ? normalized : ['neuma-package'];
}

function resolveWorkspacePath(
  filePath: string,
  workspaceRoot = getVideoWorkspaceRoot(),
): string | undefined {
  const absolutePath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(workspaceRoot, filePath);
  const relative = path.relative(workspaceRoot, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return absolutePath;
}
