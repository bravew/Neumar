import { useEffect, useMemo, useRef, useState } from 'react';

import { TeleprompterControls } from '@/components/video/TeleprompterControls';
import {
  TELEPROMPTER_EVENT_CONTROL,
  TELEPROMPTER_EVENT_STATE,
  type TeleprompterControlPayload,
  type TeleprompterStatePayload,
} from '@/shared/lib/teleprompter';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

const DEFAULT_STATE: TeleprompterStatePayload = {
  script: '',
  wpm: 150,
  fontSize: 44,
  mirror: false,
  opacity: 95,
  running: false,
  elapsedMs: 0,
};

export function TeleprompterPage() {
  const { t } = useLanguage();
  const [state, setState] = useState<TeleprompterStatePayload>(DEFAULT_STATE);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const words = useMemo(
    () => state.script.split(/\s+/).filter(Boolean),
    [state.script],
  );
  const progress = teleprompterProgress(words.length, elapsedMs, state.wpm);

  useEffect(() => {
    let cancelled = false;
    let unlistenState: (() => void) | undefined;
    let unlistenControl: (() => void) | undefined;

    async function subscribe() {
      const { listen } = await import('@tauri-apps/api/event');
      if (cancelled) return;
      unlistenState = await listen<TeleprompterStatePayload>(
        TELEPROMPTER_EVENT_STATE,
        ({ payload }) => {
          const next = normalizeTeleprompterState(payload);
          setState(next);
          startedAtRef.current = Date.now() - next.elapsedMs;
          setElapsedMs(next.elapsedMs);
        },
      );
      unlistenControl = await listen<TeleprompterControlPayload>(
        TELEPROMPTER_EVENT_CONTROL,
        ({ payload }) => {
          if (payload.type === 'reset') {
            startedAtRef.current = Date.now();
            setElapsedMs(0);
            setState((prev) => ({ ...prev, running: false, elapsedMs: 0 }));
          } else if (payload.type === 'start') {
            startedAtRef.current = Date.now() - payload.elapsedMs;
            setElapsedMs(payload.elapsedMs);
            setState((prev) => ({
              ...prev,
              running: true,
              elapsedMs: payload.elapsedMs,
            }));
          } else {
            setElapsedMs(payload.elapsedMs);
            setState((prev) => ({
              ...prev,
              running: false,
              elapsedMs: payload.elapsedMs,
            }));
          }
        },
      );
    }

    subscribe().catch((error) => {
      if (import.meta.env.DEV) {
        console.error('[Teleprompter] event setup failed:', error);
      }
    });

    return () => {
      cancelled = true;
      unlistenState?.();
      unlistenControl?.();
    };
  }, []);

  useEffect(() => {
    if (!state.running) return;
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 200);
    return () => window.clearInterval(timer);
  }, [state.running]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const maxScroll = Math.max(0, node.scrollHeight - node.clientHeight);
    node.scrollTop = maxScroll * progress;
  }, [progress]);

  const start = () => {
    startedAtRef.current = Date.now() - elapsedMs;
    setState((prev) => ({ ...prev, running: true, elapsedMs }));
  };

  const pause = () => {
    setState((prev) => ({ ...prev, running: false, elapsedMs }));
  };

  const reset = () => {
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setState((prev) => ({ ...prev, running: false, elapsedMs: 0 }));
  };

  return (
    <main className="bg-background text-foreground flex h-screen flex-col overflow-hidden">
      <div
        ref={scrollRef}
        className={cn(
          'min-h-0 flex-1 overflow-hidden px-10 py-16 leading-[1.35]',
          state.mirror && 'scale-x-[-1]',
        )}
        style={{
          fontSize: state.fontSize,
          opacity: state.opacity / 100,
        }}
      >
        {state.script.trim() ? (
          <p className="mx-auto max-w-4xl whitespace-pre-wrap">
            {state.script}
          </p>
        ) : (
          <p className="text-muted-foreground flex h-full items-center justify-center text-center text-2xl">
            {t.video.editor.capture.teleprompter.empty}
          </p>
        )}
      </div>
      <TeleprompterControls
        running={state.running}
        wpm={state.wpm}
        fontSize={state.fontSize}
        mirror={state.mirror}
        onStart={start}
        onPause={pause}
        onReset={reset}
        onWpmChange={(wpm) => setState((prev) => ({ ...prev, wpm }))}
        onFontSizeChange={(fontSize) =>
          setState((prev) => ({ ...prev, fontSize }))
        }
        onMirrorChange={(mirror) => setState((prev) => ({ ...prev, mirror }))}
      />
    </main>
  );
}

export function teleprompterProgress(
  wordCount: number,
  elapsedMs: number,
  wpm: number,
): number {
  if (wordCount <= 0) return 0;
  const currentWord = (elapsedMs / 60_000) * Math.max(1, wpm);
  return Math.max(0, Math.min(1, currentWord / wordCount));
}

function normalizeTeleprompterState(
  payload: TeleprompterStatePayload,
): TeleprompterStatePayload {
  return {
    script: payload.script ?? '',
    wpm: clampNumber(payload.wpm, 80, 250, DEFAULT_STATE.wpm),
    fontSize: clampNumber(payload.fontSize, 24, 96, DEFAULT_STATE.fontSize),
    mirror: Boolean(payload.mirror),
    opacity: clampNumber(payload.opacity, 30, 100, DEFAULT_STATE.opacity),
    running: Boolean(payload.running),
    elapsedMs: Math.max(0, Number(payload.elapsedMs) || 0),
  };
}

function clampNumber(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
