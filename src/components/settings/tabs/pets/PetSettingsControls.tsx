import { PetSpriteFace } from '@/components/pets/PetSpriteFace';
import { cn } from '@/shared/lib/utils';
import type { PetCatalogItem } from '@/shared/pets/catalog';

import { Switch } from '../../components/Switch';

export function PetSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-foreground text-sm font-semibold">{title}</h3>
        <p className="text-muted-foreground mt-1 text-xs">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function PetChoiceButton({
  pet,
  description,
  selected,
  reducedMotion,
  selectedLabel,
  actionLabel,
  actionIcon,
  disabled,
  onClick,
}: {
  pet: PetCatalogItem;
  description: string;
  selected: boolean;
  reducedMotion: boolean;
  selectedLabel: string;
  actionLabel: string;
  actionIcon?: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'border-border bg-card hover:bg-accent/40 flex min-h-32 cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        selected && 'border-primary bg-primary/5',
      )}
    >
      <span
        className="grid size-20 shrink-0 place-items-center rounded-lg border"
        style={{ borderColor: pet.accent }}
      >
        <PetSpriteFace
          pet={pet}
          interaction="idle"
          reducedMotion={reducedMotion}
          className="scale-90"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-sm font-medium">
          {pet.name}
        </span>
        <span className="text-muted-foreground mt-1 line-clamp-3 block text-xs">
          {description}
        </span>
        <span className="mt-2 flex items-center gap-2 text-xs">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
              selected
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {actionIcon}
            {selected ? selectedLabel : actionLabel}
          </span>
        </span>
      </span>
    </button>
  );
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground mt-1 text-xs">{description}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}
