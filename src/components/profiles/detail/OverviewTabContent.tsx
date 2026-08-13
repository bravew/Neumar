import { useCallback, useEffect, useMemo, useState } from 'react';

import { Loader2, RefreshCw } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

import { Combobox } from '../Combobox';
import {
  getRoleComboOptions,
  INPUT_CLASS,
  LABEL_CLASS,
  ROLE_PRESETS,
} from '../profile-constants';

interface OverviewTabContentProps {
  role: string;
  description: string;
  systemPrompt: string;
  hasSoul: boolean;
  profileId: string;
  onRoleChange: (role: string, autoPrompt?: string) => void;
  onDescriptionChange: (desc: string) => void;
  onSystemPromptChange: (prompt: string) => void;
}

export function OverviewTabContent({
  role,
  description,
  systemPrompt,
  hasSoul,
  profileId,
  onRoleChange,
  onDescriptionChange,
  onSystemPromptChange,
}: OverviewTabContentProps) {
  const { t } = useLanguage();
  const roleOptions = useMemo(
    () => getRoleComboOptions(t.profiles),
    [t.profiles],
  );

  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const fetchPreview = useCallback(
    async (signal?: AbortSignal) => {
      if (!hasSoul || !profileId) return;
      setPreviewLoading(true);
      try {
        const res = await fetch(
          `${API_BASE_URL}/soul/agent-profiles/${profileId}/preview`,
          { signal },
        );
        if (res.ok) {
          const data = (await res.json()) as { rendered_prompt: string };
          setPreview(data.rendered_prompt);
        }
      } catch {
        // ignore abort
      } finally {
        setPreviewLoading(false);
      }
    },
    [hasSoul, profileId],
  );

  useEffect(() => {
    if (!hasSoul) {
      setPreview(null);
      return;
    }
    const ac = new AbortController();
    fetchPreview(ac.signal);
    return () => ac.abort();
  }, [hasSoul, fetchPreview]);

  const handleRoleChange = useCallback(
    (newRole: string) => {
      const preset = ROLE_PRESETS.find((r) => r.value === newRole);
      onRoleChange(newRole, preset?.systemPrompt);
    },
    [onRoleChange],
  );

  return (
    <div className="flex h-full flex-col gap-5">
      {/* Role */}
      <div className="shrink-0">
        <label className={LABEL_CLASS}>{t.profiles.role}</label>
        <Combobox
          value={role}
          onChange={handleRoleChange}
          options={roleOptions}
          placeholder={t.profiles.selectRuntime}
          allowCustom
        />
      </div>

      {/* Description */}
      <div className="shrink-0">
        <label className={LABEL_CLASS}>{t.profiles.description}</label>
        <input
          type="text"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder={t.profiles.description}
          className={INPUT_CLASS}
        />
      </div>

      {/* System Prompt */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1 flex shrink-0 items-center justify-between">
          <label className={LABEL_CLASS}>
            {hasSoul ? t.profiles.systemPromptPreview : t.profiles.systemPrompt}
          </label>
          {hasSoul && (
            <button
              type="button"
              onClick={() => fetchPreview()}
              disabled={previewLoading}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
            >
              <RefreshCw
                className={`size-3 ${previewLoading ? 'animate-spin' : ''}`}
              />
              {t.profiles.refreshPreview}
            </button>
          )}
        </div>

        {hasSoul ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            {previewLoading && !preview && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="text-muted-foreground size-5 animate-spin" />
              </div>
            )}
            {preview && (
              <pre className="bg-muted/50 border-border min-h-0 flex-1 overflow-auto rounded-lg border p-3 text-xs leading-relaxed whitespace-pre-wrap">
                {preview}
              </pre>
            )}
            {!preview && !previewLoading && (
              <p className="text-muted-foreground py-4 text-center text-xs">
                {t.profiles.noSoulForPreview}
              </p>
            )}
            <p className="text-muted-foreground mt-1 shrink-0 text-xs">
              {t.profiles.systemPromptPreviewDesc}
            </p>
          </div>
        ) : (
          <textarea
            value={systemPrompt}
            onChange={(e) => onSystemPromptChange(e.target.value)}
            rows={6}
            placeholder={t.profiles.systemPrompt}
            className={`${INPUT_CLASS} min-h-0 flex-1 resize-y font-mono text-xs`}
          />
        )}
      </div>
    </div>
  );
}
