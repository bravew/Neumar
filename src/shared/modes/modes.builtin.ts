import {
  AudioLines,
  BookTemplate,
  Bot,
  CheckCircle2,
  Clapperboard,
  Cloud,
  Code2,
  FilePlus2,
  Film,
  FolderKanban,
  Gauge,
  History,
  Image,
  Import,
  Layers,
  Library,
  ListChecks,
  MessageCircle,
  Paintbrush,
  PenLine,
  PlayCircle,
  Repeat,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Wand2,
  WandSparkles,
} from 'lucide-react';

import { createDesignProject } from '@/shared/hooks/useDesignMode';
import { createVideoProject } from '@/shared/hooks/useVideoProject';
import { DEFAULT_VIDEO_PROJECT_TEMPLATE } from '@/shared/video/projectTemplates';

import { ModeRegistry } from './ModeRegistry';
import type { ChipDefinition, ModeDefinition } from './types';

const taskStarterChips: ChipDefinition[] = [
  {
    id: 'tasks.code',
    labelKey: 'composer.starter.tasks.code',
    icon: Code2,
    action: {
      kind: 'prefill',
      prompt: '',
      promptKey: 'composer.starter.tasks.codePrompt',
    },
  },
  {
    id: 'tasks.write',
    labelKey: 'composer.starter.tasks.write',
    icon: PenLine,
    action: {
      kind: 'prefill',
      prompt: '',
      promptKey: 'composer.starter.tasks.writePrompt',
    },
  },
  {
    id: 'tasks.plan',
    labelKey: 'composer.starter.tasks.plan',
    icon: ListChecks,
    action: {
      kind: 'prefill',
      prompt: '',
      promptKey: 'composer.starter.tasks.planPrompt',
    },
  },
  {
    id: 'tasks.research',
    labelKey: 'composer.starter.tasks.research',
    icon: Search,
    action: {
      kind: 'prefill',
      prompt: '',
      promptKey: 'composer.starter.tasks.researchPrompt',
    },
  },
  {
    id: 'tasks.drive',
    labelKey: 'composer.starter.tasks.fromDrive',
    icon: Cloud,
    action: {
      kind: 'prefill',
      prompt: '@gdrive ',
      promptKey: 'composer.starter.tasks.fromDrivePrompt',
    },
  },
];

const designStarterChips: ChipDefinition[] = [
  {
    id: 'design.artifact',
    labelKey: 'composer.starter.design.newArtifact',
    icon: FilePlus2,
    action: { kind: 'nav', href: '/design' },
  },
  {
    id: 'design.template',
    labelKey: 'composer.starter.design.fromTemplate',
    icon: BookTemplate,
    action: { kind: 'nav', href: '/design#image-templates' },
  },
  {
    id: 'design.audio',
    labelKey: 'composer.starter.design.audioProject',
    icon: AudioLines,
    action: { kind: 'nav', href: '/design?surface=audio' },
  },
  {
    id: 'design.import',
    labelKey: 'composer.starter.design.import',
    icon: Import,
    action: { kind: 'nav', href: '/design' },
  },
  {
    id: 'design.brandAudit',
    labelKey: 'composer.starter.design.brandAudit',
    icon: WandSparkles,
    action: {
      kind: 'prefill',
      prompt: '',
      promptKey: 'composer.starter.design.brandAuditPrompt',
    },
  },
  {
    id: 'design.critique',
    labelKey: 'composer.starter.design.critique',
    icon: CheckCircle2,
    action: {
      kind: 'prefill',
      prompt: '',
      promptKey: 'composer.starter.design.critiquePrompt',
    },
  },
];

const videoStarterChips: ChipDefinition[] = [
  {
    id: 'video.script',
    labelKey: 'composer.starter.video.script',
    icon: PenLine,
    action: {
      kind: 'prefill',
      prompt: '',
      promptKey: 'composer.starter.video.scriptPrompt',
    },
  },
  {
    id: 'video.images',
    labelKey: 'composer.starter.video.images',
    icon: Image,
    action: { kind: 'nav', href: '/video#assets' },
  },
  {
    id: 'video.clips',
    labelKey: 'composer.starter.video.clips',
    icon: Film,
    action: { kind: 'nav', href: '/video#assets' },
  },
  {
    id: 'video.aiGenerate',
    labelKey: 'composer.starter.video.aiGenerate',
    icon: Wand2,
    action: {
      kind: 'prefill',
      prompt: '',
      promptKey: 'composer.starter.video.aiGeneratePrompt',
    },
  },
  {
    id: 'video.template',
    labelKey: 'composer.starter.video.template',
    icon: Sparkles,
    action: { kind: 'nav', href: '/video/settings/templates' },
  },
];

const tasksMode: ModeDefinition = {
  id: 'tasks',
  labelKey: 'modes.tasks.label',
  icon: Bot,
  rootPath: '/',
  matches: [
    '/',
    /^\/task\//,
    /^\/task-v2\//,
    '/library',
    '/projects',
    /^\/projects\//,
    '/dashboard',
    '/approvals',
    '/org',
    /^\/org\//,
  ],
  shortcutSlot: 1,
  enabled: true,
  order: 10,
  sidebar: {
    primaryAction: {
      labelKey: 'modes.tasks.primaryAction',
      onSelect: ({ navigate }) => {
        navigate('/');
        // The home composer listens for this and focuses its textarea.
        window.dispatchEvent(new CustomEvent('tasks:focus-composer'));
      },
    },
    sections: [
      {
        id: 'tasks.library',
        labelKey: 'nav.library',
        icon: Library,
        href: '/library',
      },
      {
        id: 'tasks.automation',
        labelKey: 'nav.automation',
        icon: Sparkles,
        href: '/automation',
      },
      {
        id: 'tasks.approvals',
        labelKey: 'nav.approvals',
        icon: CheckCircle2,
        href: '/approvals',
      },
      {
        id: 'tasks.dashboard',
        labelKey: 'nav.dashboard',
        icon: Gauge,
        href: '/dashboard',
      },
    ],
  },
  composer: {
    placeholderKey: 'composer.placeholder.tasks',
    starterChips: taskStarterChips,
  },
};

