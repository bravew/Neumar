import type { ReactNode } from 'react';
import { useMemo } from 'react';

import {
  CodeArtifact,
  HtmlSandbox,
  InlineFileRenderer,
  type InlineFileKind,
  MarkdownArtifact,
  MermaidArtifact,
  SvgSandbox,
} from '@/components/artifacts/live';
import type { Artifact } from '@/components/artifacts/types';
import { GenUIRenderer } from '@/components/shared/chat-panel';
import {
  PDF_EXTS,
  TEXT_EXTS,
  extOf,
} from '@/components/shared/ChatInput.types';
import { MessageAudioButton } from '@/components/shared/MessageAudioButton';
import { API_BASE_URL } from '@/config';
import { useSetting } from '@/shared/db/settings';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import {
  PROVENANCE_COMMENT_RE,
  type MediaAsset,
  type MediaProvenanceInfo,
} from '@/shared/lib/provenance';
import type { ArtifactKind } from '@/shared/types/artifact';
import { parseGenUIEnvelope } from '@/shared/types/gen-ui';
import { parseStructuredEnvelope } from '@/shared/utils/structured-envelope';

import {
  InlineChatDocument,
  InlineChatImage,
  InlineChatPdf,
  InlineChatVideo,
} from './MediaLightbox';
import { ATTACHED_FILES_PREFIX_RE } from './message-shared';
import { filterOutputArtifactMedia } from './outputArtifactMedia';
import { MarkdownProse } from './TaskV2MarkdownProse';
import { getToolArgs, getToolName } from './TaskV2MessageBubble.types';
import type { AGUIMessage, AGUIToolCall } from './TaskV2MessageBubble.types';
import { TaskV2RunSummaryChips } from './TaskV2RunSummaryChips';
import { ToolCallGroup } from './TaskV2ToolCallGroup';
import { UserMessageBubble } from './UserMessageBubble';

// Re-export types and components so existing consumers don't break
export type { AGUIMessage, AGUIToolCall } from './TaskV2MessageBubble.types';
export { ToolCallGroup } from './TaskV2ToolCallGroup';

// Detect previewable file paths in assistant text / tool output so we can
// render them as inline chips / players. Four rendering families:
//   • image / video → inline element with click-to-zoom
//   • pdf           → chip that opens the lightbox iframe viewer
//   • document      → chip that opens a text lightbox (markdown/code/txt
//                     loaded via /files/read or File.text())
// Extension sets are lifted from ChatInput.types.ts — single source of truth.
const IMAGE_EXT_LIST = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
const VIDEO_EXT_LIST = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
const IMAGE_EXT_SET = new Set(IMAGE_EXT_LIST);
const VIDEO_EXT_SET = new Set(VIDEO_EXT_LIST);

const PREVIEWABLE_EXT_LIST = [
  ...IMAGE_EXT_LIST,
  ...VIDEO_EXT_LIST,
  ...PDF_EXTS,
  ...TEXT_EXTS,
];
const EXT_ALTERNATION = PREVIEWABLE_EXT_LIST.join('|');
const MEDIA_EXT_RE = new RegExp(`\\.(?:${EXT_ALTERNATION})$`, 'i');

/**
 * Regex patterns for extracting previewable paths from text (local + HTTP).
 *
 * Each pattern requires a proper boundary after the extension (end-of-path,
 * whitespace, quote, or query-string / fragment marker for URLs). Without
 * this, greedy backtracking happily turns `https://www.dux-soup.com/pricing`
 * into a match for `.c` (since `c` is a C-source extension) and the chip
 * points at a truncated URL that 403s on click.
 */
