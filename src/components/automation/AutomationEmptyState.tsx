/**
 * AutomationEmptyState
 *
 * Displayed when no automations exist yet.
 */

import { Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/shared/providers/language-provider';

interface AutomationEmptyStateProps {
  onCreate: () => void;
}

export function AutomationEmptyState({ onCreate }: AutomationEmptyStateProps) {
  const { t } = useLanguage();

  return (
    <div
      className="flex flex-col items-center justify-center py-20 text-center"
      aria-label="No automations"
    >
      <div className="bg-primary/10 mb-4 flex size-14 items-center justify-center rounded-full">
        <Zap className="text-primary size-7" />
      </div>
      <h3 className="text-foreground mb-2 text-lg font-semibold">
        {t.automation.empty}
      </h3>
      <p className="text-muted-foreground mb-6 max-w-sm text-sm">
        {t.automation.emptyDescription}
      </p>
      <Button onClick={onCreate} aria-label={t.automation.create}>
        <Zap className="mr-2 size-4" />
        {t.automation.create}
      </Button>
    </div>
  );
}
