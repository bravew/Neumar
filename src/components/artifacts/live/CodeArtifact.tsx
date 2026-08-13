import { Streamdown } from 'streamdown';

import { STREAMDOWN_CODE_PLUGINS } from '@/shared/lib/streamdown-plugins';
import { cn } from '@/shared/lib/utils';

interface CodeArtifactProps {
  source: string;
  language?: string;
  className?: string;
}

export function CodeArtifact({
  source,
  language,
  className,
}: CodeArtifactProps) {
  const fenced = '```' + (language ?? '') + '\n' + source + '\n```';
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none overflow-auto px-4 py-3',
        className,
      )}
    >
      <Streamdown plugins={STREAMDOWN_CODE_PLUGINS}>{fenced}</Streamdown>
    </div>
  );
}
