import { useRef } from 'react';

import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useResizeAutoFollow } from '@/shared/hooks/useResizeAutoFollow';

type ResizeCallback = ResizeObserverCallback;

const resizeCallbacks: ResizeCallback[] = [];

class TestResizeObserver {
  constructor(callback: ResizeCallback) {
    resizeCallbacks.push(callback);
  }

  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

describe('chat todo auto-scroll resize follow', () => {
  afterEach(() => {
    resizeCallbacks.length = 0;
    vi.unstubAllGlobals();
  });

  it('follows the latest message when running content grows and chat is pinned', () => {
    const follow = vi.fn();
    const onResize = vi.fn();
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    render(
      <Harness
        enabled
        shouldFollow={() => true}
        follow={follow}
        onResize={onResize}
      />,
    );

    expect(resizeCallbacks).toHaveLength(1);
    resizeCallbacks[0]([], {} as ResizeObserver);

    expect(follow).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it('does not follow when the user has scrolled away from the latest message', () => {
    const follow = vi.fn();
    const onResize = vi.fn();
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    render(
      <Harness
        enabled
        shouldFollow={() => false}
        follow={follow}
        onResize={onResize}
      />,
    );

    expect(resizeCallbacks).toHaveLength(1);
    resizeCallbacks[0]([], {} as ResizeObserver);

    expect(follow).not.toHaveBeenCalled();
    expect(onResize).toHaveBeenCalledTimes(1);
  });
});

function Harness({
  enabled,
  shouldFollow,
  follow,
  onResize,
}: {
  enabled: boolean;
  shouldFollow: () => boolean;
  follow: () => void;
  onResize: () => void;
}) {
  const targetRef = useRef<HTMLDivElement>(null);
  useResizeAutoFollow({
    targetRef,
    enabled,
    shouldFollow,
    follow,
    onResize,
  });
  return <div ref={targetRef} data-testid="chat-content" />;
}
