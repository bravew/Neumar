import { useEffect, useRef, useState } from 'react';

import { CheckCircle, Download, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface OperatingProfile {
  id: string;
  name: string;
  description: string | null;
  workspace_root: string | null;
  agent_profiles: string | null;
  is_active: boolean;
}

const EMPTY_FORM = {
  name: '',
  description: '',
  workspace_root: '',
  agent_profiles: '',
};

export function ProfileSettings() {
  const { t } = useLanguage();
  const [profiles, setProfiles] = useState<OperatingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const s = t.settings as Record<string, string>;
  const c = t.common;

  const loadProfiles = async (signal?: AbortSignal) => {
    try {
      const r = await fetch(`${API_BASE_URL}/profiles`, { signal });
      const data = (await r.json()) as {
        profiles?: OperatingProfile[];
      };
      setProfiles(data.profiles ?? []);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadProfiles(controller.signal);
    return () => controller.abort();
  }, []);

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setCreating(true);
    setError(null);
  };

  const startEdit = (p: OperatingProfile) => {
    setForm({
      name: p.name,
      description: p.description ?? '',
      workspace_root: p.workspace_root ?? '',
      agent_profiles: p.agent_profiles ?? '',
    });
    setEditingId(p.id);
    setCreating(false);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setCreating(false);
    setError(null);
  };

  const saveProfile = async () => {
    if (!form.name.trim()) {
      setError(s.profileNameRequired ?? 'Name is required');
      return;
    }
    try {
      const body = {
        name: form.name.trim(),
        description: form.description || null,
        workspace_root: form.workspace_root || null,
        agent_profiles: form.agent_profiles || null,
      };
      if (creating) {
        await fetch(`${API_BASE_URL}/profiles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else if (editingId) {
        await fetch(`${API_BASE_URL}/profiles/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      cancelEdit();
      await loadProfiles();
      toast.success(s.toastProfileSaved ?? 'Profile saved');
    } catch {
      setError(s.profileSaveFailed ?? 'Save failed');
      toast.error(s.toastProfileSaveFailed ?? 'Failed to save profile');
    }
  };

  const activateProfile = async (id: string) => {
    try {
      await fetch(`${API_BASE_URL}/profiles/${id}/activate`, {
        method: 'POST',
      });
      await loadProfiles();
    } catch {
      // ignore
    }
  };

  const deleteProfile = async (id: string) => {
    try {
      await fetch(`${API_BASE_URL}/profiles/${id}`, { method: 'DELETE' });
      setDeleteConfirm(null);
      await loadProfiles();
      toast.success(s.toastProfileDeleted ?? 'Profile deleted');
    } catch {
      toast.error(s.toastProfileDeleteFailed ?? 'Failed to delete profile');
    }
  };

  const exportProfile = (p: OperatingProfile) => {
    // Exclude workspace_root — it is machine-specific and should not be shared
    const { workspace_root: _omitted, ...exportable } = p;
    const json = JSON.stringify(exportable, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `profile-${p.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(
          ev.target?.result as string,
        ) as Partial<OperatingProfile>;
        await fetch(`${API_BASE_URL}/profiles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name ?? 'Imported',
            description: data.description ?? null,
            workspace_root: data.workspace_root ?? null,
            agent_profiles: data.agent_profiles ?? null,
          }),
        });
        await loadProfiles();
        toast.success(s.toastProfileImported ?? 'Profile imported');
      } catch {
        setError(s.profileImportFailed ?? 'Import failed');
        toast.error(s.toastProfileImportFailed ?? 'Failed to import profile');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  if (loading) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        {c.loading}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-foreground text-sm font-semibold">
          {s.profilesTitle ?? 'Operating Profiles'}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs transition-colors"
          >
            <Upload className="size-3.5" />
            {s.profileImport ?? 'Import'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            onClick={startCreate}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
          >
            <Plus className="size-3.5" />
            {s.profileCreate ?? 'New'}
          </button>
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* Create / Edit form */}
      {(creating || editingId) && (
        <div className="bg-muted/40 border-border space-y-3 rounded-lg border p-4">
          <input
            type="text"
            placeholder={`${s.profileName ?? 'Name'} *`}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="border-input bg-background text-foreground w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none"
          />
          <input
            type="text"
            placeholder={s.profileDescription ?? 'Description'}
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            className="border-input bg-background text-foreground w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none"
          />
          <input
            type="text"
            placeholder={s.profileWorkspaceRoot ?? 'Workspace root path'}
            value={form.workspace_root}
            onChange={(e) =>
              setForm((f) => ({ ...f, workspace_root: e.target.value }))
            }
            className="border-input bg-background text-foreground w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none"
          />
          <input
            type="text"
            placeholder={
              s.profileAgentProfiles ??
              'Linked agent profile IDs (comma-separated)'
            }
            value={form.agent_profiles}
            onChange={(e) =>
              setForm((f) => ({ ...f, agent_profiles: e.target.value }))
            }
            className="border-input bg-background text-foreground w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={saveProfile}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            >
              {s.profileSave ?? 'Save'}
            </button>
            <button
              onClick={cancelEdit}
              className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-xs transition-colors"
            >
              {s.profileCancel ?? 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Profile list */}
      <div className="space-y-2">
        {profiles.length === 0 && (
          <p className="text-muted-foreground py-4 text-center text-sm">
            {s.profileNoProfiles ?? 'No profiles yet.'}
          </p>
        )}
        {profiles.map((p) => (
          <div
            key={p.id}
            className={cn(
              'border-border flex items-start justify-between rounded-lg border p-3 transition-colors',
              p.is_active && 'border-primary/40 bg-primary/5',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-foreground text-sm font-medium">
                  {p.name}
                </span>
                {p.is_active && (
                  <span className="bg-primary/10 text-primary rounded-full px-1.5 py-0.5 text-xs font-medium">
                    {s.profileActive ?? 'Active'}
                  </span>
                )}
              </div>
              {p.description && (
                <p className="text-muted-foreground mt-0.5 truncate text-xs">
                  {p.description}
                </p>
              )}
              {p.workspace_root && (
                <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
                  {p.workspace_root}
                </p>
              )}
            </div>
            <div className="ml-3 flex shrink-0 items-center gap-1.5">
              {!p.is_active && (
                <button
                  onClick={() => activateProfile(p.id)}
                  className="text-muted-foreground hover:text-primary transition-colors"
                  title={s.profileActivate ?? 'Activate'}
                >
                  <CheckCircle className="size-4" />
                </button>
              )}
              <button
                onClick={() => startEdit(p)}
                className="text-muted-foreground hover:text-foreground rounded px-1.5 py-0.5 text-xs transition-colors"
              >
                {s.profileEdit ?? 'Edit'}
              </button>
              <button
                onClick={() => exportProfile(p)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title={s.profileExport ?? 'Export'}
              >
                <Download className="size-4" />
              </button>
              {deleteConfirm === p.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => deleteProfile(p.id)}
                    className="text-destructive text-xs font-medium"
                  >
                    {s.profileConfirm ?? 'Confirm'}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="text-muted-foreground text-xs"
                  >
                    {s.profileCancel ?? 'Cancel'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeleteConfirm(p.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
