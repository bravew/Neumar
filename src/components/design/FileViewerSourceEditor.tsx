import { Copy, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DesignLintFinding } from '@/shared/types/design-mode';

import { LintPanel } from './LintPanel';

interface FileViewerSourceEditorProps {
  content: string;
  saving: boolean;
  sourceCopied: boolean;
  lintFindings: DesignLintFinding[];
  labels: {
    copy: string;
    copied: string;
    save: string;
    saving: string;
  };
  onContentChange: (content: string) => void;
  onCopy: () => void;
  onSave: () => void;
}

export function FileViewerSourceEditor({
  content,
  saving,
  sourceCopied,
  lintFindings,
  labels,
  onContentChange,
  onCopy,
  onSave,
}: FileViewerSourceEditorProps) {
  return (
    <div
      data-testid="file-viewer-source-editor"
      className="flex h-full min-h-[420px] flex-col gap-2"
    >
      <textarea
        value={content}
        onChange={(event) => onContentChange(event.target.value)}
        className="border-input bg-background min-h-0 flex-1 resize-none rounded-md border p-3 font-mono text-xs outline-none"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCopy}>
          <Copy className="size-4" />
          {sourceCopied ? labels.copied : labels.copy}
        </Button>
        <Button type="button" onClick={onSave} disabled={saving}>
          <Save className="size-4" />
          {saving ? labels.saving : labels.save}
        </Button>
      </div>
      <LintPanel findings={lintFindings} />
    </div>
  );
}
