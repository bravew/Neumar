import { useMemo } from 'react';

import {
  AlertTriangle,
  Cpu,
  FileOutput,
  Layers,
  Palette,
  Plug,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import type { Artifact } from '@/components/artifacts/types';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { summarizeFileOperations } from '@/shared/utils/file-operation-summary';

import {
  getToolArgs,
  getToolName,
  type AGUIMessage,
  type AGUIToolCall,
} from './TaskV2MessageBubble.types';

const CHIP_LIMIT = 8;
const FILENAME_MAX_LENGTH = 32;

type TaskTranslations = ReturnType<typeof useLanguage>['t']['task'];

interface RunChip {
  id: string;
  label: string;
  title?: string;
  icon: LucideIcon;
  tone?: 'default' | 'warning';
}

interface MessageRunFields {
  model?: string;
  provider?: string;
  runtime?: string;
  profile?: string;
}

export function TaskV2RunSummaryChips({
  message,
  allArtifacts,
}: {
  message: AGUIMessage;
  allArtifacts?: Artifact[];
}) {
  const { t } = useLanguage();
  const chips = useMemo(
    () => buildRunSummaryChips(message, allArtifacts, t.task),
    [message, allArtifacts, t.task],
  );
  if (chips.length === 0) return null;

  return (
    <div
      className="not-prose mt-2 flex flex-wrap gap-1.5"
      aria-label={t.task.runSummaryLabel}
    >
      {chips.slice(0, CHIP_LIMIT).map((chip) => {
        const Icon = chip.icon;
        return (
          <span
            key={chip.id}
            title={chip.title ?? chip.label}
            className={cn(
              'border-border bg-muted/45 text-muted-foreground inline-flex h-6 max-w-full items-center gap-1 rounded-md border px-2 text-[11px] leading-none',
              chip.tone === 'warning' &&
                'border-destructive/30 bg-destructive/10 text-destructive',
            )}
          >
            <Icon className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{chip.label}</span>
          </span>
        );
      })}
    </div>
  );
}

function buildRunSummaryChips(
  message: AGUIMessage,
  allArtifacts: Artifact[] | undefined,
  t: TaskTranslations,
): RunChip[] {
  const chips: RunChip[] = [];
  const runFields = message as AGUIMessage & MessageRunFields;
  const toolCalls = message.toolCalls ?? [];
  const mcpServers = extractMcpServers(toolCalls);
  const filePaths = extractRunFilePaths(toolCalls, allArtifacts);
  const contextLabels = extractContextLabels(message.content, t);

  addTextChip(chips, 'provider', runFields.provider, t.runSummaryProvider, Cpu);
  addTextChip(chips, 'model', runFields.model, t.runSummaryModel, Cpu);
  addTextChip(
    chips,
    'runtime',
    runFields.runtime ?? runFields.profile,
    t.runSummaryRuntime,
    Layers,
  );

  if (toolCalls.length > 0) {
    chips.push({
      id: 'tools',
      label: `${t.runSummaryTools} ${toolCalls.length}`,
      icon: Wrench,
    });
  }

  if (mcpServers.length > 0) {
    chips.push({
      id: 'mcp',
      label:
        mcpServers.length === 1
          ? `${t.runSummaryMcp} ${mcpServers[0]}`
          : `${t.runSummaryMcp} ${mcpServers.length}`,
      title: mcpServers.join(', '),
      icon: Plug,
    });
  }

  if (filePaths.length > 0) {
    const firstFile = formatFilename(filePaths[0]);
    chips.push({
      id: 'files',
      label:
        filePaths.length === 1
          ? `${t.runSummaryFile} ${firstFile}`
          : `${t.runSummaryFiles} ${firstFile} +${filePaths.length - 1}`,
      title: filePaths.join('\n'),
      icon: FileOutput,
    });
  }

  for (const label of contextLabels) {
    chips.push({
      id: `context-${label.toLowerCase().replace(/\s+/g, '-')}`,
      label,
      icon: Palette,
    });
  }

  if (isRecoveryMessage(message)) {
    chips.push({
      id: 'recovery',
      label: t.runSummaryRecovery,
      icon: AlertTriangle,
      tone: 'warning',
    });
  }

  return chips;
}

function addTextChip(
  chips: RunChip[],
  id: string,
  value: string | undefined,
  label: string,
  icon: LucideIcon,
) {
  const trimmed = value?.trim();
  if (!trimmed) return;
  chips.push({
    id,
    label: `${label} ${trimmed}`,
    icon,
  });
}

function extractMcpServers(toolCalls: AGUIToolCall[]): string[] {
  const servers = new Set<string>();
  for (const toolCall of toolCalls) {
    const toolName = getToolName(toolCall);
    if (!toolName.startsWith('mcp__')) continue;
    const serverName = toolName.split('__')[1];
    if (serverName) servers.add(serverName);
  }
  return [...servers];
}

function extractRunFilePaths(
  toolCalls: AGUIToolCall[],
  allArtifacts?: Artifact[],
): string[] {
  const artifactPaths = new Set<string>();
  const toolIds = new Set(toolCalls.map((toolCall) => toolCall.id));

  for (const artifact of allArtifacts ?? []) {
    if (artifact.path && artifact.sourceToolCallId) {
      if (toolIds.has(artifact.sourceToolCallId))
        artifactPaths.add(artifact.path);
    }
  }

  const summary = summarizeFileOperations(
    toolCalls.map((toolCall) => ({
      name: getToolName(toolCall),
      args: getToolArgs(toolCall),
    })),
  );
  const referencedPaths = new Set(summary.referencedPaths);
  return [
    ...new Set([
      ...summary.producedFiles.map((file) => file.path),
      ...[...artifactPaths].filter((path) => !referencedPaths.has(path)),
    ]),
  ];
}

function extractContextLabels(
  content: string | undefined,
  t: TaskTranslations,
): string[] {
  const labels: string[] = [];
  const text = content ?? '';
  const mentionsContextPack = /\bcontext packs?\b/i.test(text);
  if (mentionsContextPack && /\bfigma\b/i.test(text)) {
    labels.push(t.runSummaryFigma);
  }
  if (mentionsContextPack && /\bcode\s+connect\b/i.test(text)) {
    labels.push(t.runSummaryCodeConnect);
  }
  if (mentionsContextPack && /\b(?:dtcg|design token|tokens?)\b/i.test(text)) {
    labels.push(t.runSummaryTokens);
  }
  if (/\bdesign system\b/i.test(text)) labels.push(t.runSummaryDesignSystem);
  if (mentionsContextPack && labels.length === 0) {
    labels.push(t.runSummaryContext);
  }
  return [...new Set(labels)];
}

function isRecoveryMessage(message: AGUIMessage): boolean {
  const subtype = message.subtype?.toLowerCase() ?? '';
  return (
    message.isError === true ||
    subtype.includes('run_error') ||
    subtype.includes('recovery') ||
    subtype.includes('error')
  );
}

function formatFilename(path: string) {
  const name = path.split(/[\\/]/).pop() || path;
  if (name.length <= FILENAME_MAX_LENGTH) return name;
  return `${name.slice(0, FILENAME_MAX_LENGTH - 3)}...`;
}
