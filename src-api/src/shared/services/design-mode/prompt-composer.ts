import { createHash } from 'node:crypto';
import path from 'node:path';

import { composeCatalogPreamble } from '@/shared/assets';
import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

import { getCraft, getDesignSkill, getDesignSystem } from './catalogs';
import {
  buildDesignContextPackPrompt,
  normalizeDesignContextPacks,
} from './context-packs';
import {
  appendProjectHistory,
  copyIntoProject,
  getProjectDir,
  writeJsonAtomic,
  writeTextAtomic,
} from './fs';
import { normalizeLinkedContextDirs } from './linked-context';
import { patchDesignProject } from './projects';
import { DESIGN_SKILLS_CWD_ALIAS, stageDesignModeSkill } from './skill-staging';
import type { DesignProject } from './types';

const logger = createLogger('PromptComposer');

export interface ResolvedPrompt {
  system: string;
  user: string;
  sections: ResolvedPromptSection[];
}

export interface ResolvedPromptSection {
  id: string;
  title: string;
  body: string;
  cache_control?: { type: 'ephemeral' };
}

interface PromptStackSectionSnapshot {
  id: string;
  title: string;
  bodyHash: string;
  bodyBytes: number;
  cacheControl: 'ephemeral' | null;
}

interface PromptStackSnapshot {
  version: 'design-prompt-stack.v1';
  generatedAt: string;
  project: {
    id: string;
    surface: DesignProject['surface'];
    intent: DesignProject['intent'];
    designSystemId: string | null;
    resolvedDesignSystemId: string | null;
    inspirationDesignSystemIds: string[];
    skillId: string | null;
    craftRefs: string[];
    linkedContextDirs: string[];
    contextPackIds: string[];
    promptTemplateId: string | null;
    mediaModel: string | null;
  };
  latestMessageHash: string | null;
  systemHash: string;
  userHash: string;
  sections: PromptStackSectionSnapshot[];
}

