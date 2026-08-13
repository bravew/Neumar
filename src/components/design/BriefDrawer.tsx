import { useState } from 'react';

import type {
  PromptLibrarySample,
  PromptLibrarySurface,
} from '@/shared/design/prompt-library-types';
import { useLanguage } from '@/shared/providers/language-provider';

import { CreationBriefForm } from './CreationBriefForm';
import { PromptLibraryDrawer } from './PromptLibraryDrawer';

export function BriefDrawer({
  brief,
  initialLibrarySurface,
  onSampleSelected,
  onSubmit,
}: {
  brief: Record<string, unknown>;
  initialLibrarySurface?: PromptLibrarySurface;
  onSampleSelected?: (sample: PromptLibrarySample) => void;
  onSubmit: (brief: Record<string, unknown>) => void;
}) {
  const { tt } = useLanguage();
  const [locked, setLocked] = useState(Object.keys(brief).length > 0);
  if (locked) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="bg-muted rounded-md px-3 py-2 text-sm"
          onClick={() => setLocked(false)}
        >
          {tt('design.briefLocked', { count: Object.keys(brief).length })}
        </button>
        {onSampleSelected && (
          <PromptLibraryDrawer
            initialSurface={initialLibrarySurface}
            onSampleSelected={onSampleSelected}
          />
        )}
      </div>
    );
  }
  return (
    <div className="border-border bg-card rounded-md border p-3">
      {onSampleSelected && (
        <div className="mb-3 flex justify-end">
          <PromptLibraryDrawer
            initialSurface={initialLibrarySurface}
            onSampleSelected={onSampleSelected}
          />
        </div>
      )}
      <CreationBriefForm
        initial={brief}
        onSubmit={(next) => {
          onSubmit(next);
          setLocked(true);
        }}
      />
    </div>
  );
}