const designMode: ModeDefinition = {
  id: 'design',
  labelKey: 'modes.design.label',
  icon: Paintbrush,
  rootPath: '/design',
  matches: ['/design', /^\/design\//],
  shortcutSlot: 2,
  enabled: true,
  order: 20,
  sidebar: {
    primaryAction: {
      labelKey: 'modes.design.primaryAction',
      onSelect: async ({ navigate, t }) => {
        try {
          const { project } = await createDesignProject({
            title: t.design.defaultProjectName,
            surface: 'prototype',
          });
          navigate(`/design/${project.id}`);
        } catch {
          navigate('/design');
        }
      },
    },
    sections: [
      {
        id: 'design.projects',
        labelKey: 'nav.projects',
        icon: FolderKanban,
        href: '/design',
      },
      {
        id: 'design.systems',
        labelKey: 'nav.designSystems',
        icon: Layers,
        href: '/design#design-systems',
      },
      {
        id: 'design.skills',
        labelKey: 'nav.designSkills',
        icon: Sparkles,
        href: '/design#skills',
      },
      {
        id: 'design.craft',
        labelKey: 'nav.craft',
        icon: Paintbrush,
        href: '/design#examples',
      },
      {
        id: 'design.customize',
        labelKey: 'nav.customize',
        icon: Settings2,
        href: '/design#image-templates',
      },
    ],
  },
  composer: {
    placeholderKey: 'composer.placeholder.design',
    starterChips: designStarterChips,
  },
};

const videoMode: ModeDefinition = {
  id: 'video',
  labelKey: 'modes.video.label',
  icon: Clapperboard,
  rootPath: '/video',
  matches: ['/video', /^\/video\//],
  shortcutSlot: 5,
  enabled: true,
  order: 25,
  sidebar: {
    primaryAction: {
      labelKey: 'modes.video.primaryAction',
      onSelect: async ({ navigate, t }) => {
        // Create immediately and open the editor (mirrors Design's "New"
        // action) instead of routing to an intermediate creation surface.
        try {
          const { project } = await createVideoProject({
            name: t.video.entry.defaultProjectName,
            template: DEFAULT_VIDEO_PROJECT_TEMPLATE,
            aspectRatio: '16:9',
          });
          navigate(`/video/${project.id}`);
        } catch {
          navigate('/video');
        }
      },
    },
    sections: [
      {
        id: 'video.projects',
        labelKey: 'nav.videoProjects',
        icon: FolderKanban,
        href: '/video',
      },
    ],
  },
  composer: {
    placeholderKey: 'composer.placeholder.video',
    starterChips: videoStarterChips,
  },
};

const automateMode: ModeDefinition = {
  id: 'automate',
  labelKey: 'modes.automate.label',
  icon: SlidersHorizontal,
  rootPath: '/automation',
  matches: ['/automation', /^\/automation\//],
  shortcutSlot: 3,
  enabled: true,
  order: 30,
  sidebar: {
    primaryAction: {
      labelKey: 'modes.automate.primaryAction',
      onSelect: ({ navigate }) => {
        navigate('/automation');
        // AutomationList listens for this and opens the create dialog.
        window.dispatchEvent(new CustomEvent('automation:open-create'));
      },
    },
    sections: [
      {
        id: 'automate.routines',
        labelKey: 'nav.routines',
        icon: Repeat,
        href: '/automation',
      },
      {
        id: 'automate.running',
        labelKey: 'nav.running',
        icon: PlayCircle,
        href: '/automation#running',
      },
      {
        id: 'automate.history',
        labelKey: 'nav.history',
        icon: History,
        href: '/automation#history',
      },
      {
        id: 'automate.customize',
        labelKey: 'nav.customize',
        icon: Settings2,
        href: '/automation#customize',
      },
    ],
  },
  composer: {
    placeholderKey: 'composer.placeholder.automate',
  },
};

const chatMode: ModeDefinition = {
  id: 'chat',
  labelKey: 'modes.chat.label',
  icon: MessageCircle,
  rootPath: '/chat',
  matches: ['/chat', /^\/chat\//],
  shortcutSlot: 4,
  enabled: true,
  order: 40,
  sidebar: {
    primaryAction: {
      labelKey: 'modes.chat.primaryAction',
      onSelect: ({ navigate }) => navigate('/chat'),
    },
    sections: [
      {
        id: 'chat.recents',
        labelKey: 'nav.recents',
        icon: MessageCircle,
        href: '/chat',
      },
      {
        id: 'chat.saved',
        labelKey: 'nav.saved',
        icon: Save,
        href: '/chat#saved',
      },
      {
        id: 'chat.customize',
        labelKey: 'nav.customize',
        icon: Settings2,
        href: '/chat#customize',
      },
    ],
  },
  composer: {
    placeholderKey: 'composer.placeholder.chat',
  },
};

ModeRegistry.register(tasksMode);
ModeRegistry.register(designMode);
ModeRegistry.register(videoMode);
ModeRegistry.register(automateMode);
ModeRegistry.register(chatMode);
