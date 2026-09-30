import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { QuickActions } from '@/components/home/QuickActions';

const makeItems = (items: Record<string, { label: string; prompt: string }>) =>
  items;

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      home: {
        quickActions: { moreIdeas: 'More ideas', back: 'Back' },
        quickActionCategories: {
          write: {
            label: 'Write',
            items: makeItems({
              draftEmail: {
                label: 'Draft email',
                prompt: 'Draft an email about...',
              },
              writeDocs: { label: 'Write docs', prompt: 'Write docs...' },
              editText: { label: 'Edit text', prompt: 'Edit text...' },
              writeBlog: { label: 'Write blog', prompt: 'Write blog...' },
              narrateText: { label: 'Narrate text', prompt: 'Narrate...' },
            }),
          },
          code: {
            label: 'Code',
            items: makeItems({
              buildFeature: {
                label: 'Build feature',
                prompt: 'Build a feature that...',
              },
              debugIssue: { label: 'Debug issue', prompt: 'Debug...' },
              refactorCode: { label: 'Refactor', prompt: 'Refactor...' },
              writeTests: { label: 'Write tests', prompt: 'Write tests...' },
              automateWeb: { label: 'Automate web', prompt: 'Automate...' },
            }),
          },
          analyze: {
            label: 'Analyze',
            items: makeItems({
              analyzeData: { label: 'Analyze data', prompt: 'Analyze...' },
              researchTopic: { label: 'Research', prompt: 'Research...' },
              compareOptions: { label: 'Compare', prompt: 'Compare...' },
              summarize: { label: 'Summarize', prompt: 'Summarize...' },
              transcribeAudio: { label: 'Transcribe', prompt: 'Transcribe...' },
            }),
          },
          create: {
            label: 'Create',
            items: makeItems({
              designUI: { label: 'Design UI', prompt: 'Design a UI...' },
              createPresentation: {
                label: 'Presentation',
                prompt: 'Create...',
              },
              brainstorm: { label: 'Brainstorm', prompt: 'Brainstorm...' },
              generateImage: { label: 'Image', prompt: 'Generate...' },
              createVideo: { label: 'Video', prompt: 'Create video...' },
            }),
          },
          plan: {
            label: 'Plan',
            items: makeItems({
              planProject: {
                label: 'Plan project',
                prompt: 'Plan a project...',
              },
              createRoadmap: { label: 'Roadmap', prompt: 'Create roadmap...' },
              organizeWorkflow: { label: 'Workflow', prompt: 'Organize...' },
              writeSpec: { label: 'Write spec', prompt: 'Write spec...' },
              manageIssues: { label: 'Issues', prompt: 'Manage...' },
            }),
          },
        },
      },
    },
  }),
}));

describe('QuickActions', () => {
  it('shows one More ideas trigger and hides category labels until opened', async () => {
    const user = userEvent.setup();
    render(<QuickActions onSelectPrompt={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: 'More ideas' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Analyze' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'More ideas' }));

    expect(screen.getByRole('menuitem', { name: 'Write' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Analyze' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Draft email' }),
    ).not.toBeInTheDocument();
  });

  it('calls onSelectPrompt with the chosen idea and closes the menu', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<QuickActions onSelectPrompt={onSelect} />);

    await user.click(screen.getByRole('button', { name: 'More ideas' }));
    await user.click(screen.getByRole('menuitem', { name: 'Write' }));
    await user.click(screen.getByRole('menuitem', { name: 'Draft email' }));

    expect(onSelect).toHaveBeenCalledWith('Draft an email about...');
    expect(screen.queryByRole('menuitem', { name: 'Draft email' })).toBeNull();
  });
});
