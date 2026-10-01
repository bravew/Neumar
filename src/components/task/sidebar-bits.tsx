import { createElement, useCallback, useEffect, useRef, useState } from 'react';

import {
  ChevronDown,
  ChevronRight,
  Code2,
  File,
  FileCode2,
  FileEdit,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FolderSearch,
  Globe,
  Layers,
  ListTodo,
  Music,
  Presentation,
  Search,
  Table,
  Terminal,
  Type,
  Video,
  Wrench,
  X,
} from 'lucide-react';

import type { Artifact } from '@/components/artifacts';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export interface ToolUsage {
  id: string;
  name: string;
  displayName: string;
  input: unknown;
  output?: string;
  isError?: boolean;
  timestamp: number;
}

export function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'Bash':
      return Terminal;
    case 'Read':
      return FileText;
    case 'Write':
      return FileEdit;
    case 'Edit':
      return FileEdit;
    case 'Grep':
      return Search;
    case 'Glob':
      return FolderSearch;
    case 'WebFetch':
    case 'WebSearch':
      return Globe;
    case 'TodoWrite':
      return ListTodo;
    case 'Task':
      return Layers;
    case 'LSP':
      return Code2;
    default:
      return Wrench;
  }
}

export function getFileIcon(type: Artifact['type']) {
  switch (type) {
    case 'html':
    case 'jsx':
    case 'css':
    case 'code':
      return FileCode2;
    case 'json':
    case 'document':
    case 'pdf':
      return FileText;
    case 'image':
      return FileImage;
    case 'markdown':
      return FileType;
    case 'csv':
      return Table;
    case 'spreadsheet':
      return FileSpreadsheet;
    case 'presentation':
      return Presentation;
    case 'video':
      return Video;
    case 'audio':
      return Music;
    case 'font':
      return Type;
    case 'websearch':
      return Globe;
    default:
      return File;
  }
}

export function EmptyState({
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

export function CollapsibleSection({
  title,
  children,
  defaultExpanded = true,
  headerAction,
}: {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  headerAction?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const userToggledRef = useRef(false);
  useEffect(() => {
    if (defaultExpanded && !userToggledRef.current) {
      setIsExpanded(true);
    }
  }, [defaultExpanded]);
  const toggleExpanded = useCallback(() => {
    userToggledRef.current = true;
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div className="border-border/50 border-b">
      <div className="hover:bg-accent/30 flex w-full items-center justify-between px-4 py-3 transition-colors">
        <button
          onClick={toggleExpanded}
          className="flex flex-1 cursor-pointer items-center text-left"
        >
          <span className="text-foreground text-sm font-medium">{title}</span>
        </button>
        <div className="flex items-center gap-1">
          {headerAction}
          <button
            onClick={toggleExpanded}
            className="text-muted-foreground hover:text-foreground cursor-pointer p-0.5 transition-colors"
            aria-label={isExpanded ? t.task.collapse : t.task.expand}
          >
            {isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        </div>
      </div>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300',
          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function ToolPreviewModal({
  tool,
  onClose,
}: {
  tool: ToolUsage;
  onClose: () => void;
}) {
  const formatInput = (input: unknown): string => {
    if (!input) return '—';
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  };

  const formatOutput = (output: string | undefined): string => {
    if (!output) return '—';
    if (output.length > 5000) {
      return output.slice(0, 5000) + '\n\n... (truncated)';
    }
    return output;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="bg-background border-border relative flex max-h-[80vh] w-[600px] max-w-[90vw] flex-col rounded-lg border shadow-xl">
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            {createElement(getToolIcon(tool.name), {
              className: 'text-muted-foreground size-4',
            })}
            <span className="font-medium">{tool.name}</span>
            {tool.isError && (
              <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-500">
                Error
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="hover:bg-accent rounded-md p-1 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-auto p-4">
          <div>
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">
              Input
            </h3>
            <pre className="bg-muted/50 max-h-[200px] overflow-auto rounded-md p-3 text-xs break-words whitespace-pre-wrap">
              {formatInput(tool.input)}
            </pre>
          </div>
          <div>
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">
              Output
            </h3>
            <pre
              className={cn(
                'max-h-[300px] overflow-auto rounded-md p-3 text-xs break-words whitespace-pre-wrap',
                tool.isError ? 'bg-red-500/10 text-red-400' : 'bg-muted/50',
              )}
            >
              {formatOutput(tool.output)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