export async function resolveProjectPrompt(
  project: DesignProject,
  latestMessage = '',
): Promise<ResolvedPrompt> {
  const sections: ResolvedPromptSection[] = [];
  const designSystem = project.designSystemId
    ? await getDesignSystem(project.designSystemId)
    : await getDesignSystem('default-freeform');
  const inspirations = await Promise.all(
    project.inspirationDesignSystemIds.map((id) => getDesignSystem(id)),
  );
  const skill = project.skillId ? await getDesignSkill(project.skillId) : null;
  const template = project.promptTemplate;
  const projectDir = getProjectDir(project.id);
  const contextPacks = normalizeDesignContextPacks(project.contextPacks ?? []);
  const linkedContextDirs = normalizeLinkedContextDirs(
    project.linkedContextDirs ?? [],
  );
  const craftIds = [
    ...new Set([
      ...project.craftRefs,
      ...(skill?.od.craft?.requires ?? []),
      'anti-ai-slop',
    ]),
  ];
  const crafts = (
    await Promise.all(craftIds.map((id) => getCraft(id)))
  ).flatMap((item) => (item ? [item] : []));

  sections.push({
    id: 'contract',
    title: 'DesignMode operating contract',
    body: [
      'You are working in a Neuma DesignMode project folder.',
      'Write generated files into artifacts/, assets/generated/, prompts/, exports/, comments/, sketches/, and provenance/ only.',
      `Selected skill side files, when present, are staged under ${DESIGN_SKILLS_CWD_ALIAS}/ inside the project folder as regular copied files.`,
      'Media outputs must be real bytes produced by the dispatcher or renderer; never paste fabricated base64 as an artifact.',
      'Do not emit a new HTML artifact when the turn only explains a change, edits an existing HTML file, or would produce prose instead of a complete document. For HTML artifacts, start with <!doctype html> or <html and write a full document.',
      'HTML previews stay sandboxed without allow-same-origin. Use data-neuma-id attributes for editable regions.',
      'Record provider, model, prompt/settings hash, references, output path, task id, timestamp, and disclosure for each generated asset.',
    ].join('\n'),
  });
  sections.push({
    id: 'brief',
    title: 'Project surface and brief',
    body: JSON.stringify(
      {
        id: project.id,
        title: project.title,
        surface: project.surface,
        intent: project.intent ?? 'other',
        media: project.media ?? {},
        brief: project.brief,
      },
      null,
      2,
    ),
  });
  const catalogContext = await composeCatalogPreamble({
    scope: 'design_project',
    scopeId: project.id,
  });
  if (catalogContext) {
    sections.push({
      id: 'asset-catalog',
      title: 'Workspace asset catalog',
      body: [
        catalogContext,
        'Use assets_search before generating new media when existing workspace assets may fit. Use assets_attach with scope "design_project" and this project id to import catalog assets into assets/imports/.',
      ].join('\n'),
    });
  }
  const chatLocale = chatLocaleFromBrief(project.brief);
  if (chatLocale) {
    sections.push({
      id: 'discovery-language',
      title: 'Discovery form language',
      body: [
        `The user's active chat language is ${chatLocale}.`,
        'When you ask discovery questions, generate a brief/intake form, or emit a discovery-question-form artifact, write the form title, description, question labels, option labels, helper text, validation messages, and placeholders in that language.',
        'Treat English examples in skills, templates, and prompt snippets as structure examples only; do not copy their wording unless the active chat language is English.',
      ].join('\n'),
    });
  }
  const discoverySkipSection = unmodifiedExampleDiscoverySkipSection(
    project,
    latestMessage,
  );
  if (discoverySkipSection) {
    sections.push(discoverySkipSection);
  }
  if (isScreenFileFirstIntent(project.intent)) {
    sections.push({
      id: 'screen-file-first',
      title: 'Screen-file-first output contract',
      body: [
        `This project intent is ${project.intent}. Generate separate screen files for each target viewport or platform instead of one tabbed demo with viewport switchers.`,
        'For responsive web work, prefer artifacts/mobile.html, artifacts/tablet.html, and artifacts/desktop.html. For OS widgets, prefer size-specific files such as artifacts/widget-small.html, artifacts/widget-medium.html, and artifacts/widget-large.html.',
        'Each generated file should be a complete standalone HTML document and should map 1:1 to the DESIGN-MANIFEST.json platform and responsive handoff entries.',
        'If the brief is minimal, still produce a polished artifact with real layout structure, clear hierarchy, accessible controls, responsive spacing, and enough representative content to judge the design. Avoid monochrome unstyled placeholders.',
      ].join('\n'),
    });
  }
  const userCustomInstructions = readDesignModeCustomInstructions();
  if (userCustomInstructions) {
    sections.push({
      id: 'custom-instructions-user',
      title: 'User-level custom instructions',
      body: [
        'Apply these user-level preferences unless project-level custom instructions below conflict.',
        userCustomInstructions,
      ].join('\n\n'),
    });
  }
  const projectCustomInstructions = normalizeCustomInstructions(
    project.customInstructions,
  );
  if (projectCustomInstructions) {
    sections.push({
      id: 'custom-instructions-project',
      title: 'Project-level custom instructions',
      body: [
        'Apply these project-level instructions for this project. When they conflict with user-level custom instructions, project-level instructions win.',
        projectCustomInstructions,
      ].join('\n\n'),
    });
  }
  if (linkedContextDirs.length > 0) {
    sections.push({
      id: 'linked-context',
      title: 'Linked context directories',
      body: [
        'The following workspace-scoped directories were explicitly linked for read-only context:',
        ...linkedContextDirs.map((dir) => `- ${dir}`),
      ].join('\n'),
    });
  }
  if (designSystem) {
    const tokenChannelEnabled = readDesignModeTokenChannelEnabled();
    let tokenSection: ResolvedPromptSection | null = null;
    let fixtureSection: ResolvedPromptSection | null = null;
    sections.push({
      id: 'design-system',
      title: `Active design system: ${designSystem.title}`,
      body: designSystem.body,
    });
    if (tokenChannelEnabled && designSystem.tokenCss) {
      tokenSection = {
        id: 'design-system-tokens',
        title: `Active design system tokens — ${designSystem.title}`,
        body: [
          "The block below is this brand's tokens.css contract — every `:root` custom property and any scoped override the brand defines. **Paste the unscoped `:root { ... }` block verbatim into the artifact's first `<style>`** so every `var(--*)` reference resolves at runtime.",
          'Do not invent new tokens. Do not redefine these values. Do not write raw hex outside this :root block. The DESIGN.md above is prose; this is the binding contract.',
          '```css',
          designSystem.tokenCss,
          '```',
        ].join('\n\n'),
      };
      sections.push(tokenSection);
    }
    if (tokenChannelEnabled && designSystem.componentsHtml) {
      fixtureSection = {
        id: 'design-system-components',
        title: `Reference fixture — ${designSystem.title}`,
        body: [
          'A self-contained worked artifact in this design system. Match its component shapes (button structure, card structure, type-scale rhythm, focus ring, spacing cadence) when generating new artifacts. Copying fragments is encouraged as long as you keep the `var(--*)` references intact — they are already wired to the tokens above.',
          '```html',
          designSystem.componentsHtml,
          '```',
        ].join('\n\n'),
      };
      sections.push(fixtureSection);
    }
    const cacheBreakSection = fixtureSection ?? tokenSection;
    if (cacheBreakSection) {
      cacheBreakSection.cache_control = { type: 'ephemeral' };
    }
    if (designSystem.path) {
      await copyIntoProject(
        project.id,
        designSystem.path,
        'design-system/DESIGN.md',
      );
      const systemRoot = path.dirname(designSystem.path);
      if (tokenChannelEnabled) {
        await copyOptionalDesignSystemSidecar(
          project.id,
          systemRoot,
          'tokens.css',
        );
        await copyOptionalDesignSystemSidecar(
          project.id,
          systemRoot,
          'components.html',
        );
      }
    }
  }
  const contextPackPrompt = buildDesignContextPackPrompt(contextPacks);
  if (contextPackPrompt) {
    sections.push({
      id: 'design-context-packs',
      title: 'Figma and Code Connect context pack',
      body: contextPackPrompt,
      cache_control: { type: 'ephemeral' },
    });
  }
  await writeJsonAtomic(
    path.join(projectDir, 'prompts/context-packs.json'),
    contextPacks,
  );
  inspirations
    .flatMap((item) => (item ? [item] : []))
    .forEach((inspiration, index) => {
      sections.push({
        id: `inspiration-${index + 1}`,
        title: `Inspiration design system ${index + 1}: ${inspiration.title}`,
        body: inspiration.body,
      });
    });
  for (const craft of crafts) {
    sections.push({
      id: `craft-${craft.id}`,
      title: `Craft reference: ${craft.title}`,
      body: craft.body,
    });
    if (craft.path)
      await copyIntoProject(project.id, craft.path, `craft/${craft.id}.md`);
  }
  if (skill) {
    sections.push({
      id: 'skill',
      title: `Selected skill: ${skill.name}`,
      body: skill.content,
    });
    if (skill.path) {
      await writeTextAtomic(
        path.join(projectDir, 'skill/SKILL.md'),
        skill.content,
      );
      const staged = await stageDesignModeSkill(
        projectDir,
        skill.slug,
        skill.path,
        (message) => logger.warn(message),
      );
      sections.push({
        id: 'skill-side-files',
        title: 'Selected skill side-file paths',
        body: staged.staged
          ? [
              `Use ${staged.aliasPath}/ for cwd-relative access to this skill's side files.`,
              `The staged directory is ${staged.stagedPath}.`,
              `If a CLI adapter also exposes absolute allowed directories, the source skill folder is ${skill.path}.`,
            ].join('\n')
          : [
              `Skill side-file staging did not complete: ${staged.reason ?? 'unknown reason'}.`,
              `Fallback source skill folder: ${skill.path}.`,
            ].join('\n'),
      });
    }
  }
  if (template?.prompt) {
    sections.push({
      id: 'prompt-template',
      title: `Prompt template: ${template.title}`,
      body: template.prompt,
    });
    await writeJsonAtomic(
      path.join(projectDir, 'prompts/prompt-template.json'),
      template,
    );
  }
  if (
    project.surface === 'image' ||
    project.surface === 'video' ||
    project.surface === 'audio'
  ) {
    sections.push({
      id: 'media-contract',
      title: 'Media generation contract',
      body: mediaContract(project.surface),
    });
  }

  const system = sections
    .map((section) => `## ${section.title}\n\n${section.body}`)
    .join('\n\n---\n\n');
  const user = [
    latestMessage ? `Latest user message:\n${latestMessage}` : '',
    'Use the project manifest, brief, selected skill, design system, craft references, and capability constraints above.',
  ]
    .filter(Boolean)
    .join('\n\n');

  await writeTextAtomic(
    path.join(projectDir, 'prompts/resolved-system.md'),
    system,
  );
  await writeTextAtomic(
    path.join(projectDir, 'prompts/resolved-user.md'),
    user,
  );
  await writeJsonAtomic(
    path.join(projectDir, 'prompts/prompt-stack.json'),
    buildPromptStackSnapshot({
      project,
      resolvedDesignSystemId: designSystem?.id ?? null,
      craftRefs: craftIds,
      linkedContextDirs,
      contextPacks,
      sections,
      system,
      user,
      latestMessage,
    }),
  );
  await appendProjectHistory(project.id, {
    type: 'prompt.resolved',
    at: new Date().toISOString(),
    sections: sections.map((section) => section.id),
  });
  await patchDesignProject(project.id, {
    craftRefs: craftIds,
    linkedContextDirs,
    contextPacks,
  });
  logger.info(`Resolved DesignMode prompt for ${project.id}`);
  return { system, user, sections };
}

