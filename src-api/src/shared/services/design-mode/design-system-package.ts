import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_PACKAGE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PACKAGE_TOTAL_BYTES = 75 * 1024 * 1024;
const CATALOG_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const CSS_CUSTOM_PROPERTY_RE = /--[a-z0-9][a-z0-9-]*\s*:/i;

const SUPPORTED_PACKAGE_SCHEMAS = new Set([
  'neuma-design-system-package/v1',
  'od-design-system-project/v1',
]);

export const GENERATED_DESIGN_SYSTEM_REQUIRED_FILES = [
  'DESIGN.md',
  'manifest.json',
  'tokens.css',
  'components.html',
  'design-tokens.json',
  'USAGE.md',
  'source/evidence.md',
] as const;

const MANIFEST_FILE_FIELDS = [
  { field: 'design', expected: 'DESIGN.md' },
  { field: 'tokens', expected: 'tokens.css' },
  { field: 'components', expected: 'components.html' },
  { field: 'designTokens', expected: 'design-tokens.json' },
] as const;

export type DesignSystemPackageIssueSeverity = 'error' | 'warning';

export interface DesignSystemPackageValidationIssue {
  code: string;
  message: string;
  path?: string;
  severity: DesignSystemPackageIssueSeverity;
}

export interface DesignSystemPackageFileReport {
  path: string;
  sizeBytes: number;
}

export interface DesignSystemPackageManifestSummary {
  id?: string;
  name?: string;
  category?: string;
  description?: string;
  schemaVersion?: string;
}

export interface DesignSystemPackageValidationReport {
  files: DesignSystemPackageFileReport[];
  issues: DesignSystemPackageValidationIssue[];
  manifest?: DesignSystemPackageManifestSummary;
  ok: boolean;
  root: string;
  totalBytes: number;
}

export interface ValidateDesignSystemPackageOptions {
  expectedId?: string;
}

export async function validateGeneratedDesignSystemPackage(
  root: string,
  options: ValidateDesignSystemPackageOptions = {},
): Promise<DesignSystemPackageValidationReport> {
  const absoluteRoot = path.resolve(root);
  const issues: DesignSystemPackageValidationIssue[] = [];
  const files: DesignSystemPackageFileReport[] = [];

  let rootStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
  try {
    rootStat = await fs.lstat(absoluteRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!rootStat || !rootStat.isDirectory()) {
    issues.push({
      code: 'missing_package_root',
      message: 'Design-system package root must be an existing directory.',
      severity: 'error',
    });
    return report(absoluteRoot, files, issues);
  }

  for (const requiredFile of GENERATED_DESIGN_SYSTEM_REQUIRED_FILES) {
    const file = await inspectRequiredFile(absoluteRoot, requiredFile, issues);
    if (file) files.push(file);
  }

  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (totalBytes > MAX_PACKAGE_TOTAL_BYTES) {
    issues.push({
      code: 'package_too_large',
      message: `Design-system package exceeds ${MAX_PACKAGE_TOTAL_BYTES} bytes.`,
      severity: 'error',
    });
  }

  const manifest = await validateManifest(
    absoluteRoot,
    options.expectedId ?? path.basename(absoluteRoot),
    issues,
  );
  await validateTokenCss(absoluteRoot, issues);
  await validateDesignTokens(absoluteRoot, issues);
  await validateEvidence(absoluteRoot, issues);

  return report(absoluteRoot, files, issues, manifest, totalBytes);
}

async function inspectRequiredFile(
  root: string,
  relativePath: string,
  issues: DesignSystemPackageValidationIssue[],
): Promise<DesignSystemPackageFileReport | null> {
  const absolutePath = resolveInsideRoot(root, relativePath);
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    issues.push({
      code: 'missing_required_file',
      message: `Missing required design-system package file: ${relativePath}.`,
      path: relativePath,
      severity: 'error',
    });
    return null;
  }

  if (stat.isSymbolicLink()) {
    issues.push({
      code: 'symlink_not_allowed',
      message: `Design-system package file must not be a symlink: ${relativePath}.`,
      path: relativePath,
      severity: 'error',
    });
    return null;
  }
  if (!stat.isFile()) {
    issues.push({
      code: 'required_path_not_file',
      message: `Design-system package path must be a file: ${relativePath}.`,
      path: relativePath,
      severity: 'error',
    });
    return null;
  }
  if (stat.size === 0) {
    issues.push({
      code: 'empty_required_file',
      message: `Design-system package file must not be empty: ${relativePath}.`,
      path: relativePath,
      severity: 'error',
    });
  }
  if (stat.size > MAX_PACKAGE_FILE_BYTES) {
    issues.push({
      code: 'required_file_too_large',
      message: `Design-system package file exceeds ${MAX_PACKAGE_FILE_BYTES} bytes: ${relativePath}.`,
      path: relativePath,
      severity: 'error',
    });
  }
  return { path: relativePath, sizeBytes: stat.size };
}

