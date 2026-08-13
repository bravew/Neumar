import { useMemo, useState } from 'react';

import { FileText, Search } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignFileEntry } from '@/shared/types/design-mode';

export function QuickFileSwitcher({
  open,
  onOpenChange,
  files,
  onOpenFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: DesignFileEntry[];
  onOpenFile: (path: string) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const matches = useMemo(
    () => rankFiles(files, query).slice(0, 30),
    [files, query],
  );

  const openPath = (path: string) => {
    onOpenFile(path);
    onOpenChange(false);
    setQuery('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>{t.design.quickFileSwitcher}</DialogTitle>
          <DialogDescription>
            {t.design.quickFileSwitcherDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Search className="text-muted-foreground size-4" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matches[0]) {
                event.preventDefault();
                openPath(matches[0].path);
              }
            }}
            placeholder={t.design.quickFileSwitcherPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <div className="max-h-[420px] overflow-auto p-2">
          {matches.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">
              {t.design.quickFileSwitcherEmpty}
            </p>
          ) : (
            <ol className="space-y-1">
              {matches.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm"
                    onClick={() => openPath(file.path)}
                  >
                    <FileText className="text-muted-foreground size-4 shrink-0" />
                    <span className="min-w-0 truncate">{file.path}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function rankFiles(files: DesignFileEntry[], query: string) {
  const q = query.trim().toLowerCase();
  const fileOnly = files.filter((file) => !file.isDir);
  if (!q) return fileOnly;
  return fileOnly
    .map((file) => ({
      file,
      score: scorePath(file.path.toLowerCase(), q),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .map((item) => item.file);
}

function scorePath(path: string, query: string) {
  if (path === query) return 1000;
  if (path.endsWith(`/${query}`)) return 800;
  if (path.includes(query)) return 500 - path.indexOf(query);
  let qi = 0;
  for (const char of path) {
    if (char === query[qi]) qi += 1;
    if (qi === query.length) return 100;
  }
  return 0;
}
