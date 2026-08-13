import { useState } from 'react';

import { Bot, Image } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoLinkedAssetSearchHit,
  VideoProject,
} from '@/shared/types/video';

import type { VideoProjectEditorActions } from './editorTypes';
import { PanelShell } from './PanelShell';

interface AgentPanelProps {
  project: VideoProject;
  onGenerateStoryboard: (message: string) => Promise<VideoProject | null>;
  actions?: VideoProjectEditorActions;
}

interface SearchCard {
  sceneId: string;
  query: string;
  results: VideoLinkedAssetSearchHit[];
}

export function AgentPanel({
  project,
  onGenerateStoryboard,
  actions,
}: AgentPanelProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [searchCards, setSearchCards] = useState<SearchCard[]>([]);

  const generate = async () => {
    setLoading(true);
    setMessage(null);
    setSearchCards([]);
    try {
      const prompt = t.video.agent.generatePrompt
        .replace('{template}', t.video.templates[project.template])
        .replace('{budget}', String(project.budget?.capUsd ?? 5));
      const generated = await onGenerateStoryboard(prompt);
      if (actions && generated?.storyboard && generated.linkedSources?.length) {
        const cards: SearchCard[] = [];
        for (const scene of generated.storyboard.scenes.slice(0, 3)) {
          const search = await actions.searchLinkedAssets({
            query: scene.intent,
            role:
              scene.assetPlan.kind === 'broll-search' ? 'b-roll' : 'context',
            sourceIds:
              scene.assetPlan.kind === 'broll-search'
                ? scene.assetPlan.sourceIds
                : undefined,
            limit: 6,
          });
          if (search.results.length) {
            cards.push({
              sceneId: scene.id,
              query: scene.intent,
              results: search.results,
            });
          }
        }
        setSearchCards(cards);
      }
      setMessage(t.video.agent.ready);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PanelShell
      title={t.video.agent.title}
      description={t.video.agent.description}
    >
      <div className="space-y-3">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Bot className="size-4" />
          <span>{t.video.agent.placeholder}</span>
        </div>
        {(project.linkedSources ?? []).length ? (
          <div className="flex flex-wrap gap-1">
            {(project.linkedSources ?? []).map((source) => (
              <span
                key={source.id}
                className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]"
              >
                {source.displayName}
              </span>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60"
        >
          {loading ? t.video.agent.generating : t.video.agent.generate}
        </button>
        {message ? (
          <p className="text-muted-foreground text-xs">{message}</p>
        ) : null}
        {searchCards.length ? (
          <div className="space-y-2">
            {searchCards.map((card) => (
              <div
                key={card.sceneId}
                className="border-border rounded-md border p-2"
              >
                <div className="text-foreground mb-2 truncate text-xs font-medium">
                  {t.video.editor.agentDock.action.searchLinkedAssets}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {card.results.map((hit) => (
                    <div
                      key={hit.asset.id}
                      className="bg-muted/40 w-24 shrink-0 overflow-hidden rounded-md"
                      title={`${hit.sourceDisplayName ?? ''} ${hit.asset.name}`}
                    >
                      {hit.thumbnailUrl || hit.asset.thumbnailCachePath ? (
                        <img
                          src={resolveActionThumbnail(hit.thumbnailUrl)}
                          alt=""
                          className="bg-muted h-14 w-full object-cover"
                        />
                      ) : (
                        <div className="bg-muted text-muted-foreground flex h-14 w-full items-center justify-center">
                          <Image className="size-4" />
                        </div>
                      )}
                      <div className="space-y-0.5 p-1">
                        <div className="text-foreground truncate text-[10px]">
                          {hit.asset.name}
                        </div>
                        <div className="text-muted-foreground truncate text-[10px]">
                          {hit.sourceDisplayName ??
                            t.video.editor.linkedSearch.matchedOn[
                              hit.matchedOn
                            ]}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </PanelShell>
  );
}

function resolveActionThumbnail(thumbnailUrl: string): string {
  if (!thumbnailUrl) return '';
  if (thumbnailUrl.startsWith('http')) return thumbnailUrl;
  return `${API_BASE_URL}${thumbnailUrl}`;
}
