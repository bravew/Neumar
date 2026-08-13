import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QuickActions } from '@/components/home/QuickActions';

// Mock language provider with category labels and item prompts
// Build mock translation object matching the real locale structure:
// t.home.quickActionCategories.<category>.label / .items.<item>.label / .prompt
const makeItems = (items: Record<string, { label: string; prompt: string }>) =>
  items;

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      home: {
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
  it('renders category pills', () => {
    render(<QuickActions onSelectPrompt={vi.fn()} />);
    expect(screen.getByText('Write')).toBeInTheDocument();
    expect(screen.getByText('Code')).toBeInTheDocument();
    expect(screen.getByText('Analyze')).toBeInTheDocument();
  });

  it('expands panel when category is clicked', () => {
    render(<QuickActions onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByText('Write'));
    // Sub-items should appear
    expect(screen.getByText('Draft email')).toBeInTheDocument();
  });

  it('collapses panel when same category is clicked again', () => {
    render(<QuickActions onSelectPrompt={vi.fn()} />);

    // Open — click the first "Write" button (the pill)
    fireEvent.click(screen.getAllByText('Write')[0]!);
    expect(screen.getByText('Draft email')).toBeInTheDocument();

    // Close — click the pill again
    fireEvent.click(screen.getAllByText('Write')[0]!);
    // AnimatePresence will remove items asynchronously
  });

  it('calls onSelectPrompt when item is clicked', () => {
    const onSelect = vi.fn();
    render(<QuickActions onSelectPrompt={onSelect} />);

    fireEvent.click(screen.getByText('Write'));
    fireEvent.click(screen.getByText('Draft email'));

    expect(onSelect).toHaveBeenCalledWith('Draft an email about...');
  });

  it('closes panel when Escape is pressed', () => {
    render(<QuickActions onSelectPrompt={vi.fn()} />);

    fireEvent.click(screen.getByText('Code'));
    expect(screen.getByText('Build feature')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    // Panel should close
  });
});
