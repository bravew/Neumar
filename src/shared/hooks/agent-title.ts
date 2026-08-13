import { getSettings } from '@/shared/db/settings';
import { stripSkillAnchor } from '@/shared/lib/skill-anchor';

import { TITLE_GENERATION_TIMEOUT } from './agent-constants';
import { AGENT_SERVER_URL } from './agent-utils';

/**
 * Find an API key and base URL for title generation.
 * Unlike getModelConfig() which returns undefined for the "default" provider,
 * this function searches ALL configured providers for any available key.
 * This is needed because the "default" provider relies on the Claude Code CLI's
 * built-in OAuth auth, which isn't accessible for raw API calls.
 *
 * Priority chain:
 *   1. Task-specific routing for 'titleGeneration' (from modelRouting config)
 *   2. Selected default provider
 *   3. Any provider with an API key
 */
export function getTitleModelConfig():
  | { apiKey: string; baseUrl?: string; model?: string }
  | undefined {
  const settings = getSettings();

  // 1. Check task-specific routing for title generation
  const titleRoute = settings.modelRouting?.titleGeneration;
  if (titleRoute && titleRoute.provider && titleRoute.provider !== 'default') {
    const routeProvider = settings.providers.find(
      (p) => p.id === titleRoute.provider,
    );
    if (routeProvider?.apiKey) {
      return {
        apiKey: routeProvider.apiKey,
        baseUrl: routeProvider.baseUrl || undefined,
        model: titleRoute.model || routeProvider.models[0] || undefined,
      };
    }
  }

  // 2. Try the selected default provider
  if (settings.defaultProvider !== 'default') {
    const selected = settings.providers.find(
      (p) => p.id === settings.defaultProvider,
    );
    if (selected?.apiKey) {
      return {
        apiKey: selected.apiKey,
        baseUrl: selected.baseUrl || undefined,
        model: settings.defaultModel || undefined,
      };
    }
  }

  // 3. Fall back to any provider that has an API key
  for (const provider of settings.providers) {
    if (provider.apiKey && provider.enabled) {
      return {
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl || undefined,
      };
    }
  }

  // 4. No API key found anywhere — title generation will use fallback
  return undefined;
}

/**
 * Generate a concise title for a task by calling the backend LLM endpoint.
 * Runs asynchronously and updates the task title in the background.
 * Non-blocking: failures are silently logged and don't affect the user flow.
 *
 * @param onTitleGenerated - Callback invoked with the new title so callers
 *   can update React state (e.g. setInitialPrompt, refresh sidebar).
 */
export async function autoGenerateTitle(
  taskId: string,
  userPrompt: string,
  aiContext?: string,
  onTitleGenerated?: (title: string) => void,
): Promise<void> {
  try {
    // Use getTitleModelConfig which searches all providers for an API key,
    // not just the default provider (which may use CLI-based auth with no key)
    const modelConfig = getTitleModelConfig();
    // Read the app language so titles are generated in the user's chosen locale
    const language = getSettings().language || 'en-US';

    // Strip any plugin-injected `Skill: <slug>` anchor so titles reflect the
    // real response, not the discipline-anchor prefix.
    const cleanedContext = aiContext ? stripSkillAnchor(aiContext) : aiContext;

    if (!modelConfig?.apiKey) {
      if (import.meta.env.DEV) {
        console.warn(
          '[useAgent] No API key found for title generation. ' +
            'Configure an API key in any provider (Settings → Providers) ' +
            'to enable LLM-powered title generation.',
        );
      }
    }

    const response = await fetch(`${AGENT_SERVER_URL}/agent/generate-title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userPrompt,
        aiContext: cleanedContext,
        taskId,
        language,
        modelConfig,
      }),
      signal: AbortSignal.timeout(TITLE_GENERATION_TIMEOUT),
    });

    if (!response.ok) {
      if (import.meta.env.DEV) {
        console.warn('[useAgent] Title generation failed:', response.status);
      }
      return;
    }

    const data = (await response.json()) as { title: string };
    // Since title is stored separately from prompt (task.title vs task.prompt),
    // always accept a non-empty generated title. The user's original message
    // is preserved in task.prompt and never modified.
    if (data.title && data.title.trim()) {
      if (import.meta.env.DEV) {
        console.warn('[useAgent] Auto-generated title:', data.title);
      }
      onTitleGenerated?.(data.title);
    }
  } catch (error) {
    // Non-critical — don't disrupt the user flow
    if (import.meta.env.DEV) {
      console.warn('[useAgent] Auto-title generation error:', error);
    }
  }
}
