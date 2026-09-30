import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Folder,
  FolderOpen,
} from 'lucide-react';

import type { Artifact } from '@/components/artifacts';
import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import { useLanguage } from '@/shared/providers/language-provider';

import { FileTreeItem, type WorkingFile } from './FileTreeItem';

function WorkspaceEmptyState({
  icon: Icon,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}) {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="bg-muted/30 rounded p-1.5">
        <Icon className="text-muted-foreground/40 size-3.5" />
      </div>
      <p className="text-muted-foreground/60 text-xs">{description}</p>
    </div>
  );
}

interface WorkspaceFilesSectionProps {
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
  onSelectArtifact: (artifact: Artifact) => void;
  activeFileLoadRef: React.MutableRefObject<AbortController | null>;
  handleOpenFolder: (folderPath: string) => void;
  getFolderName: (path: string) => string;
}

export function WorkspaceFilesSection({
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
  onSelectArtifact,
  activeFileLoadRef,
  handleOpenFolder,
  getFolderName,
}: WorkspaceFilesSectionProps) {
  const { t } = useLanguage();
  return (
    <>
      {/* Output folder subsection */}
      <div className="mt-1 mb-3">
        <div className="mb-1 flex items-center gap-1">
          <button
            onClick={() => setOutputExpanded(!outputExpanded)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            {outputExpanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            <span className="text-xs font-medium">
              {t.task.outputFolder || 'Output'}
            </span>
          </button>
          {effectiveWorkingDir && (
            <button
              onClick={() => handleOpenFolder(effectiveWorkingDir)}
              className="text-muted-foreground hover:text-foreground ml-auto p-0.5 transition-colors"
              title={t.task.openInFinder}
            >
              <ExternalLink className="size-3" />
            </button>
          )}
        </div>
        {outputExpanded && (
          <>
            {!effectiveWorkingDir ? (
              <p className="text-muted-foreground py-1 text-sm">
                {t.task.waitingForTask}
              </p>
            ) : loadingFiles ? (
              <div className="text-muted-foreground flex items-center gap-2 py-1">
                <AILoadingIndicator size="sm" />
                <span className="text-sm">{t.common.loading}</span>
              </div>
            ) : workingDirError ? (
              <div className="flex items-start gap-2 rounded-md bg-red-500/10 px-2 py-2">
                <svg
                  viewBox="0 0 16 16"
                  className="mt-0.5 size-3.5 shrink-0 text-red-500"
                  fill="currentColor"
                >
                  <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4.5a1 1 0 112 0v3a1 1 0 11-2 0v-3zm1 7a1 1 0 100-2 1 1 0 000 2z" />
                </svg>
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {workingDirError.includes('EACCES') ||
                    workingDirError.includes('permission')
                      ? t.task.permissionDenied
                      : t.task.failedToLoadWorkspace}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {workingDirError}
                  </p>
                </div>
              </div>
            ) : workingFiles.length === 0 ? (
              <WorkspaceEmptyState
                icon={Folder}
                description={t.task.outputsDesc}
              />
            ) : (
              <div className="max-h-[200px] space-y-0.5 overflow-y-auto">
                {workingFiles.map((file) => (
                  <FileTreeItem
                    key={file.path}
                    file={file}
                    sessionRoot={effectiveWorkingDir}
                    onSelectFile={onSelectWorkingFile}
                    onSelectArtifact={onSelectArtifact}
                    activeFileLoadRef={activeFileLoadRef}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Edited folders subsection */}
      {externalFolders.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1">
            <button
              onClick={() => setEditedExpanded(!editedExpanded)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              {editedExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              <span className="text-xs font-medium">
                {t.task.editedFolders || 'Edited'}
              </span>
            </button>
          </div>
          {editedExpanded && (
            <div className="space-y-0.5">
              {externalFolders.map((folder) => (
                <button
                  key={folder}
                  onClick={() => handleOpenFolder(folder)}
                  className="hover:bg-accent/50 flex w-full items-center gap-1.5 rounded-md py-1 text-left transition-colors"
                >
                  <span className="size-4 shrink-0" />
                  <FolderOpen className="text-muted-foreground/60 size-3.5 shrink-0" />
                  <span className="text-foreground/80 truncate text-sm">
                    {getFolderName(folder)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
