import { useMemo, useState, type ReactNode } from 'react';

import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { Streamdown, type CustomRenderer } from 'streamdown';

import {
  decodeInProjectLinkHref,
  encodeInProjectLinkHref,
  resolveInProjectLink,
} from '@/shared/lib/in-project-link';
import { preprocessMarkdown } from '@/shared/lib/markdown-utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { LinkSafetyModal } from './LinkSafetyModal';
import { TaskV2CodeCard } from './TaskV2CodeCard';

// Module-level stable plugin config for Streamdown
const CODE_CARD_LANGUAGES = [
  ...new Set(
    code
      .getSupportedLanguages()
      .filter((language) => language !== 'mermaid' && language !== 'mmd'),
  ),
];
const CODE_CARD_RENDERERS: CustomRenderer[] = [
  {
    language: CODE_CARD_LANGUAGES,
    component: TaskV2CodeCard,
  },
];
const STREAMDOWN_PLUGINS = {
  code,
  math,
  mermaid,
  cjk,
  renderers: CODE_CARD_RENDERERS,
};
// `remark-gfm` enables GFM tables, task lists, autolinks, and strikethrough.
// Passing a `remarkPlugins` prop to Streamdown replaces its defaults, so we
// must include gfm explicitly or tables fall through as raw pipe-delimited
// text. `remark-breaks` runs after and converts soft line breaks in prose
// into `<br>` while leaving fenced code, lists, and tables intact.
const STREAMDOWN_REMARK_PLUGINS = [
  remarkGfm,
  remarkBreaks,
  preserveCodeMetaRemarkPlugin,
];

const PROSE_CLASS =
  'prose prose-sm text-foreground [&_:not(pre)>code]:bg-muted [&_thead]:bg-muted [&_th]:border-border [&_td]:border-border [&_tbody_tr:nth-child(even)]:bg-muted/30 max-w-none min-w-0 break-words [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-[0.85em] [&_:not(pre)>code]:before:content-none [&_:not(pre)>code]:after:content-none [&_img]:max-h-80 [&_img]:w-auto [&_img]:rounded-lg [&_img]:object-contain [&_pre]:max-w-full [&_pre]:break-words [&_pre]:whitespace-pre-wrap [&_pre_code]:break-words [&_pre_code]:whitespace-pre-wrap [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_td]:border [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_thead]:sticky [&_thead]:top-0';

type MarkdownAstNode = {
  type?: string;
  meta?: unknown;
  url?: unknown;
  data?: {
    hProperties?: Record<string, unknown>;
  };
  children?: MarkdownAstNode[];
};

function preserveCodeMetaRemarkPlugin() {
  return function transform(tree: MarkdownAstNode) {
    preserveCodeMeta(tree);
  };
}

function createProjectLinkRemarkPlugin(validPaths?: string[]) {
  return function projectLinkRemarkPlugin() {
    return function transform(tree: MarkdownAstNode) {
      rewriteProjectLinkUrls(tree, validPaths);
    };
  };
}

function preserveCodeMeta(node: MarkdownAstNode): void {
  if (node.type === 'code' && typeof node.meta === 'string') {
    node.data = node.data ?? {};
    node.data.hProperties = {
      ...node.data.hProperties,
      metastring: node.meta,
    };
  }
  for (const child of node.children ?? []) {
    preserveCodeMeta(child);
  }
}

function rewriteProjectLinkUrls(
  node: MarkdownAstNode,
  validPaths?: string[],
): void {
  if (node.type === 'link' && typeof node.url === 'string') {
    const projectPath = resolveInProjectLink(node.url, validPaths);
    if (projectPath) {
      node.url = encodeInProjectLinkHref(projectPath);
    }
  }
  for (const child of node.children ?? []) {
    rewriteProjectLinkUrls(child, validPaths);
  }
}

/**
 * Renders assistant markdown text via Streamdown with the app's plugin set,
 * link-safety policy, and prose styling. Extracted from MessageBubble to keep
 * that component under the size gate.
 */
export function MarkdownProse({
  content,
  animated = true,
  projectFilePaths,
  onProjectFileOpen,
}: {
  content: string;
  animated?: boolean;
  projectFilePaths?: string[];
  onProjectFileOpen?: (path: string) => void;
}) {
  const { t } = useLanguage();
  const remarkPlugins = useMemo(() => {
    if (!onProjectFileOpen) return STREAMDOWN_REMARK_PLUGINS;
    return [
      ...STREAMDOWN_REMARK_PLUGINS,
      createProjectLinkRemarkPlugin(projectFilePaths),
    ];
  }, [onProjectFileOpen, projectFilePaths]);

  const streamdownComponents = useMemo(
    () => ({
      a: function ProjectAwareLink({
        children,
        href,
        className,
      }: {
        children?: ReactNode;
        href?: string;
        className?: string;
      }) {
        const [modalOpen, setModalOpen] = useState(false);
        const projectPath =
          decodeInProjectLinkHref(href, projectFilePaths) ??
          resolveInProjectLink(href, projectFilePaths);
        return (
          <>
            <a
              href={href}
              className={className}
              onClick={(event) => {
                if (projectPath && onProjectFileOpen) {
                  event.preventDefault();
                  onProjectFileOpen(projectPath);
                  return;
                }
                if (href) {
                  event.preventDefault();
                  setModalOpen(true);
                }
              }}
            >
              {children}
            </a>
            {modalOpen && href && (
              <LinkSafetyModal url={href} onClose={() => setModalOpen(false)} />
            )}
          </>
        );
      },
    }),
    [onProjectFileOpen, projectFilePaths],
  );

  const streamdownTranslations = useMemo(
    () => ({
      copied: t.task.copied,
      copyCode: t.task.copyCode,
      downloadFile: t.task.downloadFile,
    }),
    [t.task.copied, t.task.copyCode, t.task.downloadFile],
  );

  return (
    <div className={PROSE_CLASS}>
      <Streamdown
        mode={animated ? undefined : 'static'}
        components={streamdownComponents}
        plugins={STREAMDOWN_PLUGINS}
        remarkPlugins={remarkPlugins}
        translations={streamdownTranslations}
        animated={animated}
      >
        {preprocessMarkdown(content)}
      </Streamdown>
    </div>
  );
}
