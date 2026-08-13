import { useCallback, useMemo } from 'react';

import { ExternalLink, Heart, Loader2, RotateCw, Trash2 } from 'lucide-react';
import Lightbox from 'yet-another-react-lightbox';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import Video from 'yet-another-react-lightbox/plugins/video';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';

import 'yet-another-react-lightbox/plugins/counter.css';
import 'yet-another-react-lightbox/styles.css';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { CloudFile } from './cloudStorageLibraryUtils';

export interface MediaLightboxAction {
  pendingId?: string;
  onToggleFavorite?: (item: CloudFile) => Promise<void> | void;
  onDelete?: (item: CloudFile) => Promise<void> | void;
  onRotate?: (item: CloudFile, deg: number) => Promise<void> | void;
}

export interface MediaLightboxCapabilities {
  canFavorite: boolean;
  canDelete: boolean;
  canRotate: boolean;
}

interface CloudStorageMediaLightboxProps {
  open: boolean;
  index: number;
  items: CloudFile[];
  contentUrl: (item: CloudFile) => string;
  thumbnailUrl?: (item: CloudFile) => string | undefined;
  capabilities: MediaLightboxCapabilities;
  actions?: MediaLightboxAction;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
}

export function CloudStorageMediaLightbox({
  open,
  index,
  items,
  contentUrl,
  thumbnailUrl,
  capabilities,
  actions,
  onClose,
  onIndexChange,
}: CloudStorageMediaLightboxProps) {
  const { t } = useLanguage();
  const s = t.cloudStorage;

  const slides = useMemo(
    () =>
      items.map((item) => {
        const url = contentUrl(item);
        const thumb = thumbnailUrl?.(item) ?? url;
        if (item.mimeType?.startsWith('video/')) {
          return {
            type: 'video' as const,
            poster: thumb,
            sources: [
              {
                src: url,
                type: item.mimeType ?? 'video/mp4',
              },
            ],
            controls: true,
            preload: 'metadata' as const,
          };
        }
        return {
          src: url,
          alt: item.name,
        };
      }),
    [items, contentUrl, thumbnailUrl],
  );

  const currentItem = items[index];

  const handleOpenSource = useCallback(() => {
    const url = currentItem?.webUrl;
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [currentItem]);

  const toolbarButtons = useMemo(() => {
    if (!currentItem) return ['close' as const];
    const buttons: React.ReactNode[] = [];
    if (currentItem.webUrl) {
      buttons.push(
        <ToolbarButton
          key="open-source"
          label={s.previewOpenInSource}
          onClick={handleOpenSource}
        >
          <ExternalLink className="size-4" aria-hidden />
        </ToolbarButton>,
      );
    }
    if (capabilities.canFavorite && actions?.onToggleFavorite) {
      buttons.push(
        <ToolbarButton
          key="favorite"
          label={s.previewToggleFavorite}
          pending={actions.pendingId === currentItem.id}
          onClick={() => actions.onToggleFavorite?.(currentItem)}
          active={currentItem.mediaMetadata?.isFavorite}
        >
          <Heart className="size-4" aria-hidden />
        </ToolbarButton>,
      );
    }
    if (capabilities.canRotate && actions?.onRotate) {
      buttons.push(
        <ToolbarButton
          key="rotate"
          label={s.previewRotate}
          pending={actions.pendingId === currentItem.id}
          onClick={() => actions.onRotate?.(currentItem, 90)}
        >
          <RotateCw className="size-4" aria-hidden />
        </ToolbarButton>,
      );
    }
    if (capabilities.canDelete && actions?.onDelete) {
      buttons.push(
        <ToolbarButton
          key="delete"
          label={s.previewDelete}
          pending={actions.pendingId === currentItem.id}
          danger
          onClick={() => actions.onDelete?.(currentItem)}
        >
          <Trash2 className="size-4" aria-hidden />
        </ToolbarButton>,
      );
    }
    buttons.push('close' as never);
    return buttons;
  }, [
    actions,
    capabilities.canDelete,
    capabilities.canFavorite,
    capabilities.canRotate,
    currentItem,
    handleOpenSource,
    s.previewDelete,
    s.previewOpenInSource,
    s.previewRotate,
    s.previewToggleFavorite,
  ]);

  return (
    <Lightbox
      open={open}
      close={onClose}
      index={index}
      slides={slides}
      on={{
        view: ({ index: nextIndex }) => onIngestIndex(nextIndex, onIndexChange),
      }}
      plugins={[Counter, Fullscreen, Video, Zoom]}
      counter={{ container: { style: { top: 'unset', bottom: 16, left: 16 } } }}
      toolbar={{ buttons: toolbarButtons as never }}
      controller={{ closeOnBackdropClick: true }}
      carousel={{ finite: true, preload: 1, padding: 0, spacing: 0 }}
      styles={{
        container: { backgroundColor: 'rgba(0, 0, 0, 0.95)' },
        slide: { padding: 0 },
      }}
    />
  );
}

function onIngestIndex(
  next: number,
  onIndexChange?: (index: number) => void,
): void {
  onIndexChange?.(next);
}

function ToolbarButton({
  children,
  label,
  onClick,
  pending,
  active,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  pending?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={pending}
      className={cn(
        'yarl__button relative inline-flex size-10 items-center justify-center rounded-md text-white transition hover:bg-white/15 disabled:opacity-50',
        active && 'text-rose-400',
        danger && 'hover:bg-red-500/30 hover:text-red-200',
      )}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        children
      )}
    </button>
  );
}
