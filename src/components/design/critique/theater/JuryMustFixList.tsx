import type { JuryMustFixItem } from '../critique-reducer';

export function JuryMustFixList({
  title,
  items,
}: {
  title: string;
  items: JuryMustFixItem[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-muted-foreground text-[11px] font-medium tracking-normal uppercase">
        {title}
      </p>
      <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs">
        {items.map((item) => (
          <li key={item.id}>{item.body}</li>
        ))}
      </ol>
    </div>
  );
}
