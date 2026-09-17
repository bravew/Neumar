import { useState } from 'react';

import { FileVideo, Link, Upload } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

interface ReferenceAddFormProps {
  disabled: boolean;
  onAddFile: (file: File) => void;
  onAddPath: (path: string) => void;
  onAddUrl: (url: string) => void;
}

export function ReferenceAddForm({
  disabled,
  onAddFile,
  onAddPath,
  onAddUrl,
}: ReferenceAddFormProps) {
  const { t } = useLanguage();
  const labels = t.video.reference;
  const [pathValue, setPathValue] = useState('');
  const [urlValue, setUrlValue] = useState('');
  return (
    <div className="space-y-2">
      <label className="border-border hover:bg-accent/40 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-sm">
        <Upload className="size-4" />
        <span>{labels.addFile}</span>
        <input
          type="file"
          accept="video/*"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) onAddFile(file);
            event.currentTarget.value = '';
          }}
        />
      </label>
      <div className="flex gap-2">
        <input
          value={pathValue}
          onChange={(event) => setPathValue(event.target.value)}
          placeholder={labels.pathPlaceholder}
          className="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-xs"
          disabled={disabled}
        />
        <button
          type="button"
          aria-label={labels.pathPlaceholder}
          className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs disabled:opacity-40"
          disabled={disabled || !pathValue.trim()}
          onClick={() => {
            onAddPath(pathValue.trim());
            setPathValue('');
          }}
        >
          <FileVideo className="size-4" />
        </button>
      </div>
      <div className="flex gap-2">
        <input
          value={urlValue}
          onChange={(event) => setUrlValue(event.target.value)}
          placeholder={labels.urlPlaceholder}
          className="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-xs"
          disabled={disabled}
        />
        <button
          type="button"
          aria-label={labels.urlPlaceholder}
          className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs disabled:opacity-40"
          disabled={disabled || !urlValue.trim()}
          onClick={() => {
            onAddUrl(urlValue.trim());
            setUrlValue('');
          }}
        >
          <Link className="size-4" />
        </button>
      </div>
    </div>
  );
}
