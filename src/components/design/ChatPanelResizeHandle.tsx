import { useEffect, useState } from 'react';

export function useStoredChatPanelWidth(projectId: string) {
  const [width, setWidth] = useState(() => readStoredChatPanelWidth(projectId));

  useEffect(() => {
    setWidth(readStoredChatPanelWidth(projectId));
  }, [projectId]);

  useEffect(() => {
    writeStoredChatPanelWidth(projectId, width);
  }, [projectId, width]);

  return [width, setWidth] as const;
}

export function ChatPanelResizeHandle({
  width,
  onWidthChange,
  label,
}: {
  width: number;
  onWidthChange: (width: number) => void;
  label: string;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      className="hover:bg-primary/40 absolute top-0 right-0 h-full w-1.5 cursor-col-resize"
      onMouseDown={(event) => {
        const startX = event.clientX;
        const startWidth = width;
        const move = (moveEvent: MouseEvent) => {
          onWidthChange(
            clampChatPanelWidth(startWidth + moveEvent.clientX - startX),
          );
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }}
      onDoubleClick={() => onWidthChange(420)}
    />
  );
}

function readStoredChatPanelWidth(projectId: string) {
  try {
    const value = globalThis.localStorage?.getItem?.(
      `neuma-design-chat-width:${projectId}`,
    );
    const width = Number(value || 420);
    return Number.isFinite(width) ? clampChatPanelWidth(width) : 420;
  } catch {
    return 420;
  }
}

function writeStoredChatPanelWidth(projectId: string, width: number) {
  try {
    globalThis.localStorage?.setItem?.(
      `neuma-design-chat-width:${projectId}`,
      String(width),
    );
  } catch {
    // Storage can be unavailable in tests, private windows, or locked-down webviews.
  }
}

function clampChatPanelWidth(width: number) {
  return Math.min(640, Math.max(320, width));
}
