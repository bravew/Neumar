import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';

import { useTheme } from '@/shared/providers/theme-provider';

import type { PreviewComponentProps } from './types';
import { getLanguageHint } from './utils';

// Module-level constants — inline objects break SyntaxHighlighter memoization
const LINE_NUMBER_STYLES = `.code-preview .linenumber { -webkit-user-select: none !important; user-select: none !important; pointer-events: none; }`;

const HIGHLIGHTER_CUSTOM_STYLE: React.CSSProperties = {
  margin: 0,
  padding: '0.5rem 0',
  fontSize: '12px',
  lineHeight: '1.4',
  background: 'transparent',
  overflow: 'visible',
};

const CODE_TAG_PROPS = { style: { background: 'transparent' } };
const LINE_PROPS = {
  style: { background: 'transparent', display: 'block' as const },
};

const LINE_NUMBER_STYLE_DARK: React.CSSProperties = {
  minWidth: '3em',
  paddingRight: '1em',
  paddingLeft: '0.5em',
  color: '#636d83',
  userSelect: 'none',
  WebkitUserSelect: 'none' as const,
  background: 'transparent',
};

const LINE_NUMBER_STYLE_LIGHT: React.CSSProperties = {
  ...LINE_NUMBER_STYLE_DARK,
  color: '#9ca3af',
};

export function CodePreview({ artifact }: PreviewComponentProps) {
  const { theme } = useTheme();

  if (!artifact.content) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-muted-foreground text-sm">No content available</p>
      </div>
    );
  }

  const language = getLanguageHint(artifact);
  const isPlainText = language === 'plaintext' || language === 'text';
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Plain text files: render as selectable, word-wrapped text without line numbers
  if (isPlainText) {
    return (
      <div className="h-full overflow-auto p-4">
        <pre className="text-foreground font-sans text-sm leading-relaxed break-words whitespace-pre-wrap">
          {artifact.content}
        </pre>
      </div>
    );
  }

  // The oneDark/oneLight themes set `overflow: auto` on the <pre>, creating a
  // nested scroll container whose h-scrollbar sits at the content bottom.
  // Override to `overflow: visible` so only our outer div scrolls — its
  // h-scrollbar stays pinned at the viewport bottom.
  return (
    <div className="code-preview h-full overflow-auto">
      <style>{LINE_NUMBER_STYLES}</style>
      <SyntaxHighlighter
        language={language}
        style={isDark ? oneDark : oneLight}
        showLineNumbers
        wrapLines
        customStyle={HIGHLIGHTER_CUSTOM_STYLE}
        codeTagProps={CODE_TAG_PROPS}
        lineProps={LINE_PROPS}
        lineNumberStyle={
          isDark ? LINE_NUMBER_STYLE_DARK : LINE_NUMBER_STYLE_LIGHT
        }
      >
        {artifact.content}
      </SyntaxHighlighter>
    </div>
  );
}
