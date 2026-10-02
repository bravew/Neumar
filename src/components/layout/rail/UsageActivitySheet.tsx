import { lazy, Suspense } from 'react';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useLanguage } from '@/shared/providers/language-provider';

// The charts stay in the Dashboard chunk until the sheet first opens.
const DashboardBody = lazy(() =>
  import('@/app/pages/Dashboard').then((module) => ({
    default: module.DashboardBody,
  })),
);

/**
 * Usage & activity over the current page (decided on #121 and #164), so
 * checking it doesn't navigate away. `/dashboard` stays as a deep link.
 */
export function UsageActivitySheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        data-testid="usage-activity-sheet"
        className="w-full overflow-y-auto sm:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>{t.dashboard.title}</SheetTitle>
        </SheetHeader>
        <div className="mt-6">
          {open ? (
            <Suspense fallback={null}>
              <DashboardBody />
            </Suspense>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
