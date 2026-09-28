import { useEffect, useState } from 'react';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

export interface ClaudePluginHealthData {
  /** Unix ms of the last session start that reported plugin state. */
  checkedAt: number | null;
  errors: { plugin: string; type: string; message: string }[];
}

/**
 * Claude Code plugin load errors reported by the Agent SDK at the last
 * session start (`system/init.plugin_errors`). Hidden until a session ran.
 */
export function ClaudePluginHealth() {
  const [health, setHealth] = useState<ClaudePluginHealthData | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`${API_BASE_URL}/plugins/claude-health`, { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ClaudePluginHealthData | null) => {
        if (data) setHealth(data);
      })
      .catch(() => {
        // Optional panel — absent on older API builds.
      });
    return () => ac.abort();
  }, []);

  if (!health) return null;
  return <ClaudePluginHealthView health={health} />;
}

export function ClaudePluginHealthView({
  health,
}: {
  health: ClaudePluginHealthData;
}) {
  const { t, tt } = useLanguage();
  if (health.checkedAt === null) return null;

  if (health.errors.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <CheckCircle2 className="size-3.5 text-green-600" />
        {t.plugins.claudeHealth.healthy}
      </div>
    );
  }

  return (
    <section
      aria-label={t.plugins.claudeHealth.title}
      className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs"
    >
      <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-3.5" />
        {tt('plugins.claudeHealth.errorsSummary', {
          count: health.errors.length,
        })}
      </div>
      <ul className="mt-1.5 space-y-1">
        {health.errors.map((e, i) => (
          <li
            key={`${e.plugin}-${e.type}-${i}`}
            className="text-muted-foreground"
          >
            <span className="text-foreground font-mono">{e.plugin}</span>
            {' · '}
            {e.type}
            {e.message ? ` — ${e.message}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}
