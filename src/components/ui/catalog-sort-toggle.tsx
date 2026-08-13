import type { CatalogSortOrder } from '@/shared/utils/catalog-sort';

// Segmented curated/newest control shared by catalog surfaces (07-06 Open
// Design sync). Render it only when the catalog's records carry real
// timestamps — a `newest` order over timestamp-less records is a no-op.
export function CatalogSortToggle({
  order,
  onChange,
  curatedLabel,
  newestLabel,
  testId,
}: {
  order: CatalogSortOrder;
  onChange: (order: CatalogSortOrder) => void;
  curatedLabel: string;
  newestLabel: string;
  testId: string;
}) {
  const buttonClass = (active: boolean) =>
    `rounded px-2 py-1 text-xs transition-colors ${
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'
    }`;
  return (
    <div
      className="border-border bg-muted inline-flex items-center gap-1 rounded-md border p-1"
      role="group"
      data-testid={testId}
    >
      <button
        type="button"
        className={buttonClass(order === 'curated')}
        onClick={() => onChange('curated')}
        aria-pressed={order === 'curated'}
      >
        {curatedLabel}
      </button>
      <button
        type="button"
        className={buttonClass(order === 'newest')}
        onClick={() => onChange('newest')}
        aria-pressed={order === 'newest'}
      >
        {newestLabel}
      </button>
    </div>
  );
}
