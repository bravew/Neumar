import { useState } from 'react';

import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';

import { DURATION, SPRING } from '@/config/animation';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { useTheme } from '@/shared/providers/theme-provider';

import { JsonTreeView, KeyValueTable, ViewToggle } from './JsonViewer';
import type { ViewMode } from './JsonViewer';
import { isFlatObject, maskSecrets, tryParseJSON } from './tool-utils';

// Module-level constant for JSON highlight styling overrides
const JSON_HIGHLIGHT_STYLE: React.CSSProperties = {
  margin: 0,
  padding: '0.75rem',
  borderRadius: '0.375rem',
  fontSize: '0.75rem',
  lineHeight: '1.5',
  maxHeight: '400px',
  overflow: 'auto',
  wordBreak: 'break-all',
  whiteSpace: 'pre-wrap',
};

const JSON_INPUT_STYLE: React.CSSProperties = {
  ...JSON_HIGHLIGHT_STYLE,
  maxHeight: '250px',
};

export function ToolDetailModal({
  toolName,
  input,
  output,
  isError,
  isWarning,
  onClose,
}: {
  toolName: string;
  input: Record<string, unknown> | undefined;
  output: string | undefined;
  isError: boolean;
  isWarning: boolean;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  const syntaxStyle = isDark ? oneDark : oneLight;

  const isInputFlat = input ? isFlatObject(input) : false;
  const [inputView, setInputView] = useState<ViewMode>(
    isInputFlat ? 'table' : 'code',
  );

  const parsedOutput = output ? tryParseJSON(output) : null;
  const isOutputFlat = parsedOutput ? isFlatObject(parsedOutput) : false;
  const [outputView, setOutputView] = useState<ViewMode>(
    isOutputFlat ? 'table' : 'code',
  );

  const formatOutputText = (raw: string | undefined): string => {
    if (!raw) return t.task.toolNoOutputData;
    const toolUseErrorMatch = raw.match(
      /<tool_use_error>([\s\S]*?)<\/tool_use_error>/,
    );
    let clean = toolUseErrorMatch ? toolUseErrorMatch[1].trim() : raw;
    clean = maskSecrets(clean);
    if (clean.length > 10000) {
      return clean.slice(0, 10000) + '\n\n' + t.task.toolTruncated;
    }
    return clean;
  };

  const renderInputContent = () => {
    if (!input)
      return (
        <p className="text-muted-foreground p-3 text-xs italic">
          {t.task.toolNoInput}
        </p>
      );

    switch (inputView) {
      case 'table':
        return (
          <KeyValueTable
            data={input}
            keyLabel={t.task.toolKeyColumn}
            valueLabel={t.task.toolValueColumn}
          />
        );
      case 'tree':
        return (
          <div className="bg-muted/50 max-h-[250px] overflow-auto rounded-md p-3">
            <JsonTreeView data={input} />
          </div>
        );
      case 'code':
      default: {
        const jsonStr = maskSecrets(JSON.stringify(input, null, 2));
        return (
          <SyntaxHighlighter
            language="json"
            style={syntaxStyle}
            customStyle={JSON_INPUT_STYLE}
            wrapLongLines
          >
            {jsonStr}
          </SyntaxHighlighter>
        );
      }
    }
  };

  const renderOutputContent = () => {
    if (!output)
      return (
        <p className="text-muted-foreground p-3 text-xs italic">
          {t.task.toolNoOutputData}
        </p>
      );

    if (parsedOutput && outputView === 'table' && isFlatObject(parsedOutput)) {
      return (
        <KeyValueTable
          data={parsedOutput as Record<string, unknown>}
          keyLabel={t.task.toolKeyColumn}
          valueLabel={t.task.toolValueColumn}
        />
      );
    }
    if (parsedOutput && outputView === 'tree') {
      return (
        <div
          className={cn(
            'max-h-[400px] overflow-auto rounded-md p-3',
            isError
              ? 'bg-red-500/10'
              : isWarning
                ? 'bg-amber-500/10'
                : 'bg-muted/50',
          )}
        >
          <JsonTreeView data={parsedOutput} />
        </div>
      );
    }

    // Default: syntax-highlighted code or plain text
    const formatted = formatOutputText(output);
    if (parsedOutput) {
      const jsonStr = maskSecrets(JSON.stringify(parsedOutput, null, 2));
      return (
        <SyntaxHighlighter
          language="json"
          style={syntaxStyle}
          customStyle={{
            ...JSON_HIGHLIGHT_STYLE,
            ...(isError
              ? { backgroundColor: 'rgba(239, 68, 68, 0.1)' }
              : isWarning
                ? { backgroundColor: 'rgba(245, 158, 11, 0.1)' }
                : {}),
          }}
          wrapLongLines
        >
          {jsonStr}
        </SyntaxHighlighter>
      );
    }

    // Plain text output
    return (
      <pre
        className={cn(
          'max-h-[400px] overflow-auto rounded-md p-3 font-mono text-xs break-words whitespace-pre-wrap',
          isError
            ? 'bg-red-500/10 text-red-400'
            : isWarning
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              : 'bg-muted/50',
        )}
      >
        {formatted}
      </pre>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: DURATION.normal }}
      />
      <motion.div
        className="bg-background border-border relative flex max-h-[80vh] w-[700px] max-w-[90vw] flex-col rounded-lg border shadow-xl"
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ ...SPRING.snappy }}
      >
        {/* Header */}
        <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-mono font-medium">{toolName}</span>
            {isError && (
              <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-500">
                {t.task.toolError}
              </span>
            )}
            {isWarning && !isError && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-500">
                {t.task.toolInfo}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t.task.toolClose}
            className="hover:bg-accent cursor-pointer rounded-md p-1 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-auto p-4">
          {/* Input Section */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-muted-foreground text-sm font-medium">
                {t.task.toolInput}
              </h3>
              {input && typeof input === 'object' && (
                <ViewToggle
                  mode={inputView}
                  onModeChange={setInputView}
                  showTable={isInputFlat}
                  labels={{
                    code: t.task.toolViewCode,
                    tree: t.task.toolViewTree,
                    table: t.task.toolViewTable,
                  }}
                />
              )}
            </div>
            {renderInputContent()}
          </div>

          {/* Output Section */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-muted-foreground text-sm font-medium">
                {t.task.toolOutput}
              </h3>
              {parsedOutput !== null && (
                <ViewToggle
                  mode={outputView}
                  onModeChange={setOutputView}
                  showTable={isOutputFlat}
                  labels={{
                    code: t.task.toolViewCode,
                    tree: t.task.toolViewTree,
                    table: t.task.toolViewTable,
                  }}
                />
              )}
            </div>
            {renderOutputContent()}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