function buildPromptStackSnapshot({
  project,
  resolvedDesignSystemId,
  craftRefs,
  linkedContextDirs,
  contextPacks,
  sections,
  system,
  user,
  latestMessage,
}: {
  project: DesignProject;
  resolvedDesignSystemId: string | null;
  craftRefs: string[];
  linkedContextDirs: string[];
  contextPacks: DesignProject['contextPacks'];
  sections: ResolvedPromptSection[];
  system: string;
  user: string;
  latestMessage: string;
}): PromptStackSnapshot {
  return {
    version: 'design-prompt-stack.v1',
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      surface: project.surface,
      intent: project.intent,
      designSystemId: project.designSystemId,
      resolvedDesignSystemId,
      inspirationDesignSystemIds: project.inspirationDesignSystemIds,
      skillId: project.skillId,
      craftRefs,
      linkedContextDirs,
      promptTemplateId: project.promptTemplate?.id ?? null,
      mediaModel: project.media?.model ?? null,
      contextPackIds: contextPacks?.map((pack) => pack.id) ?? [],
    },
    latestMessageHash: latestMessage ? sha256Hex(latestMessage) : null,
    systemHash: sha256Hex(system),
    userHash: sha256Hex(user),
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      bodyHash: sha256Hex(section.body),
      bodyBytes: Buffer.byteLength(section.body, 'utf-8'),
      cacheControl: section.cache_control?.type ?? null,
    })),
  };
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex');
}

