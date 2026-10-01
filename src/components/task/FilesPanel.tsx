import { useState } from 'react';

import { FolderOpen } from 'lucide-react';

import type { Artifact } from '@/components/artifacts';
import { toDisplayPath } from '@/shared/lib/toDisplayPath';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { WorkingFile } from './FileTreeItem';
import { CollapsibleSection, getFileIcon } from './sidebar-bits';
import { WorkspaceFilesSection } from './WorkspaceFilesSection';

export function FilesPanel({
  outputArtifacts,
  remainingArtifacts,
  selectedArtifact,
  onSelectArtifact,
  outputFolderDir,
  handleOpenFolder,
  hasWorkspaceContent,
  outputExpanded,
  setOutputExpanded,
  editedExpanded,
  setEditedExpanded,
  effectiveWorkingDir,
  loadingFiles,
  workingDirError,
  workingFiles,
  externalFolders,
  onSelectWorkingFile,
  activeFileLoadRef,
  getFolderName,
}: {
  outputArtifacts: Artifact[];
  remainingArtifacts: Artifact[];
  selectedArtifact: Artifact | null;
  onSelectArtifact: (artifact: Artifact) => void;
  outputFolderDir: string | null;
  handleOpenFolder: (folderPath: string) => void;
  hasWorkspaceContent: boolean;
  outputExpanded: boolean;
  setOutputExpanded: (expanded: boolean) => void;
  editedExpanded: boolean;
  setEditedExpanded: (expanded: boolean) => void;
  effectiveWorkingDir?: string;
  loadingFiles: boolean;
  workingDirError: string | null;
  workingFiles: WorkingFile[];
  externalFolders: string[];
  onSelectWorkingFile?: (file: WorkingFile) => void;
  activeFileLoadRef: { current: AbortController | null };
  getFolderName: (path: string) => string;
}) {
  const { t, tt } = useLanguage();
  const [showAllArtifacts, setShowAllArtifacts] = useState(false);
  const visibleArtifacts = showAllArtifacts
    ? remainingArtifacts
    : remainingArtifacts.slice(0, 10);
  const hasMoreArtifacts = remainingArtifacts.length > 10;

  const artifactLabel = (artifact: Artifact) =>
    toDisplayPath(artifact.path || artifact.name, effectiveWorkingDir);

  return (
    <>
      {outputArtifacts.length > 0 && (
        <CollapsibleSection
          title={t.task.output}
          defaultExpanded={true}
          headerAction={
            outputFolderDir ? (
              <button
                onClick={() => handleOpenFolder(outputFolderDir)}
                className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
                title={t.task.openInFinder}
                aria-label={t.task.openInFinder}
              >
                <FolderOpen className="size-3.5" />
              </button>
            ) : null
          }
        >
          <div className="space-y-1">
            {outputArtifacts.map((artifact) => {
              const IconComponent = getFileIcon(artifact.type);
              const isSelected = selectedArtifact?.id === artifact.id;
              const label = artifactLabel(artifact);
              return (
                <button
                  key={artifact.id}
                  onClick={() => onSelectArtifact(artifact)}
                  title={artifact.path || artifact.name}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors',
                    isSelected ? 'bg-accent/60' : 'hover:bg-accent/30',
                  )}
                >
                  <IconComponent
                    className={cn(
                      'size-3.5 shrink-0',
                      isSelected
                        ? 'text-foreground/70'
                        : 'text-muted-foreground/60',
                    )}
                  />
                  <span
                    className={cn(
                      'truncate text-sm',
                      isSelected ? 'text-foreground' : 'text-foreground/80',
                    )}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      <div className="border-border/50 border-b px-4 py-3">
        <WorkspaceFilesSection
          outputExpanded={outputExpanded}
          setOutputExpanded={setOutputExpanded}
          editedExpanded={editedExpanded}
          setEditedExpanded={setEditedExpanded}
          effectiveWorkingDir={effectiveWorkingDir}
          loadingFiles={loadingFiles}
          workingDirError={workingDirError}
          workingFiles={workingFiles}
          externalFolders={externalFolders}
          onSelectWorkingFile={onSelectWorkingFile}
          onSelectArtifact={onSelectArtifact}
          activeFileLoadRef={activeFileLoadRef}
          handleOpenFolder={handleOpenFolder}
          getFolderName={getFolderName}
        />
      </div>

      {remainingArtifacts.length > 0 && (
        <CollapsibleSection
          title={t.task.editedFolders}
          defaultExpanded={hasWorkspaceContent}
        >
          <>
            <div
              className={cn(
                'mt-2 space-y-1',
                showAllArtifacts && 'max-h-[300px] overflow-y-auto',
              )}
            >
              {visibleArtifacts.map((artifact) => {
                const IconComponent = getFileIcon(artifact.type);
                const isSelected = selectedArtifact?.id === artifact.id;
                return (
                  <button
                    key={artifact.id}
                    onClick={() => onSelectArtifact(artifact)}
                    title={artifact.path || artifact.name}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors',
                      isSelected ? 'bg-accent/60' : 'hover:bg-accent/30',
                    )}
                  >
                    <IconComponent
                      className={cn(
                        'size-3.5 shrink-0',
                        isSelected
                          ? 'text-foreground/70'
                          : 'text-muted-foreground/60',
                      )}
                    />
                    <span
                      className={cn(
                        'truncate text-sm',
                        isSelected ? 'text-foreground' : 'text-foreground/80',
                      )}
                    >
                      {artifactLabel(artifact)}
                    </span>
                  </button>
                );
              })}
            </div>
            {hasMoreArtifacts && (
              <button
                onClick={() => setShowAllArtifacts(!showAllArtifacts)}
                className="text-muted-foreground hover:text-foreground w-full py-2 text-center text-xs transition-colors"
              >
                {showAllArtifacts
                  ? t.common.showLess
                  : tt('common.showMoreCount', {
                      count: remainingArtifacts.length - 10,
                    })}
              </button>
            )}
          </>
        </CollapsibleSection>
      )}
    </>
  );
}
