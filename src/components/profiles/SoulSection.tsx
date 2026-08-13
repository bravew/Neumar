/**
 * SoulSection — extracted from ProfileDialog to keep it under 350 lines.
 *
 * Renders the soul summary card, "Edit Soul" / "Choose Template" buttons,
 * the nested soul editor dialog, and the template picker dialog.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import * as Dialog from '@radix-ui/react-dialog';
import { Sparkles, X } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import type { useLanguage } from '@/shared/providers/language-provider';
import type { AgentSoul } from '@/shared/types/agent-profile';

import { LABEL_CLASS } from './profile-constants';
import { SoulEditor } from './soul/SoulEditor';
import type { CorrectionEntry, LearningEntry } from './soul/SoulEvolutionTab';
import { SoulTemplatePicker } from './SoulTemplatePicker';

interface SoulSectionProps {
  soul: AgentSoul | null;
  soulVersion: number;
  profileId: string | null;
  language: string;
  onSoulChange: (soul: AgentSoul) => void;
  onSoulApplied: (soul: AgentSoul) => void;
  t: ReturnType<typeof useLanguage>['t'];
}

export function SoulSection({
  soul,
  soulVersion,
  profileId,
  language,
  onSoulChange,
  onSoulApplied,
  t,
}: SoulSectionProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [corrections, setCorrections] = useState<CorrectionEntry[]>([]);
  const [learnings, setLearnings] = useState<LearningEntry[]>([]);
  const fetchedForRef = useRef<string | null>(null);

  // Separate from the soul prop fetch — corrections/learnings are read-only
  // evolution data that only the Evolution tab needs.
  useEffect(() => {
    if (!editorOpen || !profileId) return;
    if (fetchedForRef.current === profileId) return;
    const controller = new AbortController();
    Promise.all([
      fetch(`${API_BASE_URL}/soul/agent-profiles/${profileId}/corrections`, {
        signal: controller.signal,
      }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API_BASE_URL}/soul/agent-profiles/${profileId}/learnings`, {
        signal: controller.signal,
      }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([corr, learn]) => {
        fetchedForRef.current = profileId;
        setCorrections(Array.isArray(corr) ? corr : []);
        setLearnings(Array.isArray(learn) ? learn : []);
      })
      .catch(() => {
        // Non-abort errors allow retry on next editor open
      });
    return () => controller.abort();
  }, [editorOpen, profileId]);

  const handleTemplateApplied = useCallback(async () => {
    // After template is applied via API, refetch the profile soul
    if (!profileId) return;
    try {
      const res = await fetch(
        `${API_BASE_URL}/soul/agent-profiles/${profileId}`,
      );
      if (res.ok) {
        const data = (await res.json()) as {
          soul: AgentSoul | null;
          soul_version: number;
        };
        if (data.soul) {
          onSoulApplied(data.soul);
        }
      }
    } catch {
      // Silently fail — user can re-open to see changes
    }
  }, [profileId, onSoulApplied]);

  return (
    <>
      {/* Soul summary card */}
      <div className="border-border space-y-2 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <label className={cn(LABEL_CLASS, 'flex items-center gap-1.5')}>
            <Sparkles className="size-3.5" />
            {t.profiles.soulEditor}
            {soul && (
              <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[10px] font-medium">
                v{soulVersion}
              </span>
            )}
          </label>
          <div className="flex gap-1.5">
            {profileId && (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="text-muted-foreground hover:text-foreground rounded px-2 py-0.5 text-xs transition-colors"
              >
                {t.profiles.chooseSoulTemplate}
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="bg-primary/10 text-primary hover:bg-primary/20 rounded px-2 py-0.5 text-xs font-medium transition-colors"
            >
              {t.profiles.editSoul}
            </button>
          </div>
        </div>
        {soul && (
          <div className="text-muted-foreground space-y-0.5 text-xs">
            <div>
              <span className="text-foreground/70 font-medium">
                {t.profiles.soulRole}:
              </span>{' '}
              {soul.identity.role}
            </div>
            <div>
              <span className="text-foreground/70 font-medium">
                {t.profiles.soulTone}:
              </span>{' '}
              {soul.voice.tone}
            </div>
            <div>
              {soul.identity.core_values.length}{' '}
              {t.profiles.soulCoreValues.toLowerCase()} ·{' '}
              {soul.boundaries.red_lines.length}{' '}
              {t.profiles.soulRedLines.toLowerCase()}
            </div>
          </div>
        )}
      </div>

      {/* Soul Editor Dialog */}
      <Dialog.Root open={editorOpen} onOpenChange={setEditorOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
          <Dialog.Content className="bg-background border-border fixed top-1/2 left-1/2 z-[60] max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <Dialog.Title className="text-foreground text-base font-semibold">
                {t.profiles.soulEditor}
              </Dialog.Title>
              <Dialog.Close className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <SoulEditor
              soul={soul}
              onChange={onSoulChange}
              corrections={corrections}
              learnings={learnings}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Soul Template Picker */}
      {profileId && (
        <SoulTemplatePicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          profileId={profileId}
          language={language}
          onApplied={handleTemplateApplied}
          t={t}
        />
      )}
    </>
  );
}
