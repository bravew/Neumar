import { useState } from 'react';

import {
  type ContentGraph,
  type ContentGraphNode,
  DEFAULT_CONTENT_GRAPH_FRAME_DURATION_SEC,
  topoSortContentGraph,
} from '@neumar/video-ir';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// Phase 6 M3 — frames strip. Renders content-graph nodes in topological order
// (the play order the materializer uses). Supports selecting a frame, reordering
// adjacent frames, and editing a frame's text inline. Every edit persists the
// whole graph through `onSave`; reordering swaps the underlying nodes-array
// positions so the topo tie-break follows the new order.

interface VideoFramesStripProps {
  graph: ContentGraph | null;
  /** Persist an edited graph. Should resolve once written. */
  onSave: (next: ContentGraph) => Promise<unknown>;
  selectedId?: string | null;
  onSelect?: (nodeId: string) => void;
  nativeEnhancedNodeIds?: readonly string[];
  enhancingNodeId?: string | null;
  onSetNativeEnhancement?: (
    nodeId: string,
    enabled: boolean,
  ) => Promise<unknown>;
}

/** The editable text for a node: a text node's body, else its label. */
function nodeText(node: ContentGraphNode): string {
  return node.kind === 'text' ? node.text : (node.label ?? '');
}

function withNodeText(node: ContentGraphNode, value: string): ContentGraphNode {
  if (node.kind === 'text') return { ...node, text: value };
  return { ...node, label: value };
}

export function VideoFramesStrip({
  graph,
  onSave,
  selectedId,
  onSelect,
  nativeEnhancedNodeIds = [],
  enhancingNodeId,
  onSetNativeEnhancement,
}: VideoFramesStripProps) {
  const { t } = useLanguage();
  const g = t.video.framesStrip;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="text-muted-foreground text-xs" role="status">
        {g.empty}
      </div>
    );
  }

  const order = topoSortContentGraph(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nativeEnhanced = new Set(nativeEnhancedNodeIds);
  const frames = order
    .map((id) => byId.get(id))
    .filter((n): n is ContentGraphNode => Boolean(n));

  const persist = async (nodes: ContentGraphNode[]) => {
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...graph, nodes });
    } catch (err) {
      // Surface save failures instead of letting `void persist()` callers turn
      // them into unhandled rejections with no user feedback.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const move = async (nodeId: string, dir: -1 | 1) => {
    const pos = order.indexOf(nodeId);
    const target = pos + dir;
    if (target < 0 || target >= order.length) return;
    const targetId = order[target];
    const a = graph.nodes.findIndex((n) => n.id === nodeId);
    const b = graph.nodes.findIndex((n) => n.id === targetId);
    if (a < 0 || b < 0) return;
    const nodes = [...graph.nodes];
    [nodes[a], nodes[b]] = [nodes[b], nodes[a]];
    await persist(nodes);
  };

  const startEdit = (node: ContentGraphNode) => {
    setEditingId(node.id);
    setDraft(nodeText(node));
  };

  const commitEdit = async () => {
    if (!editingId) return;
    const nodes = graph.nodes.map((n) =>
      n.id === editingId ? withNodeText(n, draft) : n,
    );
    setEditingId(null);
    await persist(nodes);
  };

  return (
    <div className="space-y-1">
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {g.saveError.replace('{error}', error)}
        </p>
      ) : null}
      <ol
        className="flex gap-2 overflow-x-auto pb-1"
        data-testid="video-frames-strip"
      >
        {frames.map((node, index) => {
          const selected = selectedId === node.id;
          const editing = editingId === node.id;
          const nativeActive = nativeEnhanced.has(node.id);
          const canEnhanceNative =
            node.kind === 'data' && Boolean(onSetNativeEnhancement);
          const durationSec =
            node.durationSec ?? DEFAULT_CONTENT_GRAPH_FRAME_DURATION_SEC;
          return (
            <li
              key={node.id}
              className={cn(
                'flex w-44 shrink-0 flex-col gap-1 rounded-md border p-2 text-xs',
                selected
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50',
              )}
              data-testid={`frame-${node.id}`}
            >
              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  className="text-foreground min-w-0 flex-1 truncate text-left font-medium"
                  onClick={() => onSelect?.(node.id)}
                  aria-pressed={selected}
                >
                  {g.frameLabel.replace('{index}', String(index + 1))}
                </button>
                <span className="text-muted-foreground tabular-nums">
                  {g.duration.replace('{seconds}', String(durationSec))}
                </span>
              </div>
              <span className="text-muted-foreground truncate text-[11px] uppercase">
                {node.kind}
              </span>
              {nativeActive ? (
                <span className="border-border text-muted-foreground w-fit rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase">
                  {g.nativeBadge}
                </span>
              ) : null}

              {editing ? (
                <div className="flex flex-col gap-1">
                  <textarea
                    className="border-border bg-background min-h-14 w-full rounded border p-1 text-xs"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    aria-label={g.editLabel}
                    autoFocus
                  />
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      aria-label={g.cancel}
                      className="hover:bg-accent rounded p-1"
                    >
                      <X className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void commitEdit()}
                      aria-label={g.save}
                      disabled={busy}
                      className="hover:bg-accent rounded p-1 disabled:opacity-50"
                    >
                      <Check className="size-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-foreground line-clamp-3 min-h-[2.5rem]">
                    {nodeText(node) || g.untitled}
                  </p>
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void move(node.id, -1)}
                        aria-label={g.moveLeft}
                        disabled={busy || index === 0}
                        className="hover:bg-accent rounded p-1 disabled:opacity-30"
                      >
                        <ChevronLeft className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void move(node.id, 1)}
                        aria-label={g.moveRight}
                        disabled={busy || index === frames.length - 1}
                        className="hover:bg-accent rounded p-1 disabled:opacity-30"
                      >
                        <ChevronRight className="size-3" />
                      </button>
                    </div>
                    {canEnhanceNative ? (
                      <button
                        type="button"
                        onClick={() =>
                          void onSetNativeEnhancement?.(node.id, !nativeActive)
                        }
                        aria-label={
                          nativeActive ? g.revertNative : g.enhanceNative
                        }
                        disabled={busy || enhancingNodeId === node.id}
                        className="hover:bg-accent rounded p-1 disabled:opacity-40"
                      >
                        {nativeActive ? (
                          <RotateCcw className="size-3" />
                        ) : (
                          <Sparkles className="size-3" />
                        )}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => startEdit(node)}
                      aria-label={g.editText}
                      className="hover:bg-accent rounded p-1"
                    >
                      <Pencil className="size-3" />
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
