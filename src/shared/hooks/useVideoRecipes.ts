import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

export interface VideoRecipe {
  id: string;
  name: string;
  version: number;
  systemPrompt: string;
  toolSequence: unknown[];
  defaults: Record<string, unknown>;
  outputPreset: string;
  inputSchema: Record<string, unknown>;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

interface VideoRecipesState {
  recipes: VideoRecipe[];
  loading: boolean;
  error: string | null;
}

export function useVideoRecipes(): VideoRecipesState {
  const [state, setState] = useState<VideoRecipesState>({
    recipes: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadRecipes() {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const response = await fetch(`${API_BASE_URL}/video/recipes`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          recipes?: VideoRecipe[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        setState({
          recipes: Array.isArray(payload.recipes) ? payload.recipes : [],
          loading: false,
          error: null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          recipes: [],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (!controller.signal.aborted) {
          setState((prev) =>
            prev.loading ? { ...prev, loading: false } : prev,
          );
        }
      }
    }

    void loadRecipes();

    return () => {
      controller.abort();
    };
  }, []);

  return state;
}