async function validateManifest(
  root: string,
  expectedId: string,
  issues: DesignSystemPackageValidationIssue[],
): Promise<DesignSystemPackageManifestSummary | undefined> {
  const manifest = await readJsonObject(root, 'manifest.json', issues);
  if (!manifest) return undefined;

  const summary = {
    id: stringValue(manifest.id),
    name: stringValue(manifest.name),
    category: stringValue(manifest.category),
    description: stringValue(manifest.description),
    schemaVersion: stringValue(manifest.schemaVersion),
  };

  if (!summary.schemaVersion) {
    issues.push({
      code: 'missing_manifest_schema',
      message: 'manifest.json must declare schemaVersion.',
      path: 'manifest.json',
      severity: 'error',
    });
  } else if (!SUPPORTED_PACKAGE_SCHEMAS.has(summary.schemaVersion)) {
    issues.push({
      code: 'unsupported_manifest_schema',
      message: `Unsupported design-system package schema: ${summary.schemaVersion}.`,
      path: 'manifest.json',
      severity: 'error',
    });
  }

  if (!summary.id || !CATALOG_ID_RE.test(summary.id)) {
    issues.push({
      code: 'invalid_manifest_id',
      message: 'manifest.json must include a valid catalog-safe id.',
      path: 'manifest.json',
      severity: 'error',
    });
  } else if (summary.id !== expectedId) {
    issues.push({
      code: 'manifest_id_mismatch',
      message: `manifest.json id must match package id "${expectedId}".`,
      path: 'manifest.json',
      severity: 'error',
    });
  }

  for (const field of ['name', 'category', 'description'] as const) {
    if (!summary[field]) {
      issues.push({
        code: `missing_manifest_${field}`,
        message: `manifest.json must include ${field}.`,
        path: 'manifest.json',
        severity: 'error',
      });
    }
  }

  const files = isRecord(manifest.files) ? manifest.files : null;
  if (!files) {
    issues.push({
      code: 'missing_manifest_files',
      message: 'manifest.json must map required package files.',
      path: 'manifest.json',
      severity: 'error',
    });
  } else {
    for (const { field, expected } of MANIFEST_FILE_FIELDS) {
      if (stringValue(files[field]) !== expected) {
        issues.push({
          code: 'manifest_file_mismatch',
          message: `manifest.json files.${field} must be "${expected}".`,
          path: 'manifest.json',
          severity: 'error',
        });
      }
    }
  }

  const source = isRecord(manifest.source) ? manifest.source : null;
  if (!source || !stringValue(source.type)) {
    issues.push({
      code: 'missing_manifest_source',
      message: 'manifest.json must include source.type provenance metadata.',
      path: 'manifest.json',
      severity: 'error',
    });
  }

  return summary;
}

