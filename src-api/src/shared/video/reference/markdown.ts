import type {
  ReferenceAnalysis,
  ReferenceTimelineArtifact,
} from '@/shared/video/types';

export function renderReferenceAnalysisMarkdown(
  analysis: ReferenceAnalysis,
): string {
  const lines = [
    '# Reference analysis',
    '',
    `- Prompt version: \`${analysis.promptVersion}\``,
    '',
    '## Intent',
    '',
    analysis.intent,
    '',
    '## Arc',
    '',
    analysis.arc,
    '',
    '## Thesis',
    '',
    analysis.thesis,
    '',
    '## Observed',
    '',
    ...list(analysis.observed),
    '',
    '## Inferred',
    '',
    ...list(analysis.inferred),
    '',
    '## Systems',
    '',
  ];
  for (const system of analysis.systems) {
    lines.push(
      `### ${system.id} (${system.role})`,
      '',
      `- Function: ${system.function}`,
      `- Entry: ${system.entry}`,
      `- Behavior: ${system.behavior}`,
      `- Persistence: ${system.persistence}`,
      `- Exit: ${system.exit}`,
      `- Confidence: ${system.confidence}`,
      `- Evidence: ${system.evidenceIds.map((id) => `\`${id}\``).join(', ')}`,
      '',
    );
  }
  lines.push('## Open questions', '');
  if (analysis.openQuestions.length === 0) {
    lines.push('- None recorded.', '');
  } else {
    for (const question of analysis.openQuestions) {
      const at = question.atMs !== undefined ? ` @ ${question.atMs}ms` : '';
      lines.push(`- ${question.question}${at}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export function renderReferenceTimelineMarkdown(
  timeline: ReferenceTimelineArtifact,
): string {
  const lines = [
    '# Reference timeline',
    '',
    `- Prompt version: \`${timeline.promptVersion}\``,
    `- Samples: ${timeline.coverage.sampleCount}`,
    `- Max gap: ${timeline.coverage.maxGapMs}ms`,
    '',
    '## Thin ranges',
    '',
    ...(timeline.coverage.thinRanges.length > 0
      ? timeline.coverage.thinRanges.map(
          (range) => `- ${range.startMs}–${range.endMs}ms`,
        )
      : ['- None.']),
    '',
    '## Sections',
    '',
  ];
  for (const section of timeline.sections) {
    lines.push(
      `## ${section.phase}`,
      '',
      `- ${section.startMs}–${section.endMs}ms`,
      `- Anchor: ${section.anchor ?? 'none'}`,
      `- Effect: ${section.effect}`,
      `- Confidence: ${section.confidence}`,
      `- Systems: ${section.activeSystems.map((item) => `${item.systemId} (${item.note})`).join('; ')}`,
      `- Evidence: ${section.evidenceIds.map((id) => `\`${id}\``).join(', ')}`,
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

function list(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ['- None.'];
}
