import type { ReactNode } from 'react';

import { HeldSuspense } from '@/components/common/held-suspense';
import {
  RouteSkeleton,
  type RouteSkeletonShape,
} from '@/components/common/route-skeleton';
import { SetupGuard } from '@/components/setup-guard';

export function RouteFallback({
  shape,
  children,
  guard = true,
}: {
  shape: RouteSkeletonShape;
  children: ReactNode;
  guard?: boolean;
}) {
  const page = (
    <HeldSuspense fallback={<RouteSkeleton shape={shape} />}>
      {children}
    </HeldSuspense>
  );
  if (!guard) return page;
  return <SetupGuard>{page}</SetupGuard>;
}
