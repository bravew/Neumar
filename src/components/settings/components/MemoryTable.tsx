/**
 * MemoryTable — sortable, paginated memory table with CRUD modals.
 *
 * Self-contained component that fetches, displays, and mutates memory data.
 * Uses native <table> + Tailwind styling (no new dependencies).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Type,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface MemoryItem {
  id: string;
  content: string;
  category: string;
  importance: number;
  hasEmbedding: boolean;
  source: string;
  createdAt: string;
}

type SortColumn = 'created_at' | 'importance' | 'category' | 'content';
type SortOrder = 'asc' | 'desc';
type ModalMode = 'create' | 'edit' | 'view' | null;

const PAGE_SIZE = 10;

const CATEGORIES = [
  'preference',
  'fact',
  'instruction',
  'context',
  'relationship',
  'other',
];

const INPUT_CLASS =
  'border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1';

const BTN_PRIMARY =
  'rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50';

const BTN_SECONDARY =
  'rounded-md px-4 py-2 text-sm font-medium bg-muted hover:bg-muted/80 text-foreground';

// Extracted outside the render body to prevent unnecessary remounts on each render cycle
function SortIcon({
  col,
  sortBy,
  sortOrder,
}: {
  col: SortColumn;
  sortBy: SortColumn;
  sortOrder: SortOrder;
}) {
  if (sortBy !== col)
    return <ArrowUpDown size={12} className="text-muted-foreground" />;
  return sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
}

function SortHeader({
  col,
  label,
  sortBy,
  sortOrder,
  onSort,
}: {
  col: SortColumn;
  label: string;
  sortBy: SortColumn;
  sortOrder: SortOrder;
  onSort: (col: SortColumn) => void;
}) {
  return (
    <th className="px-3 py-2 text-left text-xs font-medium whitespace-nowrap">
      <button
        type="button"
        onClick={() => onSort(col)}
        className="hover:text-foreground inline-flex items-center gap-1"
        aria-label={`Sort by ${label}`}
      >
        {label}
        <SortIcon col={col} sortBy={sortBy} sortOrder={sortOrder} />
      </button>
    </th>
  );
}

interface MemoryTableProps {
  onStatsChange: () => void;
}

export function MemoryTable({ onStatsChange }: MemoryTableProps) {
  const { t } = useLanguage();

  // Data state
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Search
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [semanticSearch, setSemanticSearch] = useState(false);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticScores, setSemanticScores] = useState<Map<string, number>>(
    new Map(),
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Sort & pagination
  const [sortBy, setSortBy] = useState<SortColumn>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [page, setPage] = useState(0);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Modal
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingMemory, setEditingMemory] = useState<MemoryItem | null>(null);
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState('other');
  const [formImportance, setFormImportance] = useState(0.7);
  const [submitting, setSubmitting] = useState(false);

  // Fetch memories (text search via GET, semantic search via POST /memory/search)
  const fetchMemories = useCallback(async () => {
    // Semantic search mode — use POST /memory/search
    if (semanticSearch && searchQuery) {
      setSemanticLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/memory/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: searchQuery, limit: PAGE_SIZE }),
        });
        if (res.ok) {
          const data = await res.json();
          const results: { memory: MemoryItem; score: number }[] =
            data.results ?? [];
          const scores = new Map<string, number>();
          const items = results.map((r) => {
            scores.set(r.memory.id, r.score);
            return r.memory;
          });
          setMemories(items);
          setSemanticScores(scores);
          setTotal(items.length);
        }
      } catch {
        // Backend might not be running
      } finally {
        setSemanticLoading(false);
        setLoading(false);
      }
      return;
    }

    // Text search mode — use GET /memory with LIKE
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        sortBy,
        sortOrder,
      });
      if (searchQuery) params.set('search', searchQuery);
      const res = await fetch(`${API_BASE_URL}/memory?${params}`);
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories ?? []);
        setTotal(data.total ?? 0);
        setSemanticScores(new Map());
      }
    } catch {
      // Backend might not be running
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, sortOrder, searchQuery, semanticSearch]);

  useEffect(() => {
    setLoading(true);
    fetchMemories();
  }, [fetchMemories]);

  // Debounce search input → searchQuery
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value);
      setPage(0);
    }, 300);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Clear selection on page/sort/search change
  useEffect(() => {
    setSelected(new Set());
  }, [page, sortBy, sortOrder, searchQuery]);

  // Sort handler
  const handleSort = useCallback(
    (col: SortColumn) => {
      if (sortBy === col) {
        setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortBy(col);
        setSortOrder(col === 'importance' ? 'desc' : 'asc');
      }
      setPage(0);
    },
    [sortBy],
  );

  // Selection handlers
  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === memories.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(memories.map((m) => m.id)));
    }
  }, [memories, selected.size]);

  // Bulk delete
  const handleBulkDelete = useCallback(async () => {
    if (
      !window.confirm(
        t.settings.memoryBulkDeleteConfirm ??
          `Delete ${selected.size} selected memories?`,
      )
    )
      return;

    try {
      const res = await fetch(`${API_BASE_URL}/memory/batch-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (res.ok) {
        setSelected(new Set());
        fetchMemories();
        onStatsChange();
      }
    } catch {
      // Silently fail
    }
  }, [selected, fetchMemories, onStatsChange, t]);

  // Single delete
  const handleDelete = useCallback(
    async (id: string) => {
      if (
        !window.confirm(t.settings.memoryDeleteConfirm ?? 'Delete this memory?')
      )
        return;
      try {
        const res = await fetch(`${API_BASE_URL}/memory/${id}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          fetchMemories();
          onStatsChange();
        }
      } catch {
        // Silently fail
      }
    },
    [fetchMemories, onStatsChange, t],
  );

  // Open modals
  const openCreate = useCallback(() => {
    setEditingMemory(null);
    setFormContent('');
    setFormCategory('other');
    setFormImportance(0.7);
    setModalMode('create');
  }, []);

  const openEdit = useCallback((mem: MemoryItem) => {
    setEditingMemory(mem);
    setFormContent(mem.content);
    setFormCategory(mem.category);
    setFormImportance(mem.importance);
    setModalMode('edit');
  }, []);

  const openView = useCallback((mem: MemoryItem) => {
    setEditingMemory(mem);
    setModalMode('view');
  }, []);

  // Submit create/edit
  const handleSubmit = useCallback(async () => {
    if (!formContent.trim()) return;
    setSubmitting(true);

    try {
      if (modalMode === 'create') {
        const res = await fetch(`${API_BASE_URL}/memory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: formContent,
            category: formCategory,
            importance: formImportance,
          }),
        });
        if (res.ok) {
          setModalMode(null);
          fetchMemories();
          onStatsChange();
        }
      } else if (modalMode === 'edit' && editingMemory) {
        const res = await fetch(`${API_BASE_URL}/memory/${editingMemory.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: formContent,
            category: formCategory,
            importance: formImportance,
          }),
        });
        if (res.ok) {
          setModalMode(null);
          fetchMemories();
          onStatsChange();
        }
      }
    } catch {
      // Silently fail
    } finally {
      setSubmitting(false);
    }
  }, [
    modalMode,
    formContent,
    formCategory,
    formImportance,
    editingMemory,
    fetchMemories,
    onStatsChange,
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (loading && memories.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="border-primary size-5 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  return (
    <section className="space-y-3">
      {/* Header: title + search + add button */}
      <div className="flex items-center gap-3">
        <h4 className="text-foreground shrink-0 text-sm font-medium">
          {t.settings.memoryStoredMemories ?? 'Stored Memories'}
          {total > 0 && (
            <span className="text-muted-foreground ml-1 font-normal">
              ({total})
            </span>
          )}
        </h4>
        <div className="relative min-w-0 flex-1">
          {semanticLoading ? (
            <Loader2
              size={14}
              className="text-muted-foreground absolute top-1/2 left-2.5 -translate-y-1/2 animate-spin"
            />
          ) : (
            <Search
              size={14}
              className="text-muted-foreground absolute top-1/2 left-2.5 -translate-y-1/2"
            />
          )}
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={
              t.settings.memorySearchPlaceholder ?? 'Search memories...'
            }
            className={cn(INPUT_CLASS, 'py-1.5 pl-8 text-xs')}
            aria-label={t.settings.memorySearchPlaceholder ?? 'Search memories'}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setSemanticSearch((prev) => !prev);
            setPage(0);
          }}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
            semanticSearch
              ? 'bg-primary/10 text-primary border-primary/30 border'
              : 'bg-muted text-muted-foreground hover:text-foreground border border-transparent',
          )}
          title={
            semanticSearch
              ? (t.settings.memorySemanticSearchTooltip ??
                'Using semantic similarity search')
              : (t.settings.memoryTextSearchTooltip ?? 'Using exact text match')
          }
          aria-label={
            semanticSearch
              ? (t.settings.memorySemanticSearch ?? 'Semantic')
              : (t.settings.memoryTextSearch ?? 'Text')
          }
        >
          {semanticSearch ? <Sparkles size={13} /> : <Type size={13} />}
          {semanticSearch
            ? (t.settings.memorySemanticSearch ?? 'Semantic')
            : (t.settings.memoryTextSearch ?? 'Text')}
        </button>
        <button
          type="button"
          onClick={openCreate}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          <Plus size={14} />
          {t.settings.memoryAddMemory ?? 'Add Memory'}
        </button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="bg-muted/50 border-border flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {selected.size} {t.settings.memorySelected ?? 'selected'}
          </span>
          <button
            type="button"
            onClick={handleBulkDelete}
            className="text-destructive hover:text-destructive/80 inline-flex items-center gap-1 text-xs font-medium"
          >
            <Trash2 size={12} />
            {t.settings.memoryBulkDelete ?? 'Delete Selected'}
          </button>
        </div>
      )}

      {memories.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {searchQuery
            ? (t.settings.memoryNoResults ?? 'No memories match your search')
            : (t.settings.memoryNoMemories ?? 'No memories stored yet')}
        </p>
      ) : (
        <>
          <div className="border-border overflow-hidden rounded-md border">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-muted/30 text-muted-foreground border-b">
                <tr>
                  <th className="w-8 px-2 py-2">
                    <input
                      type="checkbox"
                      checked={
                        selected.size === memories.length && memories.length > 0
                      }
                      onChange={toggleSelectAll}
                      className="rounded"
                      aria-label={
                        t.settings.memorySelectAll ?? 'Select all on page'
                      }
                    />
                  </th>
                  <SortHeader
                    col="content"
                    label={t.settings.memoryColContent ?? 'Content'}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                  <SortHeader
                    col="category"
                    label={t.settings.memoryColCategory ?? 'Category'}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                  <SortHeader
                    col="importance"
                    label={t.settings.memoryColImportance ?? 'Imp.'}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                  {semanticSearch && searchQuery && (
                    <th className="w-16 px-3 py-2 text-left text-xs font-medium whitespace-nowrap">
                      {t.settings.memoryColScore ?? 'Score'}
                    </th>
                  )}
                  <SortHeader
                    col="created_at"
                    label={t.settings.memoryColCreatedAt ?? 'Created'}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                  <th className="w-16 px-2 py-2 text-right text-xs font-medium" />
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {memories.map((mem) => (
                  <tr
                    key={mem.id}
                    className={cn(
                      'hover:bg-muted/20 transition-colors',
                      selected.has(mem.id) && 'bg-primary/5',
                    )}
                  >
                    <td className="w-8 px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(mem.id)}
                        onChange={() => toggleSelect(mem.id)}
                        className="rounded"
                        aria-label={`Select memory ${mem.id.slice(0, 8)}`}
                      />
                    </td>
                    <td className="min-w-0 px-2 py-2">
                      <button
                        type="button"
                        onClick={() => openView(mem)}
                        className="hover:text-primary block w-full truncate text-left transition-colors"
                        title={mem.content}
                      >
                        {mem.content}
                      </button>
                    </td>
                    <td className="w-20 px-2 py-2">
                      <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-xs font-medium capitalize">
                        {mem.category}
                      </span>
                    </td>
                    <td className="w-20 px-2 py-2">
                      <div className="flex items-center gap-1">
                        <div className="bg-muted h-1.5 w-8 overflow-hidden rounded-full">
                          <div
                            className="bg-primary h-full rounded-full"
                            style={{
                              width: `${Math.round(mem.importance * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-muted-foreground text-xs">
                          {Math.round(mem.importance * 100)}%
                        </span>
                      </div>
                    </td>
                    {semanticSearch && searchQuery && (
                      <td className="w-16 px-2 py-2">
                        <span className="text-muted-foreground font-mono text-xs">
                          {semanticScores.has(mem.id)
                            ? semanticScores.get(mem.id)!.toFixed(4)
                            : '—'}
                        </span>
                      </td>
                    )}
                    <td className="text-muted-foreground w-22 px-2 py-2 text-xs whitespace-nowrap">
                      {new Date(mem.createdAt).toLocaleDateString()}
                    </td>
                    <td className="w-16 px-2 py-2 text-right">
                      <div className="inline-flex gap-0.5">
                        <button
                          type="button"
                          onClick={() => openEdit(mem)}
                          className="text-muted-foreground hover:text-foreground p-1"
                          aria-label={t.settings.memoryEdit ?? 'Edit'}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(mem.id)}
                          className="text-muted-foreground hover:text-destructive p-1"
                          aria-label={
                            t.settings.memoryDeleteConfirm ?? 'Delete'
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination (hidden during semantic search — results are single-page) */}
          {!(semanticSearch && searchQuery) && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {t.settings.memoryPage ?? 'Page'} {page + 1} / {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className={cn(
                    BTN_SECONDARY,
                    'px-3 py-1 text-xs disabled:opacity-50',
                  )}
                >
                  {t.settings.memoryPrev ?? 'Prev'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setPage((p) => Math.min(totalPages - 1, p + 1))
                  }
                  disabled={page >= totalPages - 1}
                  className={cn(
                    BTN_SECONDARY,
                    'px-3 py-1 text-xs disabled:opacity-50',
                  )}
                >
                  {t.settings.memoryNext ?? 'Next'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create/Edit Modal */}
      <Dialog
        open={modalMode === 'create' || modalMode === 'edit'}
        onOpenChange={(open) => !open && setModalMode(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {modalMode === 'create'
                ? (t.settings.memoryAddMemory ?? 'Add Memory')
                : (t.settings.memoryEditMemory ?? 'Edit Memory')}
            </DialogTitle>
            <DialogDescription>
              {modalMode === 'create'
                ? (t.settings.memoryAddDescription ??
                  'Create a new memory entry.')
                : (t.settings.memoryEditDescription ??
                  'Update this memory. Content changes will trigger re-embedding.')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="mem-content"
                className="text-foreground/80 mb-1 block text-sm font-medium"
              >
                {t.settings.memoryColContent ?? 'Content'}
              </label>
              <textarea
                id="mem-content"
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                rows={4}
                className={cn(INPUT_CLASS, 'resize-y')}
                placeholder={
                  t.settings.memoryContentPlaceholder ??
                  'Enter memory content...'
                }
              />
            </div>

            <div>
              <label
                htmlFor="mem-category"
                className="text-foreground/80 mb-1 block text-sm font-medium"
              >
                {t.settings.memoryColCategory ?? 'Category'}
              </label>
              <select
                id="mem-category"
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className={INPUT_CLASS}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="mem-importance"
                className="text-foreground/80 mb-1 block text-sm font-medium"
              >
                {t.settings.memoryColImportance ?? 'Importance'}:{' '}
                {Math.round(formImportance * 100)}%
              </label>
              <input
                id="mem-importance"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={formImportance}
                onChange={(e) => setFormImportance(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setModalMode(null)}
              className={BTN_SECONDARY}
            >
              {t.settings.dataCancel ?? 'Cancel'}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !formContent.trim()}
              className={BTN_PRIMARY}
            >
              {submitting
                ? '...'
                : modalMode === 'create'
                  ? (t.settings.memoryCreate ?? 'Create')
                  : (t.settings.connectorSave ?? 'Save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Modal */}
      <Dialog
        open={modalMode === 'view'}
        onOpenChange={(open) => !open && setModalMode(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t.settings.memoryViewMemory ?? 'Memory Details'}
            </DialogTitle>
            <DialogDescription>
              {editingMemory?.category ?? ''} —{' '}
              {t.settings.memoryColImportance ?? 'Importance'}:{' '}
              {Math.round((editingMemory?.importance ?? 0) * 100)}%
            </DialogDescription>
          </DialogHeader>

          {editingMemory && (
            <div className="space-y-3">
              <div className="bg-muted/30 max-h-64 overflow-y-auto rounded-md p-3">
                <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
                  {editingMemory.content}
                </p>
              </div>

              <div className="text-muted-foreground grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="font-medium">
                    {t.settings.memoryColSource ?? 'Source'}:
                  </span>{' '}
                  {editingMemory.source}
                </div>
                <div>
                  <span className="font-medium">
                    {t.settings.memoryColEmbedding ?? 'Embedding'}:
                  </span>{' '}
                  {editingMemory.hasEmbedding ? 'Yes' : 'No'}
                </div>
                <div className="col-span-2">
                  <span className="font-medium">
                    {t.settings.memoryColCreatedAt ?? 'Created'}:
                  </span>{' '}
                  {new Date(editingMemory.createdAt).toLocaleString()}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              onClick={() => setModalMode(null)}
              className={BTN_SECONDARY}
            >
              {t.settings.dataCancel ?? 'Close'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (editingMemory) openEdit(editingMemory);
              }}
              className={BTN_PRIMARY}
            >
              {t.settings.memoryEdit ?? 'Edit'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
