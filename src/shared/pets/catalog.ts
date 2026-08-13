import { API_BASE_URL } from '@/config';
import type {
  PetCustomSelection,
  PetSettingsConfig,
} from '@/shared/db/settings';

import { PET_ATLAS_LAYOUT, type PetAtlasLayout } from './atlas';

export interface PetCatalogItem {
  id: string;
  name: string;
  description: string;
  accent: string;
  glyph: string;
  greeting: string;
  spritesheetUrl: string;
  atlasLayout: PetAtlasLayout;
  sourceUrl: string;
}

export const BUILTIN_PETS = [
  {
    id: 'clippit',
    name: 'Clippy',
    description:
      'A retro desktop assistant built from classic animation frames.',
    accent: '#6d95d8',
    glyph: '📎',
    greeting: 'I am here when you want company during a long run.',
    spritesheetUrl: '/pets/clippit/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://codex-pet-share.pages.dev/#/pets/clippit',
  },
  {
    id: 'dario',
    name: 'Dario',
    description: 'A skeptical tiny assistant for code review sessions.',
    accent: '#c96442',
    glyph: '🤨',
    greeting: 'I will keep an eye on the build while you work.',
    spritesheetUrl: '/pets/dario/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://codex-pet-share.pages.dev/#/pets/dario',
  },
  {
    id: 'nori',
    name: 'Nori',
    description: 'A tiny smiling salmon sushi companion.',
    accent: '#f97373',
    glyph: '🍣',
    greeting: 'I will keep your workspace fresh while the agent works.',
    spritesheetUrl: '/pets/nori/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/nori-openpets',
  },
  {
    id: 'cloud-puff',
    name: 'Cloud Puff',
    description: 'A soft cream cloud companion with rosy cheeks.',
    accent: '#7db5ff',
    glyph: '☁️',
    greeting: 'I will hover nearby during long-running tasks.',
    spritesheetUrl: '/pets/cloud-puff/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/cloud-puff-openpets',
  },
  {
    id: 'bitty',
    name: 'Bitty',
    description: 'A tiny retro handheld console with a green screen smile.',
    accent: '#62b36f',
    glyph: '🎮',
    greeting: 'I will idle quietly while your tools compile.',
    spritesheetUrl: '/pets/bitty/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/bitty-openpets',
  },
  {
    id: 'nyako-shigure',
    name: 'Nyako Shigure',
    description: 'A composed dispatcher companion with soft motion.',
    accent: '#8b6fd6',
    glyph: '🐱',
    greeting: 'I will stay nearby while the agent coordinates tasks.',
    spritesheetUrl: '/pets/nyako-shigure/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://codex-pet-share.pages.dev/#/pets/nyako-shigure',
  },
  {
    id: 'raccoon',
    name: 'Raccoon',
    description: 'A gray pixel raccoon with a striped tail and mask.',
    accent: '#7c8794',
    glyph: '🦝',
    greeting: 'I will keep watch while your agent searches the workspace.',
    spritesheetUrl: '/pets/raccoon/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/raccoon-openpets',
  },
  {
    id: 'prickle',
    name: 'Prickle',
    description: 'A tiny potted cactus with a pink flower.',
    accent: '#4f9c6d',
    glyph: '🌵',
    greeting: 'I will stand by through the sharp parts of debugging.',
    spritesheetUrl: '/pets/prickle/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/prickle-openpets',
  },
  {
    id: 'planet',
    name: 'Planet',
    description: 'A small purple pixel planet with a blue ring.',
    accent: '#7c6ee6',
    glyph: '🪐',
    greeting: 'I will orbit your workspace while tasks run.',
    spritesheetUrl: '/pets/planet/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/planet-openpets',
  },
  {
    id: 'shadow-kit',
    name: 'Shadow Kit',
    description: 'A black kitten with amber eyes and a purple collar.',
    accent: '#c084fc',
    glyph: '🌙',
    greeting: 'I will sit quietly nearby while the task runs.',
    spritesheetUrl: '/pets/shadow-kit/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/shadow-kit-openpets',
  },
  {
    id: 'fox',
    name: 'Fox',
    description: 'A bright orange pixel fox with a white-tipped tail.',
    accent: '#f27b35',
    glyph: '🦊',
    greeting: 'I will keep watch while you move between branches.',
    spritesheetUrl: '/pets/fox/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/fox-openpets',
  },
  {
    id: 'azure',
    name: 'Azure',
    description: 'A tiny blue dragon with small wings and a friendly snout.',
    accent: '#38bdf8',
    glyph: '🐉',
    greeting: 'I will guard the run while your agent works.',
    spritesheetUrl: '/pets/azure/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/azure-openpets',
  },
  {
    id: 'bear',
    name: 'Bear',
    description: 'A warm brown pixel bear wearing a red bandana.',
    accent: '#a16207',
    glyph: '🐻',
    greeting: 'I will settle in while your build takes its time.',
    spritesheetUrl: '/pets/bear/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/bear-openpets',
  },
  {
    id: 'penguin',
    name: 'Penguin',
    description: 'A cozy pixel penguin bundled in a blue scarf.',
    accent: '#3b82f6',
    glyph: '🧣',
    greeting: 'I will keep cool while tests and tools run.',
    spritesheetUrl: '/pets/penguin/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/penguin-openpets',
  },
  {
    id: 'pip-mouse',
    name: 'Pip Mouse',
    description: 'A small gray mouse with big pink ears and tail.',
    accent: '#f472b6',
    glyph: '🐭',
    greeting: 'I will listen for small changes while the agent edits.',
    spritesheetUrl: '/pets/pip-mouse/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/pip-mouse-openpets',
  },
  {
    id: 'robot',
    name: 'Robot',
    description: 'A small friendly white robot with cyan screen eyes.',
    accent: '#22d3ee',
    glyph: '🤖',
    greeting: 'I will monitor the task queue while you focus.',
    spritesheetUrl: '/pets/robot/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/robot-openpets',
  },
  {
    id: 'patchi',
    name: 'Patchi',
    description: 'A tiny red panda with leafy head accents and a ringed tail.',
    accent: '#ef4444',
    glyph: '🐾',
    greeting: 'I will keep the workspace lively through long sessions.',
    spritesheetUrl: '/pets/patchi/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/patchi-openpets',
  },
  {
    id: 'meowbot',
    name: 'Meowbot',
    description: 'A silver cat-shaped robot with green screen eyes.',
    accent: '#10b981',
    glyph: '😺',
    greeting: 'I will keep the automation purring while the agent runs.',
    spritesheetUrl: '/pets/meowbot/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/meowbot-openpets',
  },
  {
    id: 'dewdrop',
    name: 'Dewdrop',
    description: 'A green slime sprout pet with a cheerful face.',
    accent: '#22c55e',
    glyph: '🌱',
    greeting: 'I will sprout ideas while the agent waits on tools.',
    spritesheetUrl: '/pets/dewdrop/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/dewdrop-openpets',
  },
  {
    id: 'budgie-berry',
    name: 'Budgie Berry',
    description: 'A round pink bird with a small green sprout.',
    accent: '#ec4899',
    glyph: '🐦',
    greeting: 'I will chirp along quietly while work progresses.',
    spritesheetUrl: '/pets/budgie-berry/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/budgie-berry-openpets',
  },
  {
    id: 'rabbit',
    name: 'Rabbit',
    description: 'A tiny white pixel rabbit with tall pink ears.',
    accent: '#f9a8d4',
    glyph: '🐰',
    greeting: 'I will hop back in when the next task starts.',
    spritesheetUrl: '/pets/rabbit/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://openpets.dev/pets/rabbit-openpets',
  },
  {
    id: 'tux',
    name: 'Tux',
    description: 'A small pixel-styled Linux companion for coding sessions.',
    accent: '#3c8dbc',
    glyph: '🐧',
    greeting: 'I am ready to wait through installs, builds, and tests.',
    spritesheetUrl: '/pets/tux/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://codex-pet-share.pages.dev/#/pets/tux',
  },
  {
    id: 'yelling-dario',
    name: 'Yelling Dario',
    description: 'A high-energy companion for noisy debugging loops.',
    accent: '#dc7a34',
    glyph: '📣',
    greeting: 'I will react when the agent gets moving.',
    spritesheetUrl: '/pets/yelling-dario/spritesheet.webp',
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: 'https://codex-pet-share.pages.dev/#/pets/yelling-dario',
  },
] satisfies PetCatalogItem[];