const MEDIA_PATH_PATTERNS = [
  // Backtick-quoted paths (local; backtick is the boundary)
  new RegExp(`\`(\\/[^\`\\n]+\\.(?:${EXT_ALTERNATION}))\``, 'gi'),
  // JSON string values with absolute paths (quote is the boundary)
  new RegExp(`"(\\/[^"\\n]+\\.(?:${EXT_ALTERNATION}))"`, 'gi'),
  // Markdown link targets (local or HTTP; closing `)` is the boundary,
  // `[^)]*` after the ext allows trailing path segments inside the link)
  new RegExp(
    `\\]\\(((?:\\/|https?:\\/\\/)[^)\\n]+\\.(?:${EXT_ALTERNATION})[^)]*)\\)`,
    'gi',
  ),
  // Bare absolute paths (local) — leading `/` must not sit in the middle of
  // a word (lookbehind rejects `output/foo.pdf` while still accepting
  // whitespace-prefixed or start-of-string `/Volumes/foo.pdf`), and the ext
  // must terminate at whitespace, quote, prose boundary, or end-of-string.
  // The `:` in the lookbehind class rejects the `//www.host/...` slice of an
  // `https://www.host/...html` URL — without it, the URL would otherwise
  // match here and be misclassified as a local document.
  new RegExp(
    `(?<![\\w/:])(\\/[^\\s"'\`|)\\]<>]+\\.(?:${EXT_ALTERNATION}))(?=[\\s"'\`|)\\]<>]|$)`,
    'gi',
  ),
  // HTTP URLs with supported extensions — ext must be followed by a URL
  // boundary (query, fragment, whitespace, quote) or end-of-string.
  new RegExp(
    `(https?:\\/\\/[^\\s"'\`<>]+\\.(?:${EXT_ALTERNATION}))(?=[?#]|$|[\\s"'\`<>])`,
    'gi',
  ),
];
const FILE_NAME_RE = new RegExp(
  `File[:\\s]*\`?(\\S+\\.(?:${EXT_ALTERNATION}))\`?`,
  'i',
);
const LOCATION_RE = /Location[:\s]*`?(\/[^\s`|]+)`?/i;

function isRemoteUrl(p: string): boolean {
  return p.startsWith('http://') || p.startsWith('https://');
}

function classifyPath(
  p: string,
): 'image' | 'video' | 'pdf' | 'document' | null {
  const ext = extOf(p);
  if (IMAGE_EXT_SET.has(ext)) return 'image';
  if (VIDEO_EXT_SET.has(ext)) return 'video';
  // PDF/document chips click into /files/read or /files/stream — those
  // endpoints only serve local absolute paths, so a remote URL would 403.
  // Remote URLs stay as plain markdown links; the agent's "Sources:" list
  // should render as normal hyperlinks, not as previewable document chips.
  if (isRemoteUrl(p)) return null;
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (TEXT_EXTS.has(ext)) return 'document';
  return null;
}

/**
 * Single forward pass over `text` that records, for every media-path match,
 * its end-offset. Then for each provenance comment we binary-search (linear
 * is fine in practice — paths are few) for the most recent path that ended
 * before the comment started. Avoids cloning regexes in a nested loop.
 */
function extractProvenanceByPath(
  text: string,
): Map<string, MediaProvenanceInfo> {
  const pathEnds: Array<{ end: number; path: string }> = [];
  for (const re of MEDIA_PATH_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const raw = m[1]?.replace(/[`'"]+$/, '');
      if (raw && MEDIA_EXT_RE.test(raw)) {
        pathEnds.push({
          end: (m.index ?? 0) + m[0].length,
          path: raw,
        });
      }
    }
  }
  pathEnds.sort((a, b) => a.end - b.end);

  const byPath = new Map<string, MediaProvenanceInfo>();
  for (const match of text.matchAll(PROVENANCE_COMMENT_RE)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    let parsed: MediaProvenanceInfo;
    try {
      parsed = JSON.parse(raw) as MediaProvenanceInfo;
    } catch {
      continue;
    }
    const commentStart = match.index ?? 0;
    let lastPath: string | null = null;
    for (const entry of pathEnds) {
      if (entry.end > commentStart) break;
      lastPath = entry.path;
    }
    if (lastPath && !byPath.has(lastPath)) {
      byPath.set(lastPath, parsed);
    }
  }
  return byPath;
}

interface ExtractedMedia {
  videos: MediaAsset[];
  images: MediaAsset[];
  pdfs: MediaAsset[];
  documents: MediaAsset[];
}

function emptyExtract(): ExtractedMedia {
  return { videos: [], images: [], pdfs: [], documents: [] };
}

