import { useEffect, useMemo, useRef, useState } from 'react';

import {
  importedVividOverlayPreset,
  type VividOverlaySourceAsset,
} from '@neumar/video-ir';
import { FileJson, GripVertical, Upload, X } from 'lucide-react';

import type { useLanguage } from '@/shared/providers/language-provider';

import { OverlayCardPreview } from './OverlayCardPreview';
import {
  defaultOverlayClipDurationMs,
  writeOverlayPresetDrag,
} from './overlayDragPayload';
import {
  importedOverlayAssetUrl,
  type ImportedOverlayItem,
} from './useImportedOverlays';

type OverlayRailLabels = ReturnType<
  typeof useLanguage
>['t']['video']['editor']['overlayRail'];

const MAX_IMPORTED_PREVIEW_BYTES = 5 * 1024 * 1024;

export function ImportedOverlaySection({
  imports,
  onDelete,
  onImportLocal,
  railLabels,
}: {
  imports: ImportedOverlayItem[];
  onDelete: (id: string) => void;
  onImportLocal: (file: File) => Promise<boolean>;
  railLabels: OverlayRailLabels;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <section className="grid gap-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h3 className="text-muted-foreground text-[11px] font-semibold tracking-normal uppercase">
          {railLabels.importedOverlays}
        </h3>
        <button
          type="button"
          className="border-border bg-background text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-3" />
          <span>{railLabels.importLocal}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".gif,.json,.lottie,image/gif,application/json,application/lottie+json"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void onImportLocal(file);
          }}
        />
      </div>
      {imports.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {imports.map((item) => (
            <ImportedOverlayTile
              key={item.id}
              item={item}
              onDelete={onDelete}
              railLabels={railLabels}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ImportedOverlayTile({
  item,
  onDelete,
  railLabels,
}: {
  item: ImportedOverlayItem;
  onDelete: (id: string) => void;
  railLabels: OverlayRailLabels;
}) {
  const kindLabel = railLabels.importKinds[item.kind];
  const [engaged, setEngaged] = useState(false);
  const preset = importedVividOverlayPreset(item.kind);
  return (
    <div className="border-border bg-background hover:border-primary/60 relative grid min-w-0 gap-2 rounded-md border p-2 text-left transition-colors">
      <button
        type="button"
        draggable
        data-imported-overlay={item.id}
        className="grid min-w-0 gap-2 text-left focus-visible:outline-none"
        aria-label={railLabels.dragLabel.replace('{name}', item.name)}
        onBlur={() => setEngaged(false)}
        onDragStart={(event) =>
          writeOverlayPresetDrag(event.dataTransfer, {
            type: 'imported-overlay',
            importId: item.id,
            kind: item.kind,
            clipDurationMs: defaultOverlayClipDurationMs(preset.id),
            name: item.name,
          })
        }
        onFocus={() => setEngaged(true)}
        onMouseEnter={() => setEngaged(true)}
        onMouseLeave={() => setEngaged(false)}
      >
        <span className="bg-muted relative grid aspect-video place-items-center overflow-hidden rounded">
          {item.kind === 'gif' ? (
            <img
              src={importedOverlayAssetUrl(item.id)}
              alt=""
              className="size-full object-contain"
              loading="lazy"
            />
          ) : (
            <ImportedLottiePreview animate={engaged} item={item} />
          )}
        </span>
        <span className="flex min-w-0 items-start gap-1.5">
          <GripVertical className="text-muted-foreground mt-0.5 size-3 shrink-0" />
          <span className="grid min-w-0 gap-0.5">
            <span className="text-foreground truncate text-xs font-semibold">
              {item.name}
            </span>
            <span className="text-muted-foreground truncate text-[11px]">
              {kindLabel} - {formatBytes(item.source.sizeBytes)}
            </span>
          </span>
        </span>
      </button>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground bg-background/80 absolute top-1 right-1 rounded p-0.5"
        aria-label={railLabels.deleteImport.replace('{name}', item.name)}
        onClick={() => onDelete(item.id)}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function ImportedLottiePreview({
  animate,
  item,
}: {
  animate: boolean;
  item: ImportedOverlayItem;
}) {
  const [sourceAsset, setSourceAsset] =
    useState<VividOverlaySourceAsset | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setSourceAsset(null);
    setFailed(false);
    fetch(importedOverlayAssetUrl(item.id), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        const buffer = await response.arrayBuffer();
        if (
          buffer.byteLength === 0 ||
          buffer.byteLength > MAX_IMPORTED_PREVIEW_BYTES
        ) {
          return null;
        }
        return {
          base64: arrayBufferToBase64(buffer),
          mimeType:
            response.headers.get('content-type') ?? item.source.mimeType,
        };
      })
      .then((asset) => {
        if (!controller.signal.aborted) {
          setSourceAsset(asset);
          setFailed(asset === null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [item.id, item.source.mimeType]);

  const preset = useMemo(() => importedVividOverlayPreset('lottie'), []);
  if (!sourceAsset || failed) {
    return <FileJson className="text-muted-foreground size-6" />;
  }
  return (
    <OverlayCardPreview
      animate={animate}
      preset={preset}
      sourceAsset={sourceAsset}
      sourceAssetCacheKey={item.id}
    />
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)),
    );
  }
  return btoa(chunks.join(''));
}
