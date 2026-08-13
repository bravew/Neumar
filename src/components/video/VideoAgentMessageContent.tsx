import { useMemo } from 'react';

import { Check } from 'lucide-react';

import { MarkdownProse } from '@/components/task/TaskV2MarkdownProse';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';
import { extractPreviewUrls } from '@/shared/video/link-preview';

import { filenameFromPath } from './assets/ProjectAssetTile';
import { ExternalLinkPreviews } from './ExternalLinkPreviews';
import { InlineAssetPreview } from './VideoAgentInlineAsset';

type ProjectAsset = VideoProject['assets'][number];

interface VideoAgentMessageContentProps {
  content: string;
  project: VideoProject;
  streaming?: boolean;
  /**
   * When true (last assistant message + streaming complete), surface
   * heuristic Yes/No quick replies for yes/no questions. Suppressed on
   * earlier turns so the chat doesn't accumulate stale buttons.
   */
  surfaceQuickReplies?: boolean;
  /**
   * Texts the user has already sent in this conversation. An action chip whose
   * `send://` payload is in this set renders as already-clicked and disabled,
   * so the "used" state survives a page reload (it's derived from the persisted
   * user messages, not transient component state).
   */
  usedActionTexts?: ReadonlySet<string>;
  onPreview?: (asset: ProjectAsset) => void;
  /** Send a follow-up message — wired to AgentDock's `send`. */
  onSend?: (text: string) => void;
}

interface ActionChip {
  label: string;
  text: string;
}

// `[label](send://text)` markdown link → click-to-send action chip. The agent
// is instructed to use this syntax for any "Shall I..."/"Want me to..."
// prompt so the UI can render real buttons instead of free-form prose.
const ACTION_LINK_RE = /\[([^\]]+)\]\(send:\/\/([^)]+)\)/g;
const YES_NO_QUESTION_RE =
  /(?:\bshall\s+I\b|\bdo\s+you\s+want\b|\bshould\s+I\b|\bwant\s+me\s+to\b|\bproceed\b|\bgo\s+ahead\b)[^\n]*\?\s*$/i;

// Absolute filesystem path with a media-ish extension. The path is mid-string
// so backticks, markdown image syntax, and bullet lines all match the same
// way the asset-ingest hook on the server matches `File: /path`.
const PATH_RE =
  /\/[^\s"`)<>]+\.(?:png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a|flac|ogg)/gi;

/**
 * Renders an agent text message as markdown, plus inline media previews for
 * any registered project asset paths it references. Raw paths and matching
 * markdown image lines are stripped from the prose so the chat reads as a
 * caption above the preview cards.
 */
export function VideoAgentMessageContent({
  content,
  project,
  streaming,
  surfaceQuickReplies,
  usedActionTexts,
  onPreview,
  onSend,
}: VideoAgentMessageContentProps) {
  const { cleaned, actions } = useMemo(
    () => extractActionChips(content),
    [content],
  );
  const { cleaned: prose, assets } = useMemo(
    () => extractInlineAssets(cleaned, project.assets),
    [cleaned, project.assets],
  );
  const previewUrls = useMemo(() => extractPreviewUrls(prose), [prose]);

  const { t } = useLanguage();
  const quickReplies = useMemo<ActionChip[]>(() => {
    if (!surfaceQuickReplies) return [];
    if (actions.length > 0) return [];
    if (!YES_NO_QUESTION_RE.test(prose)) return [];
    const labels = t.video.editor.agentDock.quickReplies;
    return [
      { label: labels.yesLabel, text: labels.yesText },
      { label: labels.noLabel, text: labels.noText },
    ];
  }, [
    actions.length,
    prose,
    surfaceQuickReplies,
    t.video.editor.agentDock.quickReplies,
  ]);

  const sendable = !streaming && Boolean(onSend);

  return (
    <div className="space-y-2">
      {prose.trim() ? (
        <MarkdownProse content={prose} animated={streaming} />
      ) : null}
      {assets.length > 0 ? (
        <div className="space-y-2">
          {assets.map((asset) => (
            <InlineAssetPreview
              key={asset.id}
              projectId={project.id}
              asset={asset}
              onPreview={onPreview}
            />
          ))}
        </div>
      ) : null}
      <ExternalLinkPreviews urls={previewUrls} enabled={!streaming} />
      {actions.length > 0 || quickReplies.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {actions.map((chip, index) => (
            <ActionChipButton
              key={`a-${index}`}
              chip={chip}
              disabled={!sendable}
              used={usedActionTexts?.has(chip.text) ?? false}
              variant="primary"
              onSend={onSend}
            />
          ))}
          {quickReplies.map((chip, index) => (
            <ActionChipButton
              key={`q-${index}`}
              chip={chip}
              disabled={!sendable}
              used={usedActionTexts?.has(chip.text) ?? false}
              variant="secondary"
              onSend={onSend}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActionChipButton({
  chip,
  disabled,
  used,
  variant,
  onSend,
}: {
  chip: ActionChip;
  disabled: boolean;
  used: boolean;
  variant: 'primary' | 'secondary';
  onSend?: (text: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || used}
      aria-pressed={used}
      onClick={() => onSend?.(chip.text)}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        used
          ? 'bg-muted text-muted-foreground border-border cursor-default border'
          : variant === 'primary'
            ? 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
            : 'border-border bg-background text-foreground hover:bg-accent border disabled:opacity-50',
      )}
    >
      {used ? <Check className="size-3 shrink-0" aria-hidden="true" /> : null}
      {chip.label}
    </button>
  );
}

export function extractActionChips(content: string): {
  cleaned: string;
  actions: ActionChip[];
} {
  const actions: ActionChip[] = [];
  const cleaned = content.replace(ACTION_LINK_RE, (_match, label, text) => {
    actions.push({
      label: String(label).trim(),
      text: String(text).trim(),
    });
    return '';
  });
  return { cleaned, actions };
}

export function extractInlineAssets(
  content: string,
  assets: ProjectAsset[],
): { cleaned: string; assets: ProjectAsset[] } {
  if (assets.length === 0) return { cleaned: content, assets: [] };

  const byPath = new Map<string, ProjectAsset>();
  const byBasename = new Map<string, ProjectAsset>();
  for (const asset of assets) {
    byPath.set(asset.path, asset);
    byBasename.set(filenameFromPath(asset.path), asset);
  }

  const matchedIds = new Set<string>();
  const matched: ProjectAsset[] = [];

  let cleaned = content;
  for (const match of content.matchAll(PATH_RE)) {
    const found =
      byPath.get(match[0]) ?? byBasename.get(filenameFromPath(match[0]));
    if (!found) continue;
    if (!matchedIds.has(found.id)) {
      matchedIds.add(found.id);
      matched.push(found);
    }
  }

  if (matched.length === 0) return { cleaned, assets: [] };

  // Strip the now-redundant scaffolding so the preview card carries the
  // payload and the prose stays a clean caption:
  //   - Markdown image lines:  `![alt](file:///path or /path)`
  //   - Standalone `**File:**` / `File:` lines that the media MCP emits.
  //   - Bare path tokens inside backticks or parens.
  cleaned = cleaned
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/^\s*\*?\*?File:\*?\*?\s*`?[^\n`]+`?\s*$/gim, '')
    .replace(PATH_RE, '')
    // Tidy: collapse 3+ newlines to 2, strip leftover backticks/parens
    // wrapping the path we just removed.
    .replace(/``+/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { cleaned, assets: matched };
}
