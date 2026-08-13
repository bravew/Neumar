export type MimeDecision =
  | { action: 'allow' }
  | { action: 'skip'; reason: 'mime_skipped' | 'file_too_large' };

const PDF_MAX_BYTES = 25 * 1024 * 1024;

const DENIED_MIME_PREFIXES = [
  'application/x-msdownload',
  'application/x-executable',
  'application/x-mach-binary',
];

export function evaluateMimeForMaterialization(input: {
  mimeType: string;
  sizeBytes?: number;
}): MimeDecision {
  const mimeType = input.mimeType.toLowerCase();
  if (DENIED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) {
    return { action: 'skip', reason: 'mime_skipped' };
  }
  if (mimeType.startsWith('text/')) {
    return { action: 'allow' };
  }
  if (mimeType === 'application/pdf') {
    if ((input.sizeBytes ?? 0) > PDF_MAX_BYTES) {
      return { action: 'skip', reason: 'file_too_large' };
    }
    return { action: 'allow' };
  }
  return { action: 'skip', reason: 'mime_skipped' };
}
