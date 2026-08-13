import { ImageDown, Share2, SlidersHorizontal } from 'lucide-react';

import type { PaletteBridgeRequest } from '@/components/artifacts/live/palette-bridge';
import { Button } from '@/components/ui/button';
import type { DesignLintFinding } from '@/shared/types/design-mode';

import { DevicePicker, type DeviceViewportId } from './DevicePicker';
import { PaletteTweaks } from './PaletteTweaks';
import { PreviewModeSegments, type PreviewMode } from './PreviewModeSegments';

interface FileViewerToolbarProps {
  path: string;
  effectiveMode: PreviewMode;
  availableModes: PreviewMode[];
  isHtml: boolean;
  isMedia: boolean;
  isText: boolean;
  zoom: number;
  deviceViewport: DeviceViewportId;
  paletteAllowed: boolean;
  palettePreset: string;
  linting: boolean;
  lintFindings: DesignLintFinding[];
  canExportImage: boolean;
  labels: {
    projectPathPrefix: string;
    paletteTweaks: string;
    paletteOriginal: string;
    paletteCoral: string;
    paletteElectric: string;
    paletteAcidForest: string;
    paletteRisograph: string;
    paletteMonoNoir: string;
    saving: string;
    lintNow: string;
    lintClean: string;
    lintIssues: string;
    exportTitle: string;
    exportAsImage: string;
  };
  onModeChange: (mode: PreviewMode) => void;
  onDeviceViewportChange: (value: DeviceViewportId) => void;
  onPaletteChange: (id: string, request: PaletteBridgeRequest) => void;
  onZoomChange: (value: number) => void;
  onLint: () => void;
  onOpenExports: () => void;
  onExportImage: () => void;
}

export function FileViewerToolbar({
  path,
  effectiveMode,
  availableModes,
  isHtml,
  isMedia,
  isText,
  zoom,
  deviceViewport,
  paletteAllowed,
  palettePreset,
  linting,
  lintFindings,
  canExportImage,
  labels,
  onModeChange,
  onDeviceViewportChange,
  onPaletteChange,
  onZoomChange,
  onLint,
  onOpenExports,
  onExportImage,
}: FileViewerToolbarProps) {
  const lintTone = lintFindings.some((finding) => finding.severity === 'p0')
    ? 'bg-destructive/10 text-destructive'
    : lintFindings.length > 0
      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : 'bg-muted text-muted-foreground';

  return (
    <header className="border-border flex shrink-0 flex-wrap items-center justify-between gap-3 border-b p-3">
      <div className="min-w-0">
        <p className="text-muted-foreground truncate text-xs">
          {labels.projectPathPrefix} / {path}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <PreviewModeSegments
          value={effectiveMode}
          onChange={onModeChange}
          modes={availableModes}
        />
        {isHtml && effectiveMode !== 'source' && (
          <DevicePicker
            value={deviceViewport}
            onChange={onDeviceViewportChange}
          />
        )}
        {paletteAllowed && effectiveMode !== 'source' && (
          <PaletteTweaks
            value={palettePreset}
            labels={{
              paletteTweaks: labels.paletteTweaks,
              original: labels.paletteOriginal,
              coral: labels.paletteCoral,
              electric: labels.paletteElectric,
              acidForest: labels.paletteAcidForest,
              risograph: labels.paletteRisograph,
              monoNoir: labels.paletteMonoNoir,
            }}
            onChange={onPaletteChange}
          />
        )}
        {effectiveMode !== 'source' && (isHtml || isMedia) && (
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            {zoom}%
            <input
              type="range"
              min={50}
              max={200}
              value={zoom}
              onChange={(event) => onZoomChange(Number(event.target.value))}
            />
          </label>
        )}
        {isText && effectiveMode !== 'source' && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={linting}
              onClick={onLint}
            >
              <SlidersHorizontal className="size-4" />
              {linting ? labels.saving : labels.lintNow}
            </Button>
            <span className={`rounded px-2 py-1 text-xs ${lintTone}`}>
              {lintFindings.length === 0
                ? labels.lintClean
                : labels.lintIssues.replace(
                    '{count}',
                    String(lintFindings.length),
                  )}
            </span>
          </>
        )}
        {canExportImage && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={labels.exportAsImage}
            title={labels.exportAsImage}
            onClick={onExportImage}
          >
            <ImageDown className="size-4" />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={labels.exportTitle}
          onClick={onOpenExports}
        >
          <Share2 className="size-4" />
        </Button>
      </div>
    </header>
  );
}
