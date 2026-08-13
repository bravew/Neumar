import { useEffect, useRef, useState } from 'react';

import { Save } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  dismissVideoPluginCandidate,
  saveVideoPluginCandidate,
  useVideoPluginCandidates,
} from '@/shared/hooks/useVideoPluginCandidates';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

interface SavePluginCandidateDialogProps {
  project: VideoProject;
}

export function SavePluginCandidateDialog({
  project,
}: SavePluginCandidateDialogProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.pluginCandidate;
  const enabled = project.render?.status === 'done';
  const { candidates, loading, error } = useVideoPluginCandidates(
    project.id,
    enabled,
  );
  const candidate = candidates[0];
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'project' | 'user'>('project');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [completedCandidateId, setCompletedCandidateId] = useState<
    string | null
  >(null);

  // Reset only when the candidate's id actually changes — NOT on every poll.
  // The candidates hook returns a fresh object (and possibly updated metadata)
  // each cycle; keying on the object reference or on title/description would
  // re-fire mid-edit, clearing the form and closing the dialog while the user
  // is typing, and could resurface a candidate they already dismissed.
  const candidateId = candidate?.id ?? null;
  const lastSeenCandidateId = useRef<string | null>(null);

  useEffect(() => {
    if (!candidateId || candidateId === lastSeenCandidateId.current) return;
    lastSeenCandidateId.current = candidateId;
    setTitle(candidate?.title ?? '');
    setDescription(candidate?.description ?? '');
    setScope('project');
    setActionError(null);
    setSavedPath(null);
    setCompletedCandidateId(null);
    setOpen(false);
  }, [candidateId, candidate]);

  if (
    !enabled ||
    loading ||
    error ||
    !candidate ||
    completedCandidateId === candidate.id
  ) {
    return null;
  }

  const handleSave = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await saveVideoPluginCandidate(candidate.id, {
        title,
        description,
        scope,
      });
      setSavedPath(result.pluginDir);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : labels.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await dismissVideoPluginCandidate(candidate.id);
      setCompletedCandidateId(candidate.id);
      setOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : labels.dismissFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-border bg-background mb-3 rounded-md border p-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hover:bg-accent flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left"
      >
        <span>
          <span className="text-foreground block font-medium">
            {labels.open}
          </span>
          <span className="text-muted-foreground line-clamp-1 block">
            {candidate.title}
          </span>
        </span>
        <Save className="text-muted-foreground size-3.5 shrink-0" />
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (busy) return;
          setOpen(value);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{labels.title}</DialogTitle>
            <DialogDescription>{labels.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">{labels.name}</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">{labels.summary}</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="border-input bg-background text-foreground min-h-20 w-full rounded-md border px-3 py-2"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">{labels.scope}</span>
              <select
                value={scope}
                onChange={(event) =>
                  setScope(event.target.value === 'user' ? 'user' : 'project')
                }
                className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
              >
                <option value="project">{labels.projectScope}</option>
                <option value="user">{labels.userScope}</option>
              </select>
            </label>
            {savedPath ? (
              <p className="text-muted-foreground text-xs">
                {labels.saved.replace('{path}', savedPath)}
              </p>
            ) : null}
            {actionError ? (
              <p className="text-destructive text-xs">{actionError}</p>
            ) : null}
          </div>
          <DialogFooter>
            {savedPath ? (
              <button
                type="button"
                onClick={() => {
                  setCompletedCandidateId(candidate.id);
                  setOpen(false);
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-xs font-medium"
              >
                {labels.done}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleDismiss}
                  disabled={busy}
                  className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs disabled:opacity-60"
                >
                  {labels.dismiss}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={busy || !title.trim() || !description.trim()}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60"
                >
                  {busy ? labels.saving : labels.save}
                </button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
