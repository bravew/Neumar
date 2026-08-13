import { useEffect, useRef, useState, type ReactNode } from 'react';

import { HtmlSandbox } from '@/components/artifacts/live/HtmlSandbox';
import type {
  InspectStylePatch,
  NeumaTargetPayload,
} from '@/components/artifacts/live/iframe-sandbox';
import type { PaletteBridgeRequest } from '@/components/artifacts/live/palette-bridge';

import { DEVICE_VIEWPORTS, type DeviceViewportId } from './DevicePicker';
import { parseNeumaTarget, parseNeumaTargetList } from './file-viewer-utils';
import type { PreviewMode } from './PreviewModeSegments';

interface HtmlPreviewFrameProps {
  html: string;
  identity: string;
  mode: PreviewMode;
  zoom: number;
  viewport: DeviceViewportId;
  inspectPatch: InspectStylePatch | null;
  paletteBridge?: string;
  paletteRequest: PaletteBridgeRequest | null;
  fitLabel: string;
  onTarget: (target: NeumaTargetPayload) => void;
  onTargets?: (targets: NeumaTargetPayload[]) => void;
  onFrameRef?: (node: HTMLIFrameElement | null) => void;
  /** Render the artifact as a full document (keep head styles, run scripts). */
  renderFullDocument?: boolean;
  children?: ReactNode;
}

export function HtmlPreviewFrame({
  html,
  identity,
  mode,
  zoom,
  viewport,
  inspectPatch,
  paletteBridge,
  paletteRequest,
  fitLabel,
  onTarget,
  onTargets,
  onFrameRef,
  renderFullDocument,
  children,
}: HtmlPreviewFrameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const fixedViewport = viewport === 'auto' ? null : DEVICE_VIEWPORTS[viewport];

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => setContainerWidth(node.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const fitScale =
    fixedViewport && containerWidth > 0 && fixedViewport.width > containerWidth
      ? Math.max(0.25, containerWidth / fixedViewport.width)
      : 1;
  const scale = (zoom / 100) * fitScale;
  const outerWidth = fixedViewport ? fixedViewport.width * scale : '100%';
  const outerHeight = fixedViewport
    ? Math.max(1, fixedViewport.height * scale)
    : undefined;
  const frameWidth = fixedViewport ? fixedViewport.width : '100%';
  const frameHeight = fixedViewport ? fixedViewport.height : undefined;

  return (
    <div ref={containerRef} className="min-w-0">
      {fitScale < 1 && (
        <div className="mb-2 flex justify-center">
          <span className="bg-muted text-muted-foreground rounded px-2 py-1 text-xs">
            {fitLabel.replace('{percent}', String(Math.round(fitScale * 100)))}
          </span>
        </div>
      )}
      <div
        className="mx-auto origin-top"
        style={{ width: outerWidth, height: outerHeight, minWidth: 320 }}
      >
        <div
          className="relative min-h-[640px] rounded-md border"
          style={{
            width: frameWidth,
            height: frameHeight,
            transform: `scale(${scale})`,
            transformOrigin: 'top center',
          }}
        >
          <HtmlSandbox
            html={html}
            identity={identity}
            renderFullDocument={renderFullDocument}
            fixedHeight={frameHeight}
            selectBridgeMode={
              mode === 'inspect'
                ? 'inspect'
                : mode === 'comment'
                  ? 'comment'
                  : mode === 'edit'
                    ? 'target'
                    : 'off'
            }
            inspectPatch={inspectPatch}
            paletteBridge={paletteBridge}
            paletteRequest={paletteRequest}
            onFrameRef={onFrameRef}
            onMessage={({ payload }) => {
              const targets = parseNeumaTargetList(payload);
              if (targets.length > 0) onTargets?.(targets);
              if (mode !== 'inspect' && mode !== 'comment' && mode !== 'edit') {
                return;
              }
              const next = parseNeumaTarget(payload);
              if (next) onTarget(next);
            }}
          />
          {children}
        </div>
      </div>
    </div>
  );
}
