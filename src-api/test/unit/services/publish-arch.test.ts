import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, expect, it } from 'vitest';

const PLATFORM_PATTERNS = [
  /\byoutube\b/,
  /\btiktok\b/,
  /\binstagram\b/,
  /\blinkedin\b/,
  /\bthreads\b/,
  /\bbluesky\b/,
  /\bmastodon\b/,
  /\btweet\.write\b/,
  /\bmedia\.write\b/,
  /\bupload\.x\.com\b/,
];

const CHECKED_FILES = [
  'src-api/src/shared/services/publish/orchestrator.ts',
  'src-api/src/shared/services/publish/job-ledger.ts',
  'src-api/src/shared/services/publish/scheduler.ts',
  'src-api/src/shared/services/publish/quota-tracker.ts',
  'src-api/src/shared/services/publish/approval.ts',
];

describe('publish platform architecture', () => {
  it('keeps platform names out of orchestration surfaces', () => {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../..',
    );
    const offenders: string[] = [];

    for (const relative of CHECKED_FILES) {
      const filePath = path.join(root, relative);
      if (!existsSync(filePath)) continue;
      const text = readFileSync(filePath, 'utf8').toLowerCase();
      for (const pattern of PLATFORM_PATTERNS) {
        if (pattern.test(text)) offenders.push(`${relative}:${pattern}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('registers publish tools in Claude execution surfaces', () => {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../..',
    );
    const filePath = path.join(
      root,
      'src-api/src/extensions/agent/claude/index.ts',
    );
    const text = readFileSync(filePath, 'utf8');

    const executeStart = text.indexOf('private async *executeGenerator');
    const ptcStart = text.indexOf('private async *executePTCGenerator');
    const ptcToolsStart = text.indexOf('private async buildPTCTools');
    const sanitizeStart = text.indexOf('private sanitizeText');

    expect(executeStart).toBeGreaterThan(-1);
    expect(ptcStart).toBeGreaterThan(executeStart);
    expect(ptcToolsStart).toBeGreaterThan(ptcStart);
    expect(sanitizeStart).toBeGreaterThan(ptcToolsStart);

    const executeSection = text.slice(executeStart, ptcStart);
    expect(executeSection).toContain(
      'mcpServers.publish = createPublishMcpServer',
    );
    expect(executeSection).toContain(
      'featureEnabled: isAgentPublishPipelineEnabled',
    );
    expect(executeSection).toContain(
      "addMcpAllowedTools(queryOptions, 'publish', PUBLISH_TOOL_NAMES)",
    );
    expect(executeSection).toContain('Execute: Publish MCP server registered');
    expect(executeSection).toContain('buildPublishExecutionHint');

    const ptcToolsSection = text.slice(ptcToolsStart, sanitizeStart);
    expect(ptcToolsSection).toContain('...publishTools');
    expect(ptcToolsSection).toContain(
      'featureEnabled: isAgentPublishPipelineEnabled',
    );
    expect(ptcToolsSection).toContain('PTC: Added');
    expect(ptcToolsSection).toContain('publish tools');
  });
});