/** Extract absolute file paths from assistant text for inline rendering. */
function extractMediaPaths(text: string | undefined): ExtractedMedia {
  if (!text) return emptyExtract();
  const provenanceByPath = extractProvenanceByPath(text);
  const out = emptyExtract();
  const seen = new Set<string>();
  const push = (p: string) => {
    if (seen.has(p)) return;
    seen.add(p);
    const asset: MediaAsset = { path: p };
    const prov = provenanceByPath.get(p);
    if (prov) asset.provenance = prov;
    switch (classifyPath(p)) {
      case 'video':
        out.videos.push(asset);
        break;
      case 'image':
        out.images.push(asset);
        break;
      case 'pdf':
        out.pdfs.push(asset);
        break;
      case 'document':
        out.documents.push(asset);
        break;
    }
  };
  for (const re of MEDIA_PATH_PATTERNS) {
    for (const m of text.matchAll(re)) {
      let p = m[1];
      if (!p || !MEDIA_EXT_RE.test(p)) continue;
      p = p.replace(/[`'"]+$/, '');
      push(p);
    }
  }

  // Also handle split "File: name.mp4" + "Location: /path/to/dir/" pattern
  const fileMatch = text.match(FILE_NAME_RE);
  const locMatch = text.match(LOCATION_RE);
  if (fileMatch && locMatch) {
    const fullPath = locMatch[1].replace(/\/+$/, '') + '/' + fileMatch[1];
    if (MEDIA_EXT_RE.test(fullPath)) push(fullPath);
  }

  return out;
}

/**
 * Extract media paths from an assistant message's own text AND its tool results.
 * Tool outputs (Write, Bash) often contain the only reference to the output file.
 */
function extractMediaFromMessage(
  displayContent: string | undefined,
  message: AGUIMessage,
  allMessages: AGUIMessage[],
): ExtractedMedia {
  const result = extractMediaPaths(displayContent);
  const mergedPaths = new Set([
    ...result.videos.map((a) => a.path),
    ...result.images.map((a) => a.path),
    ...result.pdfs.map((a) => a.path),
    ...result.documents.map((a) => a.path),
  ]);
  const mergeBucket = (bucket: MediaAsset[], next: MediaAsset[]) => {
    for (const a of next) {
      if (!mergedPaths.has(a.path)) {
        mergedPaths.add(a.path);
        bucket.push(a);
      }
    }
  };
  if (message.toolCalls) {
    for (const tc of message.toolCalls) {
      const resultMsg = allMessages.find(
        (m) => m.role === 'tool' && m.toolCallId === tc.id,
      );
      if (!resultMsg?.content) continue;
      const toolMedia = extractMediaPaths(resultMsg.content);
      mergeBucket(result.videos, toolMedia.videos);
      mergeBucket(result.images, toolMedia.images);
      mergeBucket(result.pdfs, toolMedia.pdfs);
      mergeBucket(result.documents, toolMedia.documents);
    }
  }
  return result;
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** File-writing tools whose `content` arg we render inline as a live artifact. */
const ARTIFACT_WRITE_TOOLS = new Set(['Write', 'NotebookEdit']);

/**
 * Tools that read or otherwise emit file content in their result body. We
 * pair these with the file path from `args` to render the file's content
 * inline — covers cases where the agent says "I wrote X via Bash heredoc"
 * and then `Read`s it back, or just opens an existing file to discuss it.
 */
const ARTIFACT_READ_TOOLS = new Set(['Read']);

/**
 * Strip `Read` tool's "<line> | <content>" line-number prefix that the
 * Anthropic Agent SDK injects so renderers see clean source.
 */
function stripReadLineNumbers(s: string): string {
  return s
    .split('\n')
    .map((ln) => {
      const m = ln.match(/^\s*\d+\s*\|\s?(.*)$/);
      return m ? (m[1] ?? '') : ln;
    })
    .join('\n');
}

/** Visual artifact kinds — always rendered inline regardless of size. */
const INLINE_VISUAL_KIND_BY_EXT: Record<string, InlineFileKind> = {
  svg: 'svg',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  mermaid: 'mermaid',
  mmd: 'mermaid',
};

/**
 * Code extensions that map to the `code` artifact kind. The value is the
 * Streamdown/Shiki language hint. React/JSX/TSX are deliberately routed
 * to plain code highlighting until the React kind ships (needs in-iframe
 * esbuild-wasm compile).
 */
const INLINE_CODE_LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  kt: 'kotlin',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  css: 'css',
  scss: 'scss',
};

/** Cap inline code rendering so multi-file refactors don't swamp the chat.
 *  Char count (String.length / UTF-16 code units), not byte count. */
const MAX_INLINE_CODE_CHARS = 8 * 1024;
/** Cap on visual artifacts (svg/html/markdown/mermaid) read inline so a large
 *  file doesn't synchronously block DOMPurify on the main thread. */
const MAX_INLINE_VISUAL_CHARS = 512 * 1024;

interface InlineArtifact {
  id: string;
  kind: ArtifactKind;
  content: string;
  language?: string;
  title: string;
  loading?: boolean;
}

/**
 * Match relative or basename file mentions in assistant text against the
 * task's known artifacts (populated via `useV2Artifacts`). Returns the
 * matching `Artifact` for each unique mention so we can render its content
 * inline via `<InlineFileRenderer>`. Used when the agent creates a file
 * via Bash (no Write tool fingerprint) and just refers to it in prose.
 */
function findMentionedArtifacts(
  text: string | undefined,
  allArtifacts: Artifact[],
): Array<{ artifact: Artifact; kind: InlineFileKind; language?: string }> {
  if (!text || allArtifacts.length === 0) return [];
  const seen = new Set<string>();
  const out: Array<{
    artifact: Artifact;
    kind: InlineFileKind;
    language?: string;
  }> = [];
  // Index by basename — the agent typically mentions just `output/foo.md`.
  for (const a of allArtifacts) {
    const name = a.path?.split('/').pop() ?? a.name;
    if (!name) continue;
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const visualKind = INLINE_VISUAL_KIND_BY_EXT[ext];
    const language = INLINE_CODE_LANGUAGE_BY_EXT[ext];
    if (!visualKind && !language) continue;
    // Cheap substring prefilter — skip the regex compile entirely when the
    // basename isn't even mentioned (the common case).
    if (!text.includes(name)) continue;
    // Word-boundary basename match: catches `output/foo.md`, "foo.md",
    // `\`foo.md\``, etc., but skips substrings inside other identifiers.
    const re = new RegExp(`(?<![\\w-])${escapeForRegex(name)}(?![\\w-])`);
    if (!re.test(text)) continue;
    const key = a.path ?? a.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (visualKind) {
      out.push({ artifact: a, kind: visualKind });
    } else if (language) {
      out.push({ artifact: a, kind: 'code', language });
    }
  }
  return out;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pickArtifact(
  id: string,
  filePath: string,
  content: string,
  loading = false,
): InlineArtifact | null {
  const ext = (filePath.split('.').pop() ?? '').toLowerCase();
  const title = filePath.split('/').pop() ?? filePath;
  const visualKind = INLINE_VISUAL_KIND_BY_EXT[ext];
  if (visualKind) {
    if (content.length > MAX_INLINE_VISUAL_CHARS) return null;
    return { id, kind: visualKind, content, title, loading };
  }
  const language = INLINE_CODE_LANGUAGE_BY_EXT[ext];
  if (language && content.length <= MAX_INLINE_CODE_CHARS) {
    return { id, kind: 'code', content, language, title, loading };
  }
  return null;
}

/**
 * Pull artifact-renderable file content out of a message's tool calls.
 *
 * Two sources:
 *   1. `Write` / `NotebookEdit` — content is in the tool args directly,
 *      no round-trip.
 *   2. `Read` — pair the input file_path with the matching tool-result
 *      message body. Covers the common pattern where the agent creates a
 *      file via `Bash` heredoc (no Write fingerprint) then reads it back.
 */
function extractInlineArtifacts(
  message: AGUIMessage,
  allMessages: AGUIMessage[],
): InlineArtifact[] {
  if (!message.toolCalls?.length) return [];
  const out: InlineArtifact[] = [];
  for (const tc of message.toolCalls as AGUIToolCall[]) {
    const toolName = getToolName(tc);
    const args = getToolArgs(tc);
    const filePath = (args.file_path ?? args.path ?? args.filePath) as
      | string
      | undefined;
    if (!filePath) continue;

    if (ARTIFACT_WRITE_TOOLS.has(toolName)) {
      const content = args.content as string | undefined;
      // Wait until at least some content has streamed in before rendering an
      // inline artifact. A placeholder skeleton here can get visually
      // "stuck" if the stream is paused mid-arg (e.g., agent yields for an
      // AskUserQuestion) or the user switches tasks before content arrives,
      // because CopilotKit's `agent.messages` is not reset across taskIds.
      if (typeof content !== 'string' || !content) continue;
      const isStreaming = tc.toolState?.phase === 'inProgress';
      const a = pickArtifact(tc.id, filePath, content, isStreaming);
      if (a) out.push(a);
      continue;
    }

    if (ARTIFACT_READ_TOOLS.has(toolName)) {
      const resultMsg = allMessages.find(
        (m) => m.role === 'tool' && m.toolCallId === tc.id,
      );
      if (!resultMsg?.content) continue;
      const stripped = stripReadLineNumbers(resultMsg.content);
      const a = pickArtifact(tc.id, filePath, stripped);
      if (a) out.push(a);
    }
  }
  return out;
}

function InlineArtifactPreview({ artifact }: { artifact: InlineArtifact }) {
  const wrap = (child: ReactNode) => (
    <div className="border-border/50 my-3 overflow-hidden rounded-lg border">
      <div className="text-muted-foreground bg-muted/30 border-border/50 border-b px-3 py-1.5 text-xs">
        {artifact.title}
      </div>
      {child}
    </div>
  );
  if (artifact.loading && !artifact.content) {
    return wrap(
      <div
        className="bg-muted/20 flex h-24 items-center gap-2 px-3"
        aria-busy="true"
      >
        <div className="bg-muted h-3 w-24 animate-pulse rounded" />
        <div className="bg-muted h-3 w-36 animate-pulse rounded" />
      </div>,
    );
  }
  switch (artifact.kind) {
    case 'svg':
      return wrap(
        <SvgSandbox
          svg={artifact.content}
          identity={artifact.id}
          title={artifact.title}
        />,
      );
    case 'html':
      return wrap(
        <HtmlSandbox
          html={artifact.content}
          identity={artifact.id}
          title={artifact.title}
        />,
      );
    case 'mermaid':
      return wrap(<MermaidArtifact source={artifact.content} />);
    case 'markdown':
      return wrap(<MarkdownArtifact source={artifact.content} />);
    case 'code':
      return wrap(
        <CodeArtifact source={artifact.content} language={artifact.language} />,
      );
    default:
      return null;
  }
}

function ThinkingPart({ text, label }: { text: string; label: string }) {
  return (
    <details className="border-border/50 bg-background/50 text-muted-foreground my-1 rounded border px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium select-none">
        {label}
      </summary>
      <p className="mt-2 font-mono whitespace-pre-wrap">{text}</p>
    </details>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────

export function MessageBubble({
  message,
  thinkingLabel,
  attachments,
  allMessages,
  allArtifacts,
  onSendMessage,
  onCancelTool,
}: {
  message: AGUIMessage;
  thinkingLabel: string;
  attachments?: MessageAttachment[];
  allMessages: AGUIMessage[];
  allArtifacts?: Artifact[];
  /** Callback to send a user message (used for question answers) */
  onSendMessage?: (text: string) => void;
  /** Callback to cancel a specific running tool call */
  onCancelTool?: (toolUseId: string) => void;
}) {
  // Hooks must run before any early-return — keep at top.
  const artifactsV2 = useSetting('artifactsV2');

  const isUser = message.role === 'user';
  const isReasoning = message.role === 'reasoning';
  const isAssistant = !isUser && !isReasoning && message.role !== 'tool';
  // Strip the [ATTACHED FILES...] prefix from display.
  const rawDisplayContent = message.content?.replace(
    ATTACHED_FILES_PREFIX_RE,
    '',
  );
  // Some models answer with a structured envelope
  // (```json {"type":"direct_answer","answer":"..."}```). Unwrap it to the
  // prose answer, otherwise the fenced JSON renders as a code block and the
  // reply looks empty. Mirrors MessageItem.tsx on the v1 route.
  const structuredEnvelope = isAssistant
    ? parseStructuredEnvelope(rawDisplayContent || '')
    : null;
  const displayContent =
    structuredEnvelope?.type === 'direct_answer'
      ? structuredEnvelope.answer
      : rawDisplayContent;
  const genUI = isAssistant ? parseGenUIEnvelope(displayContent) : null;
  const displayContentForArtifacts = genUI ? undefined : displayContent;
  const inlineArtifacts =
    isAssistant && artifactsV2
      ? extractInlineArtifacts(message, allMessages)
      : [];
  // Path-mention pass — for files the agent created via Bash heredoc and
  // only refers to in prose. Skipped if any toolCall already produced an
  // inline preview so we don't render the same artifact twice.
  const inlineFileMentions = useMemo(
    () =>
      isAssistant && artifactsV2 && allArtifacts && inlineArtifacts.length === 0
        ? findMentionedArtifacts(displayContentForArtifacts, allArtifacts)
        : [],
    [
      isAssistant,
      artifactsV2,
      allArtifacts,
      inlineArtifacts.length,
      displayContentForArtifacts,
    ],
  );

  if (isReasoning && message.content) {
    return <ThinkingPart text={message.content} label={thinkingLabel} />;
  }

  if (message.role === 'tool') return null;

  if (isUser) {
    return (
      <UserMessageBubble
        messageId={message.id}
        content={message.content}
        attachments={attachments}
      />
    );
  }

  // Extract media assets (path + provenance) from assistant text + tool outputs.
  const {
    videos,
    images: imagePaths,
    pdfs,
    documents,
  } = filterOutputArtifactMedia(
    extractMediaFromMessage(displayContentForArtifacts, message, allMessages),
    allArtifacts,
  );

  return (
    <div className="group relative mb-4">
      {displayContent && (
        <div>
          {genUI ? (
            <GenUIRenderer envelope={genUI} />
          ) : (
            <>
              <MarkdownProse content={displayContent} />
              <TaskV2RunSummaryChips
                message={message}
                allArtifacts={allArtifacts}
              />
              <MessageAudioButton text={displayContent} className="mt-1" />
            </>
          )}
        </div>
      )}

      {videos.map((asset) => (
        <InlineChatVideo
          key={asset.path}
          src={
            asset.path.startsWith('http')
              ? asset.path
              : `${API_BASE_URL}/files/stream?path=${encodeURIComponent(asset.path)}`
          }
          provenance={asset.provenance}
        />
      ))}

      {imagePaths.map((asset) => (
        <InlineChatImage
          key={asset.path}
          src={
            asset.path.startsWith('http')
              ? asset.path
              : `${API_BASE_URL}/files/stream?path=${encodeURIComponent(asset.path)}`
          }
          alt={asset.path.split('/').pop() ?? ''}
          provenance={asset.provenance}
        />
      ))}

      {pdfs.map((asset) => (
        <InlineChatPdf
          key={asset.path}
          src={
            asset.path.startsWith('http')
              ? asset.path
              : `${API_BASE_URL}/files/stream?path=${encodeURIComponent(asset.path)}`
          }
          name={asset.path.split('/').pop() ?? undefined}
          provenance={asset.provenance}
        />
      ))}

      {documents.map((asset) => (
        <InlineChatDocument
          key={asset.path}
          path={asset.path}
          name={asset.path.split('/').pop() ?? undefined}
          provenance={asset.provenance}
        />
      ))}

      {inlineArtifacts.map((a) => (
        <InlineArtifactPreview key={a.id} artifact={a} />
      ))}

      {inlineFileMentions.map(({ artifact, kind, language }) =>
        artifact.path ? (
          <InlineFileRenderer
            key={artifact.id}
            path={artifact.path}
            kind={kind}
            title={artifact.name}
            language={language}
          />
        ) : null,
      )}

      {/* Tool calls — grouped into collapsible section */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolCallGroup
          toolCalls={message.toolCalls}
          allMessages={allMessages}
          onSendMessage={onSendMessage}
          onCancelTool={onCancelTool}
        />
      )}
    </div>
  );
}
