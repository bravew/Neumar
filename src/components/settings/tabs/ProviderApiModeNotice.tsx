import { Info } from 'lucide-react';

export function ProviderApiModeNotice({ message }: { message: string }) {
  return (
    <div className="border-border bg-muted/40 text-muted-foreground flex items-start gap-2 rounded-md border p-3 text-xs">
      <Info className="mt-0.5 size-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}
