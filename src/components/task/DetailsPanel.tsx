import { useState } from 'react';

import { Sparkles, Wrench } from 'lucide-react';

import type { Artifact } from '@/components/artifacts';
import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import type { TraceSummary } from '@/shared/hooks/useTraceStream';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { DocumentPanel } from './DocumentPanel';
import { FileDiffViewer } from './FileDiffViewer';
import { FileTreeItem, type WorkingFile } from './FileTreeItem';
import {
  CollapsibleSection,
  EmptyState,
  getToolIcon,
  ToolPreviewModal,
  type ToolUsage,
} from './sidebar-bits';
import { TraceMetricsSummary } from './trace/TraceMetricsSummary';

const DEFAULT_VISIBLE_COUNT = 5;

export function DetailsPanel({
  mcpTools,
  taskId,
  filesVersion,
  focusPath,
  traceSummary,
  isRunning,
  loadingSkills,
  usedSkillNames,
  skillsDirs,
  effectiveWorkingDir,
  onSelectWorkingFile,
  onSelectArtifact,
  activeFileLoadRef,
}: {
  mcpTools: ToolUsage[];
  taskId?: string;
  filesVersion: number;
  focusPath?: string;
  traceSummary: TraceSummary;
  isRunning: boolean;
  loadingSkills: boolean;
  usedSkillNames: Set<string>;
  skillsDirs: { name: string; files: WorkingFile[] }[];
  effectiveWorkingDir?: string;
  onSelectWorkingFile?: (file: WorkingFile) => void;
  onSelectArtifact: (artifact: Artifact) => void;
  activeFileLoadRef: { current: AbortController | null };
}) {
  const { t, tt } = useLanguage();
  const [showAllTools, setShowAllTools] = useState(false);
  const [selectedTool, setSelectedTool] = useState<ToolUsage | null>(null);
  const visibleTools = showAllTools
    ? mcpTools
    : mcpTools.slice(0, DEFAULT_VISIBLE_COUNT);
  const hasMoreTools = mcpTools.length > DEFAULT_VISIBLE_COUNT;

  return (
    <>
      <CollapsibleSection title={t.task.tools} defaultExpanded={false}>
        {mcpTools.length === 0 ? (
          <EmptyState icon={Wrench} description={t.task.noTools} />
        ) : (
          <>
            <div
              className={cn(
                'space-y-1',
                showAllTools && 'max-h-[300px] overflow-y-auto',
              )}
            >
              {visibleTools.map((tool) => {
                const IconComponent = getToolIcon(tool.name);
                return (
                  <button
                    key={tool.id}
                    onClick={() => setSelectedTool(tool)}
                    className={cn(
                      'group flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 text-left transition-colors',
                      'hover:bg-accent/50',
                      tool.isError && 'text-red-400',
                    )}
                  >
                    <IconComponent
                      className={cn(
                        'size-3.5 shrink-0',
                        tool.isError
                          ? 'text-red-400'
                          : 'text-muted-foreground/60',
                      )}
                    />
                    <span className="text-foreground/80 truncate text-sm">
                      {tool.displayName}
                    </span>
                    {tool.isError && (
                      <span className="shrink-0 rounded bg-red-500/10 px-1 py-0.5 text-[10px] text-red-500">
                        {t.task.error}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {hasMoreTools && (
              <button
                onClick={() => setShowAllTools(!showAllTools)}
                className="text-muted-foreground hover:text-foreground w-full py-2 text-center text-xs transition-colors"
              >
                {showAllTools
                  ? t.common.showLess
                  : tt('common.showMoreCount', {
                      count: mcpTools.length - DEFAULT_VISIBLE_COUNT,
                    })}
              </button>
            )}
          </>
        )}
      </CollapsibleSection>

      {taskId && (
        <CollapsibleSection
          title={t.task.changes ?? 'Changes'}
          defaultExpanded={Boolean(focusPath)}
        >
          <FileDiffViewer
            taskId={taskId}
            version={filesVersion}
            focusPath={focusPath}
          />
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title={t.task.trace ?? 'Trace'}
        defaultExpanded={false}
      >
        <TraceMetricsSummary summary={traceSummary} isLive={isRunning} />
      </CollapsibleSection>

      {taskId && (
        <CollapsibleSection
          title={
            ((t.task as Record<string, unknown>).documents as string) ??
            'Documents'
          }
          defaultExpanded={false}
        >
          <DocumentPanel taskId={taskId} />
        </CollapsibleSection>
      )}

      <CollapsibleSection title={t.task.skills} defaultExpanded={false}>
        {loadingSkills ? (
          <div className="text-muted-foreground flex items-center gap-2 py-2">
            <AILoadingIndicator size="sm" />
            <span className="text-sm">{t.common.loading}</span>
          </div>
        ) : usedSkillNames.size === 0 ? (
          <EmptyState icon={Sparkles} description={t.task.noSkills} />
        ) : skillsDirs.length === 0 ? (
          <div className="max-h-[300px] space-y-1 overflow-y-auto">
            {Array.from(usedSkillNames).map((skillName) => (
              <div
                key={skillName}
                className="flex items-center gap-2 rounded-md px-2 py-1.5"
              >
                <Sparkles className="text-muted-foreground/60 size-3.5 shrink-0" />
                <span className="text-foreground/80 truncate text-sm">
                  {skillName}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="max-h-[300px] space-y-0.5 overflow-y-auto">
            {skillsDirs.map((dir) => (
              <div key={dir.name}>
                {dir.files.map((file) => (
                  <FileTreeItem
                    key={file.path}
                    file={{ ...file, isExpanded: false }}
                    sessionRoot={effectiveWorkingDir}
                    onSelectFile={onSelectWorkingFile}
                    onSelectArtifact={onSelectArtifact}
                    activeFileLoadRef={activeFileLoadRef}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {selectedTool && (
        <ToolPreviewModal
          tool={selectedTool}
          onClose={() => setSelectedTool(null)}
        />
      )}
    </>
  );
}
