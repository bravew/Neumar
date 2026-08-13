import { useEffect, useState } from 'react';

import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

const SECRET_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

interface SecretEntry {
  name: string;
  hint: string;
}

export function SecretsSettings() {
  const { t } = useLanguage();
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const s = t.settings as Record<string, string>;
  const c = t.common;

  const loadSecrets = async (signal?: AbortSignal) => {
    try {
      const r = await fetch(`${API_BASE_URL}/secrets`, { signal });
      const data = (await r.json()) as { secrets?: SecretEntry[] };
      setSecrets(data.secrets ?? []);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadSecrets(controller.signal);
    return () => controller.abort();
  }, []);

  const nameValid = newName === '' || SECRET_NAME_RE.test(newName);

  const handleAdd = async () => {
    if (!newName.trim()) {
      setError(s.secretsNameRequired ?? 'Secret name is required');
      return;
    }
    if (!SECRET_NAME_RE.test(newName.trim())) {
      setError(
        s.secretsNameInvalid ??
          'Name must start with a letter and contain only letters, digits, or underscores',
      );
      return;
    }
    if (!newValue) {
      setError(s.secretsValueRequired ?? 'Secret value is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), value: newValue }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      setNewName('');
      setNewValue('');
      setAdding(false);
      await loadSecrets();
      toast.success(s.toastSecretSaved ?? 'Secret saved');
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : (s.toastSecretSaveFailed ?? 'Failed to save secret');
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await fetch(`${API_BASE_URL}/secrets/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      setDeleteConfirm(null);
      await loadSecrets();
      toast.success(s.toastSecretDeleted ?? 'Secret deleted');
    } catch {
      toast.error(s.toastSecretDeleteFailed ?? 'Failed to delete secret');
    }
  };

  const cancelAdd = () => {
    setAdding(false);
    setNewName('');
    setNewValue('');
    setError(null);
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
        <div>
          <h3 className="text-foreground text-sm font-semibold">
            {s.secretsTitle ?? 'Encrypted Secrets'}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {s.secretsDescription ??
              'Secrets are stored encrypted. Values are never shown after saving.'}
          </p>
        </div>
        <button
          onClick={() => {
            setAdding(true);
            setError(null);
          }}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
        >
          <Plus className="size-3.5" />
          {s.secretsAdd ?? 'Add Secret'}
        </button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* Add form */}
      {adding && (
        <div className="bg-muted/40 border-border space-y-3 rounded-lg border p-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-foreground text-xs font-medium">
              {s.secretsName ?? 'Name'}
            </label>
            <input
              type="text"
              placeholder={s.secretsNamePlaceholder ?? 'e.g. GITHUB_TOKEN'}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              className={cn(
                'bg-background text-foreground w-full rounded-md border px-3 py-1.5 font-mono text-sm focus:outline-none',
                nameValid ? 'border-input' : 'border-destructive',
              )}
            />
            {!nameValid && (
              <p className="text-destructive text-xs">
                {s.secretsNameInvalid ??
                  'Must start with a letter and use only letters, digits, or underscores'}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-foreground text-xs font-medium">
              {s.secretsValue ?? 'Value'}
            </label>
            <input
              type="password"
              placeholder={s.secretsValuePlaceholder ?? 'Enter secret value'}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              autoComplete="new-password"
              className="border-input bg-background text-foreground w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving || !nameValid}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {saving
                ? (s.secretsSaving ?? 'Saving...')
                : (s.secretsSave ?? 'Save')}
            </button>
            <button
              onClick={cancelAdd}
              className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-xs transition-colors"
            >
              {s.secretsCancel ?? 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Secrets list */}
      <div className="space-y-2">
        {secrets.length === 0 && (
          <p className="text-muted-foreground py-4 text-center text-sm">
            {s.secretsNoSecrets ?? 'No secrets stored yet.'}
          </p>
        )}
        {secrets.map(({ name, hint }) => (
          <div
            key={name}
            className="border-border flex items-center justify-between rounded-lg border px-3 py-2.5"
          >
            <div className="flex items-center gap-2.5">
              <KeyRound className="text-muted-foreground size-4 shrink-0" />
              <span className="text-foreground font-mono text-sm">{name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-mono text-xs">
                {hint ? `•••••••${hint}` : '••••••••'}
              </span>
              {deleteConfirm === name ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleDelete(name)}
                    className="text-destructive text-xs font-medium"
                  >
                    {s.secretsDelete ?? 'Delete'}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="text-muted-foreground text-xs"
                  >
                    {s.secretsCancel ?? 'Cancel'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeleteConfirm(name)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  aria-label={`Delete secret ${name}`}
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
