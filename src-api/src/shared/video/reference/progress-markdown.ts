import type { ReferenceRun } from '@/shared/video/types';

export function renderReferenceProgressMarkdown(run: ReferenceRun): string {
  const lines = [
    `# Reference analysis`,
    '',
    `- Run ID: \`${run.id}\``,
    `- Reference: \`${run.referenceId}\``,
    `- Status: ${run.status}`,
    `- Revision: ${run.revision}`,
    `- Sequence: ${run.sequence}`,
    `- Updated: ${run.updatedAt}`,
    '',
  ];
  if (run.focus?.text) {
    lines.push('## Focus', '', run.focus.text, '');
  }
  lines.push('## Steps', '');
  for (const step of run.steps) {
    const elapsed = elapsedLabel(step.startedAt, step.endedAt);
    lines.push(
      `### ${step.id} (\`${step.status}\`)`,
      '',
      `- Owner: ${step.owner}`,
      `- Elapsed: ${elapsed}`,
      `- Artifacts: ${
        step.producedArtifactIds.length > 0
          ? step.producedArtifactIds.map((id) => `\`${id}\``).join(', ')
          : 'none'
      }`,
    );
    if (step.note) lines.push(`- Note: ${step.note}`);
    if (step.error) {
      lines.push(`- Error: \`${step.error.code}\` ${step.error.message}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function elapsedLabel(startedAt?: string, endedAt?: string): string {
  if (!startedAt) return 'not started';
  const end = endedAt ? Date.parse(endedAt) : Date.now();
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 'unknown';
  }
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return `${seconds}s`;
}