function readDesignModeCustomInstructions(): string {
  const raw = getSetting('designMode');
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as { customInstructions?: unknown };
    return normalizeCustomInstructions(parsed.customInstructions);
  } catch {
    return '';
  }
}

function readDesignModeTokenChannelEnabled(): boolean {
  const raw = getSetting('designMode');
  if (!raw) return true;
  try {
    const parsed = JSON.parse(raw) as { tokenChannelEnabled?: unknown };
    return parsed.tokenChannelEnabled !== false;
  } catch {
    return true;
  }
}

function normalizeCustomInstructions(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 5000) : '';
}

function chatLocaleFromBrief(brief: Record<string, unknown>): string | null {
  for (const key of ['chatLocale', 'locale', 'language']) {
    const value = brief[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, 40);
    }
  }
  return null;
}

function unmodifiedExampleDiscoverySkipSection(
  project: DesignProject,
  latestMessage: string,
): ResolvedPromptSection | null {
  if (!project.promptTemplate?.prompt) return null;
  const fromExample =
    project.brief.createdFromTemplate === true ||
    project.brief.createdFromPromptLibrary === true;
  if (!fromExample) return null;

  const templatePrompt = normalizePromptForComparison(
    project.promptTemplate.prompt,
  );
  const briefPrompt = normalizePromptForComparison(project.brief.prompt);
  const effectivePrompt =
    normalizePromptForComparison(latestMessage) || briefPrompt;
  if (!templatePrompt || effectivePrompt !== templatePrompt) return null;

  const source = project.brief.createdFromPromptLibrary
    ? 'prompt-library sample'
    : 'prompt template';
  return {
    id: 'discovery-skip',
    title: 'Discovery skip for unchanged example prompt',
    body: [
      `This project was created from a ${source}, and the latest prompt still matches that saved example prompt exactly.`,
      'Treat the prompt-template section as the accepted brief. Do not ask broad discovery or clarifying questions before the first generation.',
      'Proceed directly unless a missing detail is required for safety, provider capability selection, or a hard output/file contract.',
      'If a question is truly blocking, ask only the smallest blocking question and continue after the answer.',
    ].join('\n'),
  };
}

function normalizePromptForComparison(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

function isScreenFileFirstIntent(intent: DesignProject['intent']) {
  return (
    intent === 'landing-page' ||
    intent === 'app-screen' ||
    intent === 'os-widget'
  );
}

async function copyOptionalDesignSystemSidecar(
  projectId: string,
  systemRoot: string,
  fileName: string,
) {
  try {
    await copyIntoProject(
      projectId,
      path.join(systemRoot, fileName),
      `design-system/${fileName}`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function mediaContract(surface: 'image' | 'video' | 'audio'): string {
  if (surface === 'image') {
    return [
      'Image prompt anatomy: subject, context/background, style, composition, lighting/camera, text requirements, aspect ratio, reference image usage, negative prompt, output format.',
      'Use neuma_media_generate for provider-backed image bytes and write outputs under assets/generated/.',
    ].join('\n');
  }
  if (surface === 'video') {
    return [
      'Video prompt anatomy: subject, action, scene, camera movement, motion style, duration, aspect ratio, first/last frame references, continuity/seed, audio needs.',
      'Use neuma_media_generate and neuma_media_wait for provider or HyperFrames video work. Long polls return running with a nextSince cursor.',
    ].join('\n');
  }
  return [
    'Audio prompt anatomy: audio kind, purpose, mood, voice/speaker, language, pace/tempo, duration, format, disclosure requirement, transcript when applicable.',
    'Speech and voiceover use the speech router. Music, SFX, and ambience remain capability-gated.',
  ].join('\n');
}
