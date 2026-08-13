import { AspectCards } from './AspectCards';
import { MediaModelCards } from './MediaModelCards';

export function MediaSettingsPanel({
  model,
  aspect,
  onModel,
  onAspect,
}: {
  model?: string;
  aspect?: string;
  onModel: (model: string) => void;
  onAspect: (aspect: string) => void;
}) {
  return (
    <div className="space-y-3">
      <MediaModelCards value={model} onChange={onModel} />
      <AspectCards value={aspect} onChange={onAspect} />
    </div>
  );
}
