import { useState } from 'react';

import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';

import { getArtifactTypeFromExt, type Artifact } from '@/components/artifacts';
import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import { toDisplayPath } from '@/shared/lib/toDisplayPath';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  MAX_TEXT_FILE_SIZE,
  SKIP_CONTENT_TYPES,
  checkFileSize,
  readFileContent,
} from './workspaceFileContent';
import { getFileIconByExt } from './workspaceFileIcons';

export interface WorkingFile {
  name: string;
  path: string;
  isDir: boolean;
  children?: WorkingFile[];
  isExpanded?: boolean;
}

export function FileTreeItem({
  file,
  depth = 0,
  sessionRoot,
  onSelectFile,
  onSelectArtifact,
  activeFileLoadRef,
}: {
  file: WorkingFile;
  depth?: number;
  sessionRoot?: string;
  onSelectFile?: (file: WorkingFile) => void;
  onSelectArtifact: (artifact: Artifact) => void;
  activeFileLoadRef: React.MutableRefObject<AbortController | null>;
}) {
  const { t } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(file.isExpanded ?? false);
  const displayPath = toDisplayPath(file.path, sessionRoot);
  const [isLoading, setIsLoading] = useState(false);
  const ext = file.name.split('.').pop()?.toLowerCase();
  const IconComponent = file.isDir ? FolderOpen : getFileIconByExt(ext);

  const handleClick = async () => {
    if (file.isDir) {
      setIsExpanded(!isExpanded);
    } else if (onSelectFile) {
      onSelectFile(file);
    } else {
      const artifactType = getArtifactTypeFromExt(ext);

      // For binary/streaming files, don't read content - just pass the path
      if (SKIP_CONTENT_TYPES.includes(artifactType)) {
        const artifact: Artifact = {
          id: file.path,
          name: file.name,
          type: artifactType,
          path: file.path,
        };
        onSelectArtifact(artifact);
        return;
      }

      // Cancel any previous file loading operation
      if (activeFileLoadRef.current) {
        activeFileLoadRef.current.abort();
      }

      // Create new AbortController for this operation
      const controller = new AbortController();
      activeFileLoadRef.current = controller;

      // For text-based files, check size first then load content
      setIsLoading(true);
      try {
        // Check file size first
        const fileSize = await checkFileSize(file.path, controller.signal);

        // If aborted during size check, exit
        if (controller.signal.aborted) {
          setIsLoading(false);
          return;
        }

        // If file is too large, don't read content
        if (fileSize !== null && fileSize > MAX_TEXT_FILE_SIZE) {
          const artifact: Artifact = {
            id: file.path,
            name: file.name,
            type: artifactType,
            path: file.path,
            fileSize: fileSize,
            fileTooLarge: true,
          };
          onSelectArtifact(artifact);
          setIsLoading(false);
          return;
        }

        // Read content with abort signal
        const content = await readFileContent(file.path, controller.signal);

        // If aborted during content read, exit
        if (controller.signal.aborted) {
          setIsLoading(false);
          return;
        }

        const artifact: Artifact = {
          id: file.path,
          name: file.name,
          type: artifactType,
          path: file.path,
          content: content || undefined,
          fileSize: fileSize || undefined,
        };
        onSelectArtifact(artifact);
      } finally {
        // Only clear loading if this is still the active controller
        if (activeFileLoadRef.current === controller) {
          setIsLoading(false);
          activeFileLoadRef.current = null;
        }
      }
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={isLoading}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 text-left transition-colors',
          'hover:bg-accent/50',
          isLoading && 'opacity-70',
        )}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        <span className="text-muted-foreground/50 flex size-4 shrink-0 items-center justify-center">
          {file.isDir ? (
            isExpanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )
          ) : null}
        </span>
        {isLoading ? (
          <AILoadingIndicator size="sm" />
        ) : (
          <IconComponent className="text-muted-foreground/60 size-3.5 shrink-0" />
        )}
        <span className="text-foreground/80 truncate text-sm" title={file.path}>
          {file.isDir ? file.name : displayPath}
        </span>
        {!file.isDir && (
          <span
            role="button"
            tabIndex={0}
            className="text-muted-foreground hover:text-foreground ml-auto shrink-0 px-1 text-xs opacity-0 group-hover:opacity-100"
            title={file.path}
            aria-label={t.task.copyPath}
            onClick={(event) => {
              event.stopPropagation();
              void navigator.clipboard.writeText(file.path);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              void navigator.clipboard.writeText(file.path);
            }}
          >
            {t.task.copyPath}
          </span>
        )}
      </button>
      {file.isDir && isExpanded && file.children && (
        <div>
          {file.children.map((child) => (
            <FileTreeItem
              key={child.path}
              file={child}
              depth={depth + 1}
              sessionRoot={sessionRoot}
              onSelectFile={onSelectFile}
              onSelectArtifact={onSelectArtifact}
              activeFileLoadRef={activeFileLoadRef}
            />
          ))}
        </div>
      )}
    </div>
  );
}
