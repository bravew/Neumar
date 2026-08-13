import { DESIGN_JURY_MAX_REVIEW_CHARS } from './protocol';

export interface ParsedDesignJuryArtifact {
  content: string;
  reviewedBytes: number;
  truncated: boolean;
}

export function parseDesignJuryArtifact(
  rawContent: string,
): ParsedDesignJuryArtifact {
  const content = rawContent.slice(0, DESIGN_JURY_MAX_REVIEW_CHARS);
  return {
    content,
    reviewedBytes: Buffer.byteLength(content, 'utf-8'),
    truncated: rawContent.length > content.length,
  };
}
