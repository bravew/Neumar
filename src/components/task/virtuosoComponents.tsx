import type { HTMLAttributes } from 'react';

/**
 * Module-level Virtuoso components. Defining them inline in the list breaks
 * memoization, because Virtuoso remounts every item when the object identity
 * changes.
 */
export const VIRTUOSO_COMPONENTS = {
  Item: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props} className="mx-auto max-w-4xl px-4">
      {children}
    </div>
  ),
};
