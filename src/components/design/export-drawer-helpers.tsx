import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignDependencyStatus,
  DesignSurface,
} from '@/shared/types/design-mode';

export function DependencyRow({
  dependency,
}: {
  dependency: DesignDependencyStatus;
}) {
  const { t } = useLanguage();
  const tone =
    dependency.state === 'available'
      ? 'bg-emerald-500'
      : dependency.state === 'not-configured'
        ? 'bg-amber-500'
        : 'bg-destructive';
  const label =
    dependency.state === 'available'
      ? t.design.dependencyAvailable
      : dependency.state === 'not-configured'
        ? t.design.dependencyNotConfigured
        : t.design.dependencyMissing;
  return (
    <div className="rounded-md border p-2 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <span className={`size-2 rounded-full ${tone}`} />
          <span className="truncate">{dependency.label}</span>
        </span>
        <span className="text-muted-foreground shrink-0">{label}</span>
      </div>
      <p className="text-muted-foreground mt-1">
        {dependency.reason ||
          dependency.version ||
          dependency.usedFor.join(' · ')}
      </p>
      {dependency.installHint && dependency.state !== 'available' && (
        <p className="text-muted-foreground mt-1">{dependency.installHint}</p>
      )}
    </div>
  );
}

export function exportFormats(surface: DesignSurface) {
  if (surface === 'document') return ['md', 'txt', 'zip', 'designpkg'];
  if (surface === 'image') return ['png', 'jpeg', 'webp', 'zip', 'designpkg'];
  if (surface === 'audio') return ['wav', 'mp3', 'txt', 'zip', 'designpkg'];
  if (surface === 'video') return ['mp4', 'zip', 'designpkg'];
  if (surface === 'deck') return ['html', 'pdf', 'pptx', 'zip', 'designpkg'];
  return ['html', 'zip', 'designpkg'];
}

export function dependencyStatuses(
  surface: DesignSurface,
  format: string,
  dependencies: DesignDependencyStatus[],
) {
  const ids = dependencyIds(surface, format);
  return ids.map(
    (id) =>
      dependencies.find((dependency) => dependency.id === id) ?? {
        id,
        label: id,
        kind: 'renderer' as const,
        state: 'missing' as const,
        usedFor: [],
      },
  );
}

function dependencyIds(surface: DesignSurface, format: string) {
  if (['png', 'jpeg', 'jpg', 'webp'].includes(format) && surface === 'image') {
    return ['sharp'];
  }
  if (format === 'pdf') {
    return surface === 'document' ? ['pandoc', 'playwright'] : ['playwright'];
  }
  if (format === 'docx') return ['docx-renderer'];
  if (format === 'pptx') return ['pptxgenjs'];
  if (format === 'mp4') return ['hyperframes', 'ffmpeg'];
  if (format === 'mp3') return ['ffmpeg'];
  return [];
}

export function formatBytes(value?: number) {
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
