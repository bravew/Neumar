import { useEffect, useMemo, useState } from 'react';

import { API_BASE_URL } from '@/config';

// Module-level constant — extract outside component to avoid memoization breakage
export const CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic Claude
  'claude-opus-5': 1_000_000,
  'claude-fable-5': 1_000_000,
  'claude-mythos-5': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-opus-4-5': 200_000,
  'claude-opus-4-6': 1_000_000,
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-8': 1_000_000,
  // OpenAI GPT-4.1 series
  'gpt-4.1': 1_047_576,
  'gpt-4.1-mini': 1_047_576,
  'gpt-4.1-nano': 1_047_576,
  // OpenAI GPT-5 series
  'gpt-5.3-instant': 400_000,
  'gpt-5.4': 1_000_000,
  'gpt-5.4-pro': 1_000_000,
  'gpt-5.5': 1_000_000,
  'gpt-5.5-pro': 1_000_000,
  // OpenAI reasoning models
  o3: 200_000,
  'o4-mini': 200_000,
  // Google Gemini
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  // Moonshot Kimi K3
  'kimi-k3': 1_048_576,
  'kimi-code/k3': 1_048_576,
};

const DEFAULT_CONTEXT_WINDOW = 200_000;

interface ContextUsage {
  used: number;
  total: number;
  percentage: number;
  cost: number;
  model: string | null;
  loading: boolean;
}

export function useContextUsage(
  taskId: string,
  modelHint?: string,
): ContextUsage {
  const [data, setData] = useState<{
    total_input: number;
    total_output: number;
    model: string | null;
    cost: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!taskId) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let current = true;
    setData(null);
    setLoading(true);
    fetch(`${API_BASE_URL}/db/tasks/${taskId}/usage`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((next) => {
        if (current) setData(next);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        if (current) setData(null);
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [taskId]);

  return useMemo(() => {
    if (!data) {
      return {
        used: 0,
        total: DEFAULT_CONTEXT_WINDOW,
        percentage: 0,
        cost: 0,
        model: null,
        loading,
      };
    }

    const used = data.total_input + data.total_output;
    const modelName = modelHint || data.model || '';

    // Try to match model by prefix for flexibility
    let total = DEFAULT_CONTEXT_WINDOW;
    for (const [key, value] of Object.entries(CONTEXT_WINDOWS)) {
      if (modelName.includes(key)) {
        total = value;
        break;
      }
    }

    const percentage = total > 0 ? (used / total) * 100 : 0;

    return {
      used,
      total,
      percentage: Math.min(percentage, 100),
      cost: data.cost,
      model: data.model,
      loading,
    };
  }, [data, modelHint, loading]);
}
