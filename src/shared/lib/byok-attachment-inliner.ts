import type { MessageAttachment } from '@/shared/hooks/agent-types';

const MAX_INLINE_BYTES = 64 * 1024;
const MAX_INLINE_CHARS = 80_000;

const TEXT_MIME_PATTERN =
  /^(text\/|application\/(json|xml|javascript|x-javascript|typescript|x-typescript|yaml|x-yaml|toml|csv|sql|graphql|ld\+json)|image\/svg\+xml)/i;

const TEXT_EXTENSION_PATTERN =
  /\.(txt|md|mdx|markdown|json|jsonl|csv|ts|tsx|js|jsx|mjs|cjs|css|scss|html?|xml|svg|yaml|yml|toml|sql|graphql|gql|log)$/i;

export async function appendInlineAttachmentContext(
  prompt: string,
  attachments?: readonly MessageAttachment[],
): Promise<string> {
  const context = await formatInlineAttachmentContext(attachments);
  return context ? `${context}\n\n${prompt}` : prompt;
}

export async function formatInlineAttachmentContext(
  attachments?: readonly MessageAttachment[],
): Promise<string | undefined> {
  const blocks: string[] = [];
  let usedChars = 0;

  for (const attachment of attachments ?? []) {
    if (attachment.type !== 'file') continue;
    if (!isTextAttachment(attachment)) continue;

    const text = await readAttachmentText(attachment);
    if (!text) continue;

    const remaining = MAX_INLINE_CHARS - usedChars;
    if (remaining <= 0) break;

    const clipped = text.length > remaining ? text.slice(0, remaining) : text;
    usedChars += clipped.length;
    const safePath = attachment.path
      ? sanitizeAttachmentPath(attachment.path)
      : undefined;
    blocks.push(
      [
        `### ${cleanAttachmentName(attachment.name)}`,
        `mime: ${cleanAttachmentName(attachment.mimeType ?? 'text/plain')}`,
        safePath ? `path: ${safePath}` : undefined,
        '```',
        clipped,
        '```',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (blocks.length === 0) return undefined;

  return [
    '[ATTACHED TEXT CONTEXT — inline excerpts from user-supplied files. Use this content when the file path is unavailable to the selected provider.]',
    ...blocks,
    '[END ATTACHED TEXT CONTEXT]',
  ].join('\n\n');
}

function isTextAttachment(attachment: MessageAttachment): boolean {
  const mime = attachment.mimeType ?? '';
  return (
    TEXT_MIME_PATTERN.test(mime) || TEXT_EXTENSION_PATTERN.test(attachment.name)
  );
}

async function readAttachmentText(
  attachment: MessageAttachment,
): Promise<string | undefined> {
  if (attachment.file && attachment.file.size <= MAX_INLINE_BYTES) {
    return attachment.file.text();
  }
  if (!attachment.data) return undefined;
  if (attachment.data.startsWith('data:')) {
    return decodeDataUrlText(attachment.data);
  }
  if (
    attachment.data.length <= MAX_INLINE_CHARS &&
    !looksLikeFilePath(attachment.data)
  ) {
    return attachment.data;
  }
  return undefined;
}

function decodeDataUrlText(dataUrl: string): string | undefined {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return undefined;
  const meta = dataUrl.slice(0, comma).toLowerCase();
  const payload = dataUrl.slice(comma + 1);
  try {
    if (meta.includes(';base64')) {
      return decodeURIComponent(
        Array.from(atob(payload))
          .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
          .join(''),
      );
    }
    return decodeURIComponent(payload);
  } catch {
    return undefined;
  }
}

function looksLikeFilePath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value);
}

function cleanAttachmentName(name: string): string {
  return (
    name
      .replace(/[\r\n`]+/g, ' ')
      .trim()
      .slice(0, 120) || 'attachment'
  );
}

function sanitizeAttachmentPath(path: string): string | undefined {
  const cleaned = path.replace(/[^\w./\\:_-]+/g, '').slice(0, 200);
  return cleaned || undefined;
}
