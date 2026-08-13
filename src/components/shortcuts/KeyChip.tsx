import { formatChord } from '@/shared/hotkeys/format';

export function KeyChip({ chord }: { chord: string }) {
  return (
    <kbd className="bg-muted text-muted-foreground rounded-md px-2 py-1 font-mono text-xs">
      {formatChord(chord)}
    </kbd>
  );
}
