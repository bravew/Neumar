import { useCallback, useRef, useState } from 'react';

import {
  Bug,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  MessageSquare,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { API_BASE_URL, APP_NAME } from '@/config';
import { branding } from '@/config/branding';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

type FeedbackCategory = 'bug' | 'feature' | 'feedback' | 'question';

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_ICONS = {
  bug: Bug,
  feature: Lightbulb,
  feedback: MessageSquare,
  question: HelpCircle,
} as const;

const CATEGORY_COLORS = {
  bug: 'text-red-500 bg-red-500/10 border-red-500/20',
  feature: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  feedback: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  question: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
} as const;

const FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  'bug',
  'feature',
  'feedback',
  'question',
];

const SUBJECT_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 5000;

const INPUT_CLASS =
  'border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none';
const TEXTAREA_CLASS =
  'border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring w-full resize-none rounded-lg border p-3 text-sm focus:ring-2 focus:outline-none';

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const { t } = useLanguage();
  const fb = t.common.feedback;

  const [category, setCategory] = useState<FeedbackCategory>('feedback');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<
    'idle' | 'submitting' | 'success' | 'error'
  >('idle');
  const abortRef = useRef<AbortController | null>(null);
  const descriptionPlaceholders: Record<FeedbackCategory, string> = {
    bug: fb.descriptionPlaceholderBug,
    feature: fb.descriptionPlaceholderFeature,
    feedback: fb.descriptionPlaceholderFeedback,
    question: fb.descriptionPlaceholderQuestion,
  };

  const getCategoryLabel = useCallback(
    (cat: FeedbackCategory): string => {
      const labels: Record<FeedbackCategory, string> = {
        bug: fb.categoryBugReport,
        feature: fb.categoryFeatureRequest,
        feedback: fb.categoryGeneralFeedback,
        question: fb.categoryQuestion,
      };
      return labels[cat];
    },
    [
      fb.categoryBugReport,
      fb.categoryFeatureRequest,
      fb.categoryGeneralFeedback,
      fb.categoryQuestion,
    ],
  );

  const resetForm = useCallback(() => {
    setCategory('feedback');
    setSubject('');
    setDescription('');
    setEmail('');
    setStatus('idle');
  }, []);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        abortRef.current?.abort();
        abortRef.current = null;
        resetForm();
      }
      onOpenChange(isOpen);
    },
    [onOpenChange, resetForm],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!subject.trim() || !description.trim()) return;

      setStatus('submitting');

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(`${API_BASE_URL}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            category,
            subject: subject.trim(),
            description: description.trim(),
            email: email.trim() || undefined,
            appName: APP_NAME,
            appVersion:
              document
                .querySelector('meta[name="version"]')
                ?.getAttribute('content') ?? 'unknown',
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        setStatus('success');
      } catch {
        if (controller.signal.aborted) return;
        // Fall back to mailto if API is unavailable
        const label = getCategoryLabel(category);
        const mailSubject = encodeURIComponent(`[${label}] ${subject.trim()}`);
        const mailBody = encodeURIComponent(
          `Category: ${label}\n\n${description.trim()}${email.trim() ? `\n\nContact: ${email.trim()}` : ''}`,
        );
        const supportUrl = branding.urls.support;
        if (supportUrl.includes('@') || supportUrl.startsWith('mailto:')) {
          window.open(
            `mailto:${supportUrl.replace('mailto:', '')}?subject=${mailSubject}&body=${mailBody}`,
            '_blank',
          );
        } else {
          window.open(supportUrl, '_blank');
        }
        setStatus('error');
      }
    },
    [category, subject, description, email, getCategoryLabel],
  );

  if (status === 'success') {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle2 className="size-7 text-green-500" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold">{fb.successTitle}</h3>
              <p className="text-muted-foreground text-sm">
                {fb.successMessage}
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {t.common.close}
              </Button>
              <Button onClick={resetForm}>{fb.sendAnother}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{fb.title}</DialogTitle>
          <DialogDescription>{fb.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Category Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{fb.categoryLabel}</label>
            <div className="grid grid-cols-2 gap-2">
              {FEEDBACK_CATEGORIES.map((cat) => {
                const Icon = CATEGORY_ICONS[cat];
                const isSelected = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-all',
                      isSelected
                        ? CATEGORY_COLORS[cat]
                        : 'border-border hover:bg-accent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{getCategoryLabel(cat)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <label htmlFor="feedback-subject" className="text-sm font-medium">
              {fb.subjectLabel}
            </label>
            <input
              id="feedback-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={fb.subjectPlaceholder}
              className={INPUT_CLASS}
              maxLength={SUBJECT_MAX_LENGTH}
              required
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label
              htmlFor="feedback-description"
              className="text-sm font-medium"
            >
              {fb.descriptionLabel}
            </label>
            <textarea
              id="feedback-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={descriptionPlaceholders[category]}
              className={cn(TEXTAREA_CLASS, 'h-32')}
              maxLength={DESCRIPTION_MAX_LENGTH}
              required
            />
          </div>

          {/* Email */}
          <div className="space-y-2">
            <label htmlFor="feedback-email" className="text-sm font-medium">
              {fb.emailLabel}
            </label>
            <input
              id="feedback-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={fb.emailPlaceholder}
              className={INPUT_CLASS}
            />
          </div>

          {/* Error message */}
          {status === 'error' && (
            <p className="text-destructive text-sm">{fb.errorMessage}</p>
          )}

          {/* Footer */}
          <DialogFooter className="flex-row justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
            >
              {t.common.cancel}
            </Button>
            <Button
              type="submit"
              disabled={
                status === 'submitting' ||
                !subject.trim() ||
                !description.trim()
              }
            >
              {status === 'submitting' ? fb.submitting : fb.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
