import type { ReactNode } from 'react';

import { useDelayedLoading } from '@/components/common/use-delayed-loading';

export type AsyncListStatus = 'loading' | 'ready' | 'error';

interface AsyncListProps {
  status: AsyncListStatus;
  /** True when the loaded collection has nothing to show. Ignored until ready. */
  empty: boolean;
  renderSkeleton: () => ReactNode;
  renderEmpty: () => ReactNode;
  renderError: () => ReactNode;
  children: ReactNode;
}

/**
 * List states are a single prop, so an empty state cannot render while data
 * is still loading or after a failed load. The skeleton waits out the
 * shared delay, then stays up for the minimum visible time.
 */
export function AsyncList({
  status,
  empty,
  renderSkeleton,
  renderEmpty,
  renderError,
  children,
}: AsyncListProps) {
  const showSkeleton = useDelayedLoading(status === 'loading');

  if (status === 'loading' || showSkeleton) {
    if (!showSkeleton) {
      return <div data-testid="async-list-pending" aria-busy="true" />;
    }
    return <>{renderSkeleton()}</>;
  }

  if (status === 'error') {
    return <>{renderError()}</>;
  }

  if (empty) {
    return <>{renderEmpty()}</>;
  }

  return <>{children}</>;
}
