import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Ownership is a structural property, so it is asserted against the source
 * rather than a render. A rendered assertion would need the whole editor tree
 * — panels, agent dock, router, DB — to prove something that is really about
 * which component mounts which panel.
 */
const root = path.resolve(__dirname, '../../components/video');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('editor surface ownership', () => {
  it('leaves exactly one navigational control', () => {
    // Two clickable step rows could never agree: several workflow stages share
    // one canvas, so the stage row had no way to reflect where the user was.
    const editor = read('ProjectEditor.tsx');
    expect(editor).toContain('VideoWorkflowSummary');
    expect(editor).not.toContain('CreativeWorkflowHeader');
    expect(editor).not.toContain('onStepSelect');

    const summary = read('VideoWorkflowSummary.tsx');
    // The only button it may own is the primary action.
    expect(summary.match(/<button/g)?.length ?? 0).toBe(1);
  });

  it('suppresses the rail tabs that Preview owns directly', () => {
    // Preview mounts its own Assets column and inspector. The rail must hide
    // the equivalent tabs there, or the same panel is reachable twice at once
    // with independent scroll and selection state.
    const preview = read('StepPreviewCanvas.tsx');
    expect(preview).toContain('AssetsRail');
    expect(preview).toContain('PreviewInspectorPanel');

    const rightColumn = read('EditorRightColumn.tsx');
    expect(rightColumn).toMatch(/hideAssetsTab=\{isPreview\}/);
    expect(rightColumn).toMatch(/hideInspectorTab=\{isPreview\}/);
    expect(rightColumn).toMatch(/const isPreview = activeStep === 'preview'/);
  });

  it('honours those flags when building the tab list', () => {
    const rail = read('SideRail.tsx');
    expect(rail).toMatch(/if \(!hideAssetsTab\) tabs\.push\('assets'\)/);
    expect(rail).toMatch(/hasInspectable && !hideInspectorTab/);
  });

  it('keeps the Assets column out of every non-Preview canvas', () => {
    // Only Preview is allowed a dedicated Assets column; anywhere else the
    // rail is the single owner.
    for (const canvas of [
      'StepBriefCanvas.tsx',
      'StepBoardCanvas.tsx',
      'StepPlanCanvas.tsx',
      'StepGenerateCanvas.tsx',
    ]) {
      expect(read(canvas), `${canvas} must not mount AssetsRail`).not.toContain(
        'AssetsRail',
      );
    }
  });
});
