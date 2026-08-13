/**
 * DocumentPanel
 *
 * Displays task-level documents (plan, notes, design, custom) with version history.
 * Documents are created/updated via POST /tasks/:taskId/documents/:key
 * and version history is kept automatically by a BEFORE UPDATE trigger.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ChevronDown, ChevronRight, Clock, PenLine } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// ─── Types ────────────────────────────────────────────────────────────────────

type DocKey = 'plan' | 'notes' | 'design' | 'custom';

interface TaskDocument {
  id: string;
  task_id: string;
  doc_key: DocKey;
  title: string;
  content: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface HistoryEntry {
  history_id: string;
  document_id: string;
  content: string;
  version: number;
  created_by: string;
  created_at: string;
}

const DOC_KEYS: DocKey[] = ['plan', 'notes', 'design', 'custom'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HistoryDrawer({
  taskId,
  docKey,
  onRestore,
}: {
  taskId: string;
  docKey: DocKey;
  onRestore: (content: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const { t } = useLanguage();
  const d = t.task as Record<string, unknown>;
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/documents/${docKey}/history`,
        { signal: ac.signal },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { history: HistoryEntry[] };
      if (mountedRef.current) setEntries(data.history ?? []);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [taskId, docKey]);

  const toggle = () => {
    setOpen((p) => !p);
    if (!open) load();
  };

  return (
    <div>
      <button
        onClick={toggle}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
      >
        <Clock className="size-3" />
        {(d.docHistory as string) ?? 'History'}
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
      </button>
      {open && (
        <div className="border-border mt-2 space-y-1 rounded-md border p-2">
          {loading ? (
            <p className="text-muted-foreground text-xs">{t.common.loading}</p>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {(d.docNoHistory as string) ?? 'No history yet'}
            </p>
          ) : (
            entries.map((e) => (
              <div
                key={e.history_id}
                className="flex items-start gap-2 rounded px-1 py-1"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-muted-foreground text-[10px]">
                    v{e.version} · {formatDate(e.created_at)} · {e.created_by}
                  </p>
                  <p className="text-foreground/70 mt-0.5 line-clamp-2 text-xs">
                    {e.content.slice(0, 120)}
                  </p>
                </div>
                <button
                  onClick={() => {
                    onRestore(e.content);
                    setOpen(false);
                  }}
                  className="text-muted-foreground hover:text-foreground shrink-0 text-[10px]"
                >
                  {(d.docRestore as string) ?? 'Restore'}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DocEditor({
  taskId,
  docKey,
  onSaved,
}: {
  taskId: string;
  docKey: DocKey;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const d = t.task as Record<string, unknown>;
  const [doc, setDoc] = useState<TaskDocument | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/tasks/${taskId}/documents/${docKey}`,
          { signal },
        );
        if (res.status === 404) {
          if (mountedRef.current) setDoc(null);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { document: TaskDocument };
        if (mountedRef.current) {
          setDoc(data.document);
          setEditContent(data.document.content);
          setEditTitle(data.document.title);
        }
      } catch {
        // ignore
      }
    },
    [taskId, docKey],
  );

  useEffect(() => {
    mountedRef.current = true;
    const ac = new AbortController();
    load(ac.signal);
    return () => {
      mountedRef.current = false;
      ac.abort();
    };
  }, [load]);

  const save = async () => {
    if (!editContent.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/documents/${docKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: doc?.id,
            title: editTitle || docKey,
            content: editContent,
            created_by: 'user',
          }),
        },
      );
      if (!res.ok) return;
      await load();
      if (!mountedRef.current) return;
      setEditing(false);
      onSaved();
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const startEditing = () => {
    setEditContent(doc?.content ?? '');
    setEditTitle(doc?.title ?? docKey);
    setEditing(true);
  };

  return (
    <div className="space-y-2">
      {/* Title bar */}
      <div className="flex items-center gap-2">
        {editing ? (
          <input
            className="border-border bg-background text-foreground flex-1 rounded border px-2 py-1 text-sm"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder={(d.docTitlePlaceholder as string) ?? 'Document title'}
          />
        ) : (
          <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
            {doc?.title ?? docKey}
          </span>
        )}
        {!editing && (
          <button
            onClick={startEditing}
            className="text-muted-foreground hover:text-foreground"
          >
            <PenLine className="size-3.5" />
          </button>
        )}
      </div>

      {/* Content */}
      {editing ? (
        <textarea
          className="border-border bg-background text-foreground min-h-[120px] w-full resize-y rounded-md border px-2 py-1.5 font-mono text-xs"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          placeholder={
            (d.docContentPlaceholder as string) ?? 'Write content here...'
          }
        />
      ) : doc ? (
        <pre className="bg-muted/30 text-foreground/80 max-h-[200px] overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
          {doc.content}
        </pre>
      ) : (
        <p className="text-muted-foreground text-xs">
          {(d.docEmpty as string) ??
            'No document yet. Click edit to create one.'}
        </p>
      )}

      {/* Actions */}
      {editing && (
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="bg-foreground text-background h-7 rounded px-3 text-xs disabled:opacity-50"
          >
            {saving ? '...' : ((d.docSave as string) ?? 'Save')}
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-muted-foreground text-xs"
          >
            {(d.docCancel as string) ?? 'Cancel'}
          </button>
        </div>
      )}

      {/* Version info + history */}
      {doc && !editing && (
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-[10px]">
            v{doc.version} · {formatDate(doc.updated_at)}
          </span>
          <HistoryDrawer
            taskId={taskId}
            docKey={docKey}
            onRestore={(content) => {
              setEditContent(content);
              setEditTitle(doc.title);
              setEditing(true);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

interface DocumentPanelProps {
  taskId: string;
}

export function DocumentPanel({ taskId }: DocumentPanelProps) {
  const { t } = useLanguage();
  const d = t.task as Record<string, unknown>;
  const [activeKey, setActiveKey] = useState<DocKey>('notes');
  const [version, setVersion] = useState(0);

  const docTabLabel = (key: DocKey): string => {
    const labels: Record<DocKey, string> = {
      plan: (d.docKeyPlan as string) ?? 'Plan',
      notes: (d.docKeyNotes as string) ?? 'Notes',
      design: (d.docKeyDesign as string) ?? 'Design',
      custom: (d.docKeyCustom as string) ?? 'Custom',
    };
    return labels[key];
  };

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="border-border flex gap-0.5 border-b">
        {DOC_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => setActiveKey(key)}
            className={cn(
              'border-b-2 px-3 py-1.5 text-xs font-medium capitalize transition-colors',
              activeKey === key
                ? 'border-foreground text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {docTabLabel(key)}
          </button>
        ))}
      </div>

      {/* Active doc editor */}
      <DocEditor
        key={`${taskId}-${activeKey}-${version}`}
        taskId={taskId}
        docKey={activeKey}
        onSaved={() => setVersion((v) => v + 1)}
      />
    </div>
  );
}
