import { useEffect, useReducer, useRef } from 'react';

export function useAgentSync(agent: {
  messages: unknown[];
  isRunning: boolean;
}) {
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  const agentRef = useRef(agent);
  agentRef.current = agent;

  // Sync agent state to React — only poll while the agent is running.
  // Uses requestAnimationFrame (aligned with display refresh) instead of fixed 200ms.
  // When idle, a single check runs on each effect trigger (agent.isRunning change).
  // Fingerprint includes message count, running state, and last message content length
  // so streaming text updates (same message, growing content) trigger re-renders.
  const lastSeenRef = useRef({ len: 0, running: false, contentLen: 0 });
  useEffect(() => {
    const snapshot = (ag: typeof agent) => {
      const lastMsg = ag.messages[ag.messages.length - 1];
      return {
        len: ag.messages.length,
        running: ag.isRunning,
        contentLen: (lastMsg as { content?: string })?.content?.length ?? 0,
      };
    };
    const changed = (
      a: { len: number; running: boolean; contentLen: number },
      b: typeof a,
    ) =>
      a.len !== b.len ||
      a.running !== b.running ||
      a.contentLen !== b.contentLen;

    // Check once immediately for idle → running or running → idle transitions
    const cur = snapshot(agentRef.current);
    if (changed(cur, lastSeenRef.current)) {
      lastSeenRef.current = cur;
      forceRender();
    }

    if (!agentRef.current.isRunning) {
      // Agent just stopped — schedule delayed re-checks to catch messages that
      // arrive after CopilotKit sets isRunning=false (async event processing).
      const delays = [200, 600, 1500];
      const timers = delays.map((ms) =>
        setTimeout(() => {
          const c = snapshot(agentRef.current);
          if (changed(c, lastSeenRef.current)) {
            lastSeenRef.current = c;
            forceRender();
          }
        }, ms),
      );
      // Also fire artifact refresh for post-run file detection
      window.dispatchEvent(new CustomEvent('task-files-updated'));
      return () => timers.forEach(clearTimeout);
    }

    let rafId: number;
    const check = () => {
      const c = snapshot(agentRef.current);
      if (changed(c, lastSeenRef.current)) {
        lastSeenRef.current = c;
        forceRender();
      }
      if (agentRef.current.isRunning) {
        rafId = requestAnimationFrame(check);
      } else {
        // Agent stopped mid-RAF — schedule delayed re-checks (same logic as
        // the idle branch above) to catch late-arriving messages.
        [200, 600, 1500].forEach((ms) =>
          setTimeout(() => {
            const c2 = snapshot(agentRef.current);
            if (changed(c2, lastSeenRef.current)) {
              lastSeenRef.current = c2;
              forceRender();
            }
          }, ms),
        );
        window.dispatchEvent(new CustomEvent('task-files-updated'));
      }
    };
    rafId = requestAnimationFrame(check);

    // Poll for new artifacts during streaming (server-side file extraction
    // inserts into DB; this notifies useV2Artifacts to refresh).
    const artifactPoll = setInterval(() => {
      window.dispatchEvent(new CustomEvent('task-files-updated'));
    }, 5_000);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(artifactPoll);
    };
  }, [agent.isRunning, forceRender]);

  // Listen for history-loaded event from InitialMessageSender
  useEffect(() => {
    const handler = () => forceRender();
    window.addEventListener('v2-messages-loaded', handler);
    return () => window.removeEventListener('v2-messages-loaded', handler);
  }, [forceRender]);

  return { forceRender };
}
