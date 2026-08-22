import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import { randomUUID } from '@/shared/utils/uuid';

interface StudioSession {
  serverUrl: string;
  studioUrl: string;
}

// The player script is shared by every preview mounted against one server, so
// it is reference counted: the last instance to unmount removes it.
const playerScriptRefs = new Map<string, number>();

export function HyperframesStudioPreview({
  projectId,
  selectedFrameId,
}: {
  projectId: string;
  selectedFrameId: string;
}) {
  const { t } = useLanguage();
  const labels = t.video.htmlGallery;
  const [session, setSession] = useState<StudioSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const subscriberId = randomUUID();
    let disposed = false;
    const endpoint = `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/hyperframes-preview`;
    const body = JSON.stringify({
      compositionDir: 'hyperframes',
      subscriberId,
    });
    const release = () =>
      fetch(`${endpoint}/release`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);

    void fetch(`${endpoint}/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const failure = await parseStudioError(response);
          // A project with no composition yet is a normal empty state.
          if (failure.code === 'invalid-project') return null;
          throw new Error(failure.message);
        }
        const payload: unknown = await response.json();
        const nextSession = parseStudioSession(payload);
        if (disposed) {
          await release();
          return null;
        }
        return nextSession;
      })
      .then((next) => {
        if (next && !disposed) setSession(next);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      disposed = true;
      controller.abort();
      void release();
    };
  }, [projectId]);

  useEffect(() => {
    if (!session) return;
    const src = `${session.serverUrl}/player.js`;
    const onScriptError = () => setError(labels.studioScriptError);
    const refs = playerScriptRefs.get(src) ?? 0;
    playerScriptRefs.set(src, refs + 1);
    let script: HTMLScriptElement | null = null;
    if (refs === 0) {
      script = document.createElement('script');
      script.src = src;
      script.dataset.hyperframesPlayer = src;
      script.async = true;
      script.addEventListener('error', onScriptError);
      document.head.append(script);
    }
    return () => {
      script?.removeEventListener('error', onScriptError);
      const remaining = (playerScriptRefs.get(src) ?? 1) - 1;
      if (remaining > 0) {
        playerScriptRefs.set(src, remaining);
        return;
      }
      playerScriptRefs.delete(src);
      document
        .querySelector(`script[data-hyperframes-player="${CSS.escape(src)}"]`)
        ?.remove();
    };
  }, [session, labels.studioScriptError]);

  if (!session && !error) return null;
  if (error) {
    return (
      <p className="text-destructive text-xs" role="alert">
        {labels.studioError.replace('{error}', error)}
      </p>
    );
  }
  if (!session) return null;

  return (
    <section className="space-y-2" data-selected-frame-id={selectedFrameId}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-foreground text-xs font-medium">
          {labels.studioTitle}
        </h4>
        <a
          href={session.studioUrl}
          target="_blank"
          rel="noreferrer"
          className="text-primary text-xs hover:underline"
        >
          {labels.openStudio}
        </a>
      </div>
      <div className="aspect-video overflow-hidden rounded border bg-black">
        <hyperframes-player
          src={`${session.serverUrl}/composition/index.html`}
          controls
          muted
          class="block size-full"
        />
      </div>
    </section>
  );
}

async function parseStudioError(
  response: Response,
): Promise<{ code?: string; message: string }> {
  const fallback = `HTTP ${response.status}`;
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload !== 'object' || payload === null) {
    return { message: fallback };
  }
  const body = payload as { error?: unknown; detail?: unknown };
  const detail = body.detail as { code?: unknown } | undefined;
  return {
    ...(typeof detail?.code === 'string' ? { code: detail.code } : {}),
    message:
      typeof body.error === 'string' && body.error ? body.error : fallback,
  };
}

function parseStudioSession(value: unknown): StudioSession {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('session' in value) ||
    typeof value.session !== 'object' ||
    value.session === null ||
    !('serverUrl' in value.session) ||
    !('studioUrl' in value.session) ||
    typeof value.session.serverUrl !== 'string' ||
    typeof value.session.studioUrl !== 'string'
  ) {
    throw new Error('Invalid HyperFrames preview response.');
  }
  return {
    serverUrl: value.session.serverUrl,
    studioUrl: value.session.studioUrl,
  };
}
