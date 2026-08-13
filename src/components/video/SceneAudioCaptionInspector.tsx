import { useEffect, useState } from 'react';

import { Music, Subtitles, Volume2 } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoCaptionRenderMode,
  VideoNarrationSegment,
  VideoProject,
  VideoStoryboardScene,
} from '@/shared/types/video';
import { randomUUID } from '@/shared/utils/uuid';

import type { VideoProjectEditorActions } from './editorTypes';

interface SceneAudioCaptionInspectorProps {
  project: VideoProject;
  scene: VideoStoryboardScene;
  actions: VideoProjectEditorActions;
  onPatchScene: (patch: Partial<VideoStoryboardScene>) => Promise<void>;
}

export function SceneAudioCaptionInspector({
  project,
  scene,
  actions,
  onPatchScene,
}: SceneAudioCaptionInspectorProps) {
  const { t } = useLanguage();
  const storyboard = project.storyboard;
  const music = storyboard?.music;
  const narration = storyboard?.narration;
  const currentNarration = narration?.segments.find(
    (segment) => segment.sceneId === scene.id,
  );
  const [musicPrompt, setMusicPrompt] = useState(music?.prompt ?? '');
  const [musicDurationMs, setMusicDurationMs] = useState(
    music?.durationMs ?? storyboard?.totalDurationMs ?? scene.durationMs,
  );
  const [musicTempoBpm, setMusicTempoBpm] = useState(music?.tempoBpm ?? 96);
  const [musicMood, setMusicMood] = useState(music?.mood ?? '');
  const [musicProvider, setMusicProvider] = useState<
    'elevenlabs-music' | 'stable-audio'
  >(music?.provider ?? 'elevenlabs-music');
  const [narrationText, setNarrationText] = useState(
    currentNarration?.text ?? scene.caption?.text ?? scene.intent,
  );
  const [narrationVoice, setNarrationVoice] = useState(
    currentNarration?.voiceId ?? narration?.voiceId ?? '',
  );
  const [narrationProvider, setNarrationProvider] = useState(
    currentNarration?.provider ?? narration?.provider ?? 'kokoro',
  );
  const [generating, setGenerating] = useState<'music' | 'narration' | null>(
    null,
  );

  useEffect(() => {
    setMusicPrompt(music?.prompt ?? '');
    setMusicDurationMs(
      music?.durationMs ?? storyboard?.totalDurationMs ?? scene.durationMs,
    );
    setMusicTempoBpm(music?.tempoBpm ?? 96);
    setMusicMood(music?.mood ?? '');
    setMusicProvider(music?.provider ?? 'elevenlabs-music');
  }, [
    music?.assetId,
    music?.durationMs,
    music?.mood,
    music?.prompt,
    music?.provider,
    music?.tempoBpm,
    scene.durationMs,
    storyboard?.totalDurationMs,
  ]);

  useEffect(() => {
    setNarrationText(
      currentNarration?.text ?? scene.caption?.text ?? scene.intent,
    );
    setNarrationVoice(currentNarration?.voiceId ?? narration?.voiceId ?? '');
    setNarrationProvider(
      currentNarration?.provider ?? narration?.provider ?? 'kokoro',
    );
  }, [
    currentNarration?.provider,
    currentNarration?.text,
    currentNarration?.voiceId,
    narration?.provider,
    narration?.voiceId,
    scene.caption?.text,
    scene.intent,
  ]);

  const generateMusic = async () => {
    if (!musicPrompt.trim()) return;
    setGenerating('music');
    try {
      await actions.generateMusic({
        prompt: musicPrompt.trim(),
        durationMs: musicDurationMs,
        tempoBpm: musicTempoBpm,
        mood: musicMood.trim() || undefined,
        provider: musicProvider,
      });
    } finally {
      setGenerating(null);
    }
  };

  const generateNarration = async () => {
    if (!storyboard || !narrationText.trim()) return;
    const byScene = new Map(
      (narration?.segments ?? []).map((segment) => [segment.sceneId, segment]),
    );
    const segments: VideoNarrationSegment[] = storyboard.scenes.map((entry) => {
      const existing = byScene.get(entry.id);
      return {
        id: existing?.id ?? randomUUID(),
        sceneId: entry.id,
        text:
          entry.id === scene.id
            ? narrationText.trim()
            : (existing?.text ?? entry.caption?.text ?? entry.intent),
        voiceId: narrationVoice.trim() || existing?.voiceId,
        provider: narrationProvider || existing?.provider,
      };
    });
    setGenerating('narration');
    try {
      await actions.generateNarration({
        segments,
        voiceId: narrationVoice.trim() || undefined,
        provider: narrationProvider || undefined,
      });
    } finally {
      setGenerating(null);
    }
  };

  const updateCaptionStyle = (
    style: NonNullable<VideoStoryboardScene['caption']>['style'],
  ) => {
    void onPatchScene({
      caption: {
        text: scene.caption?.text ?? scene.intent,
        style,
      },
    });
  };

  return (
    <div className="space-y-4">
      <section className="border-border rounded-md border p-3">
        <h3 className="text-foreground mb-3 flex items-center gap-2 text-xs font-semibold">
          <Music className="size-3.5" />
          {t.video.editor.inspector.music.title}
        </h3>
        <div className="space-y-2">
          <input
            value={musicPrompt}
            onChange={(event) => setMusicPrompt(event.target.value)}
            placeholder={t.video.editor.inspector.music.prompt}
            className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              min={1000}
              step={1000}
              value={musicDurationMs}
              onChange={(event) =>
                setMusicDurationMs(Number(event.target.value))
              }
              aria-label={t.video.editor.inspector.music.duration}
              className="border-input bg-background text-foreground rounded-md border px-3 py-2 text-xs"
            />
            <input
              type="number"
              min={40}
              max={240}
              value={musicTempoBpm}
              onChange={(event) => setMusicTempoBpm(Number(event.target.value))}
              aria-label={t.video.editor.inspector.music.tempo}
              className="border-input bg-background text-foreground rounded-md border px-3 py-2 text-xs"
            />
          </div>
          <input
            value={musicMood}
            onChange={(event) => setMusicMood(event.target.value)}
            placeholder={t.video.editor.inspector.music.mood}
            className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-xs"
          />
          <select
            value={musicProvider}
            onChange={(event) =>
              setMusicProvider(
                event.target.value as 'elevenlabs-music' | 'stable-audio',
              )
            }
            className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-xs"
          >
            <option value="elevenlabs-music">
              {t.video.editor.inspector.music.providerOption.elevenlabsMusic}
            </option>
            <option value="stable-audio">
              {t.video.editor.inspector.music.providerOption.stableAudio}
            </option>
          </select>
          <button
            type="button"
            onClick={() => void generateMusic()}
            disabled={generating === 'music' || !musicPrompt.trim()}
            className="border-border hover:bg-accent w-full rounded-md border px-3 py-2 text-xs disabled:opacity-50"
          >
            {generating === 'music'
              ? t.video.editor.inspector.music.generating
              : t.video.editor.inspector.music.generate}
          </button>
        </div>
      </section>

      <section className="border-border rounded-md border p-3">
        <h3 className="text-foreground mb-3 flex items-center gap-2 text-xs font-semibold">
          <Volume2 className="size-3.5" />
          {t.video.editor.inspector.narration.title}
        </h3>
        <label className="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={scene.muteAudio ?? false}
            onChange={(event) =>
              void onPatchScene({ muteAudio: event.target.checked })
            }
          />
          {t.video.editor.inspector.narration.muteScene}
        </label>
        <textarea
          value={narrationText}
          onChange={(event) => setNarrationText(event.target.value)}
          className="border-input bg-background text-foreground min-h-20 w-full rounded-md border px-3 py-2 text-xs"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            value={narrationVoice}
            onChange={(event) => setNarrationVoice(event.target.value)}
            placeholder={t.video.editor.inspector.narration.voice}
            className="border-input bg-background text-foreground rounded-md border px-3 py-2 text-xs"
          />
          <select
            value={narrationProvider}
            onChange={(event) => setNarrationProvider(event.target.value)}
            className="border-input bg-background text-foreground rounded-md border px-3 py-2 text-xs"
          >
            <option value="kokoro">
              {t.video.editor.inspector.narration.providerOption.kokoro}
            </option>
            <option value="elevenlabs">
              {t.video.editor.inspector.narration.providerOption.elevenlabs}
            </option>
            <option value="openai-tts">
              {t.video.editor.inspector.narration.providerOption.openaiTts}
            </option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => void generateNarration()}
          disabled={generating === 'narration' || !narrationText.trim()}
          className="border-border hover:bg-accent mt-2 w-full rounded-md border px-3 py-2 text-xs disabled:opacity-50"
        >
          {generating === 'narration'
            ? t.video.editor.inspector.narration.generating
            : t.video.editor.inspector.narration.generate}
        </button>
      </section>

      <section className="border-border rounded-md border p-3">
        <h3 className="text-foreground mb-3 flex items-center gap-2 text-xs font-semibold">
          <Subtitles className="size-3.5" />
          {t.video.editor.inspector.caption.title}
        </h3>
        <select
          value={project.settings?.renderCaptionMode ?? 'off'}
          onChange={(event) =>
            void actions.setRenderCaptionMode(
              event.target.value as VideoCaptionRenderMode,
            )
          }
          className="border-input bg-background text-foreground mb-2 w-full rounded-md border px-3 py-2 text-xs"
        >
          <option value="off">{t.video.editor.render.captionsMode.off}</option>
          <option value="burn-in">
            {t.video.editor.render.captionsMode.burnIn}
          </option>
          <option value="sidecar">
            {t.video.editor.render.captionsMode.sidecar}
          </option>
        </select>
        <div className="grid grid-cols-3 gap-2">
          <select
            value={scene.caption?.style?.position ?? 'bottom'}
            onChange={(event) =>
              updateCaptionStyle({
                ...scene.caption?.style,
                position: event.target.value as 'top' | 'middle' | 'bottom',
              })
            }
            className="border-input bg-background text-foreground rounded-md border px-2 py-2 text-xs"
          >
            <option value="top">{t.video.editor.inspector.caption.top}</option>
            <option value="middle">
              {t.video.editor.inspector.caption.middle}
            </option>
            <option value="bottom">
              {t.video.editor.inspector.caption.bottom}
            </option>
          </select>
          <input
            type="color"
            value={scene.caption?.style?.color ?? '#ffffff'}
            onChange={(event) =>
              updateCaptionStyle({
                ...scene.caption?.style,
                color: event.target.value,
              })
            }
            aria-label={t.video.editor.inspector.caption.color}
            className="border-input bg-background h-9 rounded-md border px-2"
          />
          <input
            type="number"
            min={12}
            max={96}
            value={scene.caption?.style?.fontSize ?? 42}
            onChange={(event) =>
              updateCaptionStyle({
                ...scene.caption?.style,
                fontSize: Number(event.target.value),
              })
            }
            aria-label={t.video.editor.inspector.caption.fontSize}
            className="border-input bg-background text-foreground rounded-md border px-2 py-2 text-xs"
          />
        </div>
      </section>
    </div>
  );
}
