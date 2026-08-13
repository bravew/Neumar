import { useState } from 'react';

import { Import, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignProject, DesignSurface } from '@/shared/types/design-mode';

import { ImportDialog } from './ImportDialog';

export function NewProjectSubmitActions({
  creating,
  createError,
  createLabel,
  surface,
  onCreate,
  onCreated,
}: {
  creating: boolean;
  createError: string;
  createLabel: string;
  surface: DesignSurface;
  onCreate: () => void;
  onCreated: (project: DesignProject) => void;
}) {
  const { t } = useLanguage();
  const [importOpen, setImportOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        className="w-full"
        disabled={creating}
        onClick={onCreate}
        data-testid="design-create-project-button"
      >
        <Plus className="size-4" />
        {creating ? t.design.creating : createLabel}
      </Button>
      {createError && (
        <p className="text-destructive text-sm" role="alert">
          {createError}
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        className="w-full justify-start"
        onClick={() => setImportOpen(true)}
        data-testid="design-import-project-button"
      >
        <Import className="size-4" />
        {t.design.importClaudeZip}
      </Button>
      <p className="text-muted-foreground text-xs">{t.design.privacyFooter}</p>
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        surface={surface}
        onImported={(project) => {
          setImportOpen(false);
          onCreated(project);
        }}
      />
    </>
  );
}
