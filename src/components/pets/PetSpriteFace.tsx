import { useEffect, useMemo, useRef } from 'react';

import { cn } from '@/shared/lib/utils';
import type { PetCatalogItem } from '@/shared/pets/catalog';
import {
  pickAtlasRow,
  preferredRowId,
  type PetInteraction,
} from '@/shared/pets/pets';

interface PetSpriteFaceProps {
  pet: PetCatalogItem;
  interaction: PetInteraction;
  ambientRowId?: string | null;
  reducedMotion: boolean;
  className?: string;
}

export function PetSpriteFace({
  pet,
  interaction,
  ambientRowId,
  reducedMotion,
  className,
}: PetSpriteFaceProps) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const preferred = ambientRowId ?? preferredRowId(interaction);
  const row = useMemo(
    () => pickAtlasRow(pet.atlasLayout, preferred),
    [pet.atlasLayout, preferred],
  );
  const frameCount = row?.frames ?? 1;
  const fps = row?.fps ?? 6;

  useEffect(() => {
    const node = nodeRef.current;
    if (!node || !pet.spritesheetUrl) return;
    const element = node;

    let frame = 0;
    let rafId = 0;
    let last = 0;
    const frameMs = 1000 / Math.max(1, fps);

    function paint(nextFrame: number) {
      const currentRow = row?.index ?? 0;
      const cols = pet.atlasLayout.cols;
      const rows = pet.atlasLayout.rows;
      const x = cols <= 1 ? 0 : (nextFrame / (cols - 1)) * 100;
      const y = rows <= 1 ? 0 : (currentRow / (rows - 1)) * 100;

      element.style.backgroundPosition = `${x}% ${y}%`;
    }

    paint(0);

    if (reducedMotion || frameCount <= 1) return;

    function tick(timestamp: number) {
      if (!last) last = timestamp;

      if (timestamp - last >= frameMs) {
        frame = (frame + 1) % frameCount;
        paint(frame);
        last = timestamp;
      }

      rafId = window.requestAnimationFrame(tick);
    }

    function startRaf() {
      if (rafId) return;
      last = 0;
      rafId = window.requestAnimationFrame(tick);
    }

    function stopRaf() {
      if (!rafId) return;
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }

    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        stopRaf();
      } else {
        startRaf();
      }
    }

    if (document.visibilityState !== 'hidden') startRaf();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      stopRaf();
    };
  }, [
    fps,
    frameCount,
    pet.atlasLayout.cols,
    pet.atlasLayout.rows,
    pet.spritesheetUrl,
    reducedMotion,
    row?.index,
  ]);

  if (!pet.spritesheetUrl) {
    return (
      <span
        className={cn(
          'grid size-16 place-items-center rounded-full text-4xl',
          className,
        )}
      >
        {pet.glyph}
      </span>
    );
  }

  return (
    <div
      ref={nodeRef}
      className={cn(
        'h-[72px] w-[66px] bg-no-repeat [image-rendering:pixelated]',
        className,
      )}
      data-pet-row={row?.id ?? 'strip'}
      style={{
        backgroundImage: `url(${pet.spritesheetUrl})`,
        backgroundSize: `${pet.atlasLayout.cols * 100}% ${
          pet.atlasLayout.rows * 100
        }%`,
        aspectRatio: '192 / 208',
      }}
    />
  );
}