async function validateTokenCss(
  root: string,
  issues: DesignSystemPackageValidationIssue[],
) {
  const tokenCss = await readRequiredText(root, 'tokens.css', issues);
  if (!tokenCss) return;
  if (!CSS_CUSTOM_PROPERTY_RE.test(tokenCss)) {
    issues.push({
      code: 'missing_css_tokens',
      message: 'tokens.css must define at least one CSS custom property.',
      path: 'tokens.css',
      severity: 'error',
    });
  }
}

async function validateDesignTokens(
  root: string,
  issues: DesignSystemPackageValidationIssue[],
) {
  const designTokens = await readJsonObject(root, 'design-tokens.json', issues);
  if (!designTokens) return;
  if (Object.keys(designTokens).length === 0) {
    issues.push({
      code: 'empty_design_tokens',
      message: 'design-tokens.json must include at least one token group.',
      path: 'design-tokens.json',
      severity: 'error',
    });
  }
}

async function validateEvidence(
  root: string,
  issues: DesignSystemPackageValidationIssue[],
) {
  const evidence = await readRequiredText(root, 'source/evidence.md', issues);
  if (!evidence) return;
  if (!/\S/.test(evidence)) {
    issues.push({
      code: 'empty_source_evidence',
      message: 'source/evidence.md must describe package provenance.',
      path: 'source/evidence.md',
      severity: 'error',
    });
  }
}

async function readJsonObject(
  root: string,
  relativePath: string,
  issues: DesignSystemPackageValidationIssue[],
): Promise<Record<string, unknown> | null> {
  const text = await readRequiredText(root, relativePath, issues);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    // Handled below as a shape failure.
  }
  issues.push({
    code: 'invalid_json',
    message: `${relativePath} must contain a JSON object.`,
    path: relativePath,
    severity: 'error',
  });
  return null;
}

async function readRequiredText(
  root: string,
  relativePath: string,
  issues: DesignSystemPackageValidationIssue[],
): Promise<string | null> {
  const absolutePath = resolveInsideRoot(root, relativePath);
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (!hasIssue(issues, 'missing_required_file', relativePath)) {
      issues.push({
        code: 'missing_required_file',
        message: `Missing required design-system package file: ${relativePath}.`,
        path: relativePath,
        severity: 'error',
      });
    }
    return null;
  }
  if (stat.isSymbolicLink()) {
    if (!hasIssue(issues, 'symlink_not_allowed', relativePath)) {
      issues.push({
        code: 'symlink_not_allowed',
        message: `Design-system package file must not be a symlink: ${relativePath}.`,
        path: relativePath,
        severity: 'error',
      });
    }
    return null;
  }
  if (!stat.isFile()) {
    if (!hasIssue(issues, 'required_path_not_file', relativePath)) {
      issues.push({
        code: 'required_path_not_file',
        message: `Design-system package path must be a file: ${relativePath}.`,
        path: relativePath,
        severity: 'error',
      });
    }
    return null;
  }
  return fs.readFile(absolutePath, 'utf-8');
}

function report(
  root: string,
  files: DesignSystemPackageFileReport[],
  issues: DesignSystemPackageValidationIssue[],
  manifest?: DesignSystemPackageManifestSummary,
  totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0),
): DesignSystemPackageValidationReport {
  return {
    files,
    issues,
    manifest,
    ok: !issues.some((issue) => issue.severity === 'error'),
    root,
    totalBytes,
  };
}

function resolveInsideRoot(root: string, relativePath: string): string {
  const absolutePath = path.resolve(root, relativePath);
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (absolutePath !== root && !absolutePath.startsWith(rootPrefix)) {
    throw new Error(`Design-system package path escapes root: ${relativePath}`);
  }
  return absolutePath;
}

function hasIssue(
  issues: DesignSystemPackageValidationIssue[],
  code: string,
  issuePath: string,
) {
  return issues.some(
    (issue) => issue.code === code && issue.path === issuePath,
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
