import { useCallback, useState } from 'react';

import { Loader2, Sparkles, Wand2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type { AgentSoul } from '@/shared/types/agent-profile';

interface QuickSetupCardProps {
  profileId: string;
  onSoulGenerated: (soul: AgentSoul) => void;
  onChooseTemplate: () => void;
}

export function QuickSetupCard({
  profileId,
  onSoulGenerated,
  onChooseTemplate,
}: QuickSetupCardProps) {
  const { t, language } = useLanguage();
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleAutoStructure = useCallback(async () => {
    if (!description.trim() || loading) return;
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch(
        `${API_BASE_URL}/soul/agent-profiles/${profileId}/auto-structure`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: description.trim(), language }),
        },
      );

      if (res.ok) {
        const data = (await res.json()) as { soul: AgentSoul };
        onSoulGenerated(data.soul);
        setSuccess(true);
        setDescription('');
      } else {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? 'Failed to auto-structure');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [description, loading, profileId, language, onSoulGenerated]);

  return (
    <div className="bg-primary/5 border-primary/20 space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Wand2 className="text-primary size-4" />
        <span className="text-foreground text-sm font-medium">
          {t.profiles.quickSetup}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        {t.profiles.quickSetupDesc}
      </p>

      <textarea
        value={description}
        onChange={(e) => {
          setDescription(e.target.value);
          setSuccess(false);
        }}
        placeholder={t.profiles.quickSetupPlaceholder}
        rows={4}
        className="bg-background border-input text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring/40 w-full resize-y rounded-lg border px-3 py-2 text-xs outline-none focus:ring-2"
      />

      {error && (
        <p className="rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">
          {error}
        </p>
      )}

      {success && (
        <p className="rounded bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400">
          {t.profiles.autoStructureSuccess}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleAutoStructure}
          disabled={loading || !description.trim()}
          className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
          {loading ? t.profiles.autoStructuring : t.profiles.autoStructure}
        </button>

        <button
          type="button"
          onClick={onChooseTemplate}
          className="text-muted-foreground hover:text-foreground text-xs transition-colors"
        >
          {t.profiles.orChooseTemplate}
        </button>
      </div>
    </div>
  );
}
