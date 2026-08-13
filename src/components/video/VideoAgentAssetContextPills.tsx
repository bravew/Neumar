import { X } from 'lucide-react';

export interface VideoAgentAssetContextItem {
  id: string;
  name: string;
  summary?: string;
}

interface VideoAgentAssetContextPillsProps {
  assets: VideoAgentAssetContextItem[];
  assetContextLabel: string;
  removeAssetContextLabel: string;
  onRemoveAssetContext?: (assetId: string) => void;
}

export function VideoAgentAssetContextPills({
  assets,
  assetContextLabel,
  removeAssetContextLabel,
  onRemoveAssetContext,
}: VideoAgentAssetContextPillsProps) {
  if (assets.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {assets.map((asset) => (
        <li
          key={asset.id}
          className="border-primary/30 bg-primary/10 text-foreground flex max-w-[220px] items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
          title={
            asset.summary ? `${asset.name} - ${asset.summary}` : asset.name
          }
        >
          <span className="text-primary shrink-0 font-medium">
            {assetContextLabel}
          </span>
          <span className="truncate">{asset.name}</span>
          {onRemoveAssetContext ? (
            <button
              type="button"
              aria-label={removeAssetContextLabel.replace('{name}', asset.name)}
              onClick={() => onRemoveAssetContext(asset.id)}
              className="text-muted-foreground hover:text-destructive shrink-0"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
