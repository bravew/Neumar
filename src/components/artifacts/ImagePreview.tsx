import { Eye, FileText } from 'lucide-react';

import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import { usePreviewUrl } from '@/shared/hooks/usePreviewUrl';

import { FileTooLarge } from './FileTooLarge';
import type { PreviewComponentProps } from './types';
import { MAX_PREVIEW_SIZE, openFileExternal } from './utils';

export function ImagePreview({ artifact }: PreviewComponentProps) {
  const {
    url: imageUrl,
    loading,
    error,
    fileTooLarge,
  } = usePreviewUrl(
    { path: artifact.path, content: artifact.content },
    { maxSize: MAX_PREVIEW_SIZE },
  );

  const handleOpenExternal = () => {
    if (artifact.path) {
      openFileExternal(artifact.path);
    }
  };

  if (loading) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <AILoadingIndicator size="md" />
        <p className="text-muted-foreground mt-4 text-sm">Loading image...</p>
      </div>
    );
  }

  if (fileTooLarge !== null) {
    return (
      <FileTooLarge
        artifact={artifact}
        fileSize={fileTooLarge}
        icon={Eye}
        onOpenExternal={handleOpenExternal}
      />
    );
  }

  if (error || !imageUrl) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="border-border bg-background mb-4 flex size-20 items-center justify-center rounded-xl border">
            <FileText className="size-10 text-red-500" />
          </div>
          <h3 className="text-foreground mb-2 text-lg font-medium">
            {artifact.name}
          </h3>
          <p className="text-muted-foreground text-sm break-all whitespace-pre-wrap">
            {error || 'No image file path available'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-muted/20 flex h-full items-center justify-center p-4">
      <img
        src={imageUrl}
        alt={artifact.name}
        className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
      />
    </div>
  );
}
