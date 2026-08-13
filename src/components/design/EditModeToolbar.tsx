import { useLanguage } from '@/shared/providers/language-provider';

export function EditModeToolbar() {
  const { t } = useLanguage();
  return (
    <div className="bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm">
      {t.design.editToolbarHint}
    </div>
  );
}
