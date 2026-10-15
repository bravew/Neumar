import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Regression coverage for issue #197: `pnpm validate` does not run API lint,
 * API test-file typechecking, the shared video IR suite, or Rust checks, so
 * those gaps reached main. These tests pin the added jobs and the boundary
 * conditions that make them meaningful. The aggregate gate's decision logic is
 * exercised in ci-workflow-gate.test.ts.
 */
const workflowPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
const workflow = readFileSync(workflowPath, 'utf-8');

function extractJobBlock(jobId: string): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobId}:`);
  if (start === -1)
    throw new Error(`job "${jobId}" not found in ${workflowPath}`);

  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^ {2}\S/.test(line)) break;
    block.push(line);
  }
  return block.join('\n');
}

describe('ci.yml extended checks', () => {
  it('adds the checks pnpm validate does not run', () => {
    expect(extractJobBlock('api-checks')).toContain(
      'pnpm --filter neumar-api lint',
    );
    expect(extractJobBlock('api-checks')).toContain(
      'pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit',
    );
    expect(extractJobBlock('video-ir')).toContain(
      'pnpm --filter @neumar/video-ir test',
    );
    expect(extractJobBlock('video-ir')).toContain(
      'pnpm --filter @neumar/video-ir validate',
    );
    expect(extractJobBlock('rust-checks')).toContain(
      'cargo fmt --manifest-path src-tauri/Cargo.toml --check',
    );
    expect(extractJobBlock('rust-checks')).toContain(
      'cargo check --manifest-path src-tauri/Cargo.toml --locked',
    );
  });

  it('builds the shared video IR before the API type check', () => {
    // The API tsconfig resolves @neumar/video-ir through the package's built
    // lib/. Without this step every importer reports TS2307, which reads as a
    // source error. The step must precede the tsc invocation.
    const block = extractJobBlock('api-checks');
    const buildIndex = block.indexOf('pnpm --filter @neumar/video-ir build');
    const typecheckIndex = block.indexOf(
      'pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit',
    );
    expect(buildIndex).toBeGreaterThan(-1);
    expect(typecheckIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeLessThan(typecheckIndex);
  });

  it('scopes the Rust job to src-tauri changes with an explicit skip reason', () => {
    const block = extractJobBlock('rust-checks');
    expect(block).toContain(
      'git diff --quiet "$BASE_SHA"...HEAD -- src-tauri/',
    );
    expect(block).toContain(
      'No src-tauri/ changes in this PR; Rust checks skipped.',
    );
  });

  it('checks Rust source without requiring staged bundle artifacts', () => {
    // tauri.conf.json points at an externalBin sidecar and native resource
    // globs that only exist after scripts/build.sh stages them. Compiling the
    // source must not depend on them, and the override must stay scoped to the
    // cargo invocation so the rest of the manifest is still processed.
    const block = extractJobBlock('rust-checks');
    expect(block).toContain(
      'TAURI_CONFIG: \'{"bundle":{"externalBin":[],"resources":[]}}\'',
    );
    expect(block).not.toContain('pnpm install');
    expect(block).toContain('libwebkit2gtk-4.1-dev');
  });

  it('fetches full history so base-aware gates can resolve the PR base', () => {
    expect(extractJobBlock('quality')).toContain('fetch-depth: 0');
    expect(extractJobBlock('rust-checks')).toContain('fetch-depth: 0');
  });
});