export function getPetById(id: string | undefined): PetCatalogItem {
  return (
    BUILTIN_PETS.find((pet) => pet.id === id) ?? BUILTIN_PETS[0] ?? fallbackPet
  );
}

export function getPetForSettings(settings: PetSettingsConfig): PetCatalogItem {
  if (
    settings.activePetSource === 'custom' &&
    settings.customPet?.id === settings.activePetId
  ) {
    return customPetToCatalogItem(settings.customPet);
  }

  return getPetById(settings.activePetId);
}

export function customPetToCatalogItem(
  pet: PetCustomSelection,
): PetCatalogItem {
  return {
    id: pet.id,
    name: pet.name,
    description: pet.description,
    accent: pet.accent,
    glyph: pet.glyph,
    greeting: pet.greeting,
    spritesheetUrl: `${API_BASE_URL}/pets/custom/${encodeURIComponent(
      pet.id,
    )}/spritesheet`,
    atlasLayout: PET_ATLAS_LAYOUT,
    sourceUrl: pet.sourceUrl ?? '',
  };
}

const fallbackPet: PetCatalogItem = {
  id: 'fallback',
  name: 'Companion',
  description: 'A simple fallback companion.',
  accent: '#6d95d8',
  glyph: 'C',
  greeting: 'I am here when you need me.',
  spritesheetUrl: '',
  atlasLayout: PET_ATLAS_LAYOUT,
  sourceUrl: '',
};
