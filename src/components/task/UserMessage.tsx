import { Reply } from 'lucide-react';
import { motion } from 'motion/react';

import { DURATION, EASE } from '@/config/animation';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { useLanguage } from '@/shared/providers/language-provider';

import { LazyImage } from '../shared/LazyImage';
import { FileTypeIcon } from '../ui/FileTypeIcon';

/**
 * Parse "Question: Answer" lines into structured Q&A pairs.
 */
function parseQAPairs(
  text: string,
): { question: string; answer: string }[] | null {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return null;

  const pairs: { question: string; answer: string }[] = [];
  for (const line of lines) {
    // Match "Question text?: Answer text"
    const sepIdx = line.indexOf(' → ');
    if (sepIdx > 0) {
      pairs.push({
        question: line.slice(0, sepIdx).replace(/\?$/, '').trim(),
        answer: line.slice(sepIdx + 3).trim(),
      });
    }
  }
  return pairs.length > 0 ? pairs : null;
}

export function UserMessage({
  content,
  attachments,
  subtype,
}: {
  content: string;
  attachments?: MessageAttachment[];
  subtype?: string;
}) {
  const { t } = useLanguage();

  // Filter out attachments with no data to prevent hanging
  const validAttachments = attachments?.filter((a) => {
    // For images, require actual data
    if (a.type === 'image') {
      return !!a.data && a.data.length > 0;
    }
    // For other types, just check if attachment exists
    return true;
  });

  const imageAttachments = validAttachments?.filter((a) => a.type === 'image');
  const fileAttachments = validAttachments?.filter((a) => a.type !== 'image');
  const hasImages = imageAttachments && imageAttachments.length > 0;

  const isAnswer = subtype === 'question_answer';
  const qaPairs = isAnswer ? parseQAPairs(content) : null;

  return (
    <motion.div
      className="flex min-w-0 gap-3"
      initial={{ opacity: 0, y: 8, x: 8 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ duration: DURATION.normal, ease: EASE.out }}
    >
      <div className="min-w-0 flex-1"></div>
      <div className="bg-user-message text-user-message-foreground max-w-[85%] min-w-0 overflow-hidden rounded-xl">
        {/* Images — horizontal flex layout with constrained thumbnails */}
        {hasImages && (
          <div
            className={
              imageAttachments.length === 1
                ? 'flex justify-end p-1.5'
                : 'flex flex-wrap justify-end gap-1 p-1.5'
            }
          >
            {imageAttachments.map((attachment) => (
              <LazyImage
                key={attachment.id}
                src={attachment.data}
                alt={attachment.name}
                className={
                  imageAttachments.length === 1
                    ? 'max-h-48 w-full rounded-lg object-contain'
                    : 'max-h-36 rounded-lg object-cover'
                }
                isDataLoading={attachment.isLoading}
              />
            ))}
          </div>
        )}
        {/* File attachments */}
        {fileAttachments && fileAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {fileAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className="bg-muted flex items-center gap-2 rounded-lg px-3 py-2"
                aria-label={`File attachment: ${attachment.name}`}
              >
                <FileTypeIcon
                  filename={attachment.name}
                  mimeType={attachment.mimeType}
                  className="text-muted-foreground size-4"
                />
                <span className="text-foreground text-sm">
                  {attachment.name}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Text content */}
        {content &&
          (isAnswer && qaPairs ? (
            <div className="px-4 py-3">
              <div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs">
                <Reply className="size-3" />
                <span>{t.task.answeredQuestion}</span>
              </div>
              <div className="space-y-1.5">
                {qaPairs.map((pair) => (
                  <div key={pair.question} className="text-sm">
                    <span className="text-muted-foreground">
                      {pair.question}:
                    </span>{' '}
                    <span className="text-foreground font-medium">
                      {pair.answer}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-foreground px-4 py-3 text-sm break-words whitespace-pre-wrap">
              {content}
            </p>
          ))}
      </div>
    </motion.div>
  );
}
