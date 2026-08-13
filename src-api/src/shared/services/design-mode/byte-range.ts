export type ByteRange = { start: number; end: number };

export function parseByteRange(
  header: string | null | undefined,
  fileSize: number,
): ByteRange | 'unsatisfiable' | null {
  if (!header || fileSize < 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return null;

  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return 'unsatisfiable';
    }
    if (fileSize === 0) return 'unsatisfiable';
    return {
      start: Math.max(fileSize - suffixLength, 0),
      end: fileSize - 1,
    };
  }

  const start = Number(startRaw);
  const end = endRaw ? Number(endRaw) : fileSize - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return 'unsatisfiable';
  }

  return { start, end: Math.min(end, fileSize - 1) };
}
