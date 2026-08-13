import { Loader2 } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

interface ProfileSaveBarProps {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

export function ProfileSaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
}: ProfileSaveBarProps) {
  const { t } = useLanguage();

  if (!dirty && !saving) return null;

  return (
    <div className="border-border bg-background/95 sticky bottom-0 z-10 flex items-center justify-between border-t px-6 py-3 backdrop-blur-sm">
      <p className="text-muted-foreground text-xs">
        {t.profiles.unsavedChanges}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDiscard}
          disabled={saving}
          className="text-muted-foreground hover:text-foreground rounded-lg px-3 py-1.5 text-sm transition-colors"
        >
          {t.profiles.discardChanges}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {saving ? t.profiles.saving : t.common.save}
        </button>
      </div>
    </div>
  );
}
