import { type ReactNode, useState } from 'react';

import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronRight, Clipboard, Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  type DesignEditor,
  getDesignProjectDir,
  listDesignEditors,
  openDesignInEditor,
} from '@/shared/hooks/useDesignMode';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { EditorIcon } from './EditorIcon';

/**
 * Editor / CLI hand-off popover (Open Design parity). Two tabs:
 *  - **Open with editor**: opens the project directory in a detected editor or
 *    file manager, grouped into installed / not-installed.
 *  - **Copy for CLI**: copies the project path or a ready-to-paste `cd` command
 *    (optionally chained with a coding agent) to continue the project as code.
 * Editors + path are fetched lazily on first open.
 */
export function DesignHandoffMenu({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<'editor' | 'cli'>('editor');
  const [editors, setEditors] = useState<DesignEditor[] | null>(null);
  const [dir, setDir] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    if (editors && dir) return;
    try {
      const [editorList, dirRes] = await Promise.all([
        listDesignEditors(),
        getDesignProjectDir(projectId),
      ]);
      setEditors(editorList.editors);
      setDir(dirRes.path);
    } catch {
      setEditors([]);
    }
  };

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };
  const openEditor = async (editorId: string) => {
    try {
      await openDesignInEditor(projectId, editorId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t.design.openEditorFailed.replace('{error}', () => message));
    }
  };

  const installed = editors?.filter((e) => e.available) ?? [];
  const notInstalled = editors?.filter((e) => !e.available) ?? [];

  return (
    <Popover.Root onOpenChange={(open) => open && void load()}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Content
        align="end"
        sideOffset={8}
        className="bg-popover text-popover-foreground z-50 w-72 rounded-lg border p-2 shadow-md"
      >
        <div className="bg-muted mb-2 flex rounded-md p-0.5 text-sm">
          <TabPill active={tab === 'editor'} onClick={() => setTab('editor')}>
            {t.design.openWithEditor}
          </TabPill>
          <TabPill active={tab === 'cli'} onClick={() => setTab('cli')}>
            {t.design.copyForCli}
          </TabPill>
        </div>

        <button
          type="button"
          onClick={() => dir && copy('path', dir)}
          disabled={!dir}
          className="hover:bg-accent mb-1 flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-60"
        >
          {copied === 'path' ? (
            <Check className="size-4 text-emerald-500" />
          ) : (
            <Copy className="size-4" />
          )}
          {t.design.copyPath}
        </button>

        {editors === null ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 p-4 text-sm">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : tab === 'editor' ? (
          <EditorList
            installed={installed}
            notInstalled={notInstalled}
            installedLabel={t.design.handoffInstalled}
            notInstalledLabel={t.design.handoffNotInstalled}
            onOpen={(id) => void openEditor(id)}
          />
        ) : (
          <CliList dir={dir} copied={copied} onCopy={copy} />
        )}
      </Popover.Content>
    </Popover.Root>
  );
}

function EditorList({
  installed,
  notInstalled,
  installedLabel,
  notInstalledLabel,
  onOpen,
}: {
  installed: DesignEditor[];
  notInstalled: DesignEditor[];
  installedLabel: string;
  notInstalledLabel: string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="max-h-72 space-y-1 overflow-y-auto">
      {installed.length > 0 && <SectionLabel>{installedLabel}</SectionLabel>}
      {installed.map((editor) => (
        <button
          key={editor.id}
          type="button"
          onClick={() => onOpen(editor.id)}
          className="hover:bg-accent flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm"
        >
          <EditorIcon editorId={editor.id} size={22} />
          <span className="flex-1 text-left">{editor.label}</span>
          <ChevronRight className="text-muted-foreground size-4" />
        </button>
      ))}
      {notInstalled.length > 0 && (
        <SectionLabel>{notInstalledLabel}</SectionLabel>
      )}
      {notInstalled.map((editor) => (
        <div
          key={editor.id}
          className="text-muted-foreground flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm opacity-60"
        >
          <EditorIcon editorId={editor.id} size={22} />
          <span className="flex-1 text-left">{editor.label}</span>
        </div>
      ))}
    </div>
  );
}

function CliList({
  dir,
  copied,
  onCopy,
}: {
  dir: string | null;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  if (!dir) return null;
  const quoted = `"${dir}"`;
  const rows: { key: string; label: string; cmd: string }[] = [
    { key: 'cd', label: `cd ${quoted}`, cmd: `cd ${quoted}` },
    {
      key: 'claude',
      label: `cd … && claude`,
      cmd: `cd ${quoted} && claude`,
    },
    { key: 'codex', label: `cd … && codex`, cmd: `cd ${quoted} && codex` },
  ];
  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          onClick={() => onCopy(row.key, row.cmd)}
          className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm"
        >
          {copied === row.key ? (
            <Check className="size-4 shrink-0 text-emerald-500" />
          ) : (
            <Clipboard className="text-muted-foreground size-4 shrink-0" />
          )}
          <span className="truncate font-mono text-xs">{row.label}</span>
        </button>
      ))}
    </div>
  );
}

function TabPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-background shadow-sm' : 'text-muted-foreground',
      )}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wide uppercase">
      {children}
    </div>
  );
}
