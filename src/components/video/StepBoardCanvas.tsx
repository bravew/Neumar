import { useState } from 'react';

import { X } from 'lucide-react';

import { saveVideoProjectAsTemplate } from '@/shared/hooks/useVideoProject';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoProject,
  VideoStoryboardScene,
  VideoTemplateCategory,
} from '@/shared/types/video';

import { ApproveStoryboardButton } from './ApproveStoryboardButton';
import type { VideoEditorStep, VideoProjectEditorActions } from './editorTypes';
import { SceneSequencer } from './SceneSequencer';

const SAVE_TEMPLATE_CATEGORIES: VideoTemplateCategory[] = [
  'custom',
  'shorts',
  'explainer',
  'ad',
  'tutorial',
  'product',
  'podcast',
  'testimonial',
  'recap',
  'announcement',
  'other',
];

interface StepBoardCanvasProps {
  project: VideoProject;
  selectedSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  actions: VideoProjectEditorActions;
  onStepChange: (step: VideoEditorStep) => void;
  regeneratingSceneIds?: Set<string>;
}

export function StepBoardCanvas({
  project,
  selectedSceneId,
  onSelectScene,
  actions,
  onStepChange,
  regeneratingSceneIds,
}: StepBoardCanvasProps) {
  const { t } = useLanguage();
  const storyboard = project.storyboard;
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [saveName, setSaveName] = useState(project.name);
  const [saveCategory, setSaveCategory] =
    useState<VideoTemplateCategory>('custom');
  const [saveLicense, setSaveLicense] = useState<
    'CC0' | 'CC-BY' | 'proprietary'
  >('proprietary');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const updateScenes = async (scenes: VideoStoryboardScene[]) => {
    if (!storyboard) return;
    await actions.updateStoryboard({ ...storyboard, scenes });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-foreground text-sm font-semibold">
            {t.video.editor.board.title}
          </h2>
          <p className="text-muted-foreground text-xs">
            {storyboard?.intent ?? t.video.editor.board.empty}
          </p>
        </div>
        {storyboard ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="border-border text-muted-foreground rounded-full border px-2 py-1 text-xs">
              {storyboard.status}
            </span>
            <span className="text-muted-foreground text-xs">
              {t.video.storyboard.cost
                .replace('{low}', storyboard.costEstimateUsd.low.toFixed(2))
                .replace('{high}', storyboard.costEstimateUsd.high.toFixed(2))}
            </span>
          </div>
        ) : null}
      </div>
      <SceneSequencer
        project={project}
        selectedSceneId={selectedSceneId}
        onSelectScene={onSelectScene}
        onUpdateStoryboard={updateScenes}
        regeneratingSceneIds={regeneratingSceneIds}
      />
      {storyboard ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs"
            onClick={() => void actions.rejectStoryboard()}
          >
            <X className="mr-1 inline size-3" />
            {t.video.editor.actions.reject}
          </button>
          <ApproveStoryboardButton
            project={project}
            onApprove={actions.approveStoryboard}
            onApproved={() => onStepChange('plan')}
          />
          <button
            type="button"
            className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs"
            onClick={() => setSaveTemplateOpen((open) => !open)}
          >
            {t.video.templates.saveAs.save}
          </button>
        </div>
      ) : null}
      {storyboard && saveTemplateOpen ? (
        <section className="border-border bg-background mt-3 max-w-xl rounded-md border p-3">
          <h3 className="text-foreground text-sm font-semibold">
            {t.video.templates.saveAs.title}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">
                {t.video.templates.saveAs.name}
              </span>
              <input
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">
                {t.video.templates.saveAs.category}
              </span>
              <select
                value={saveCategory}
                onChange={(event) =>
                  setSaveCategory(event.target.value as VideoTemplateCategory)
                }
                className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
              >
                {SAVE_TEMPLATE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {t.video.templates.category[category]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">
                {t.video.templates.saveAs.license}
              </span>
              <select
                value={saveLicense}
                onChange={(event) =>
                  setSaveLicense(
                    event.target.value as 'CC0' | 'CC-BY' | 'proprietary',
                  )
                }
                className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
              >
                <option value="proprietary">
                  {t.video.templates.saveAs.licenseProprietary}
                </option>
                <option value="CC0">
                  {t.video.templates.saveAs.licenseCc0}
                </option>
                <option value="CC-BY">
                  {t.video.templates.saveAs.licenseCcBy}
                </option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs"
              onClick={() => setSaveTemplateOpen(false)}
            >
              {t.video.templates.saveAs.cancel}
            </button>
            <button
              type="button"
              disabled={savingTemplate || !saveName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60"
              onClick={async () => {
                setSavingTemplate(true);
                setSaveStatus(null);
                try {
                  await saveVideoProjectAsTemplate(project.id, {
                    displayName: saveName.trim(),
                    category: saveCategory,
                    license: saveLicense,
                  });
                  setSaveStatus(t.video.templates.saveAs.saved);
                } catch (err) {
                  setSaveStatus(
                    err instanceof Error
                      ? err.message
                      : t.video.templates.saveAs.failed,
                  );
                } finally {
                  setSavingTemplate(false);
                }
              }}
            >
              {t.video.templates.saveAs.save}
            </button>
            {saveStatus ? (
              <span className="text-muted-foreground text-xs">
                {saveStatus}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
