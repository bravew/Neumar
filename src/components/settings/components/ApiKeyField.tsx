/**
 * ApiKeyField — write-only API key input.
 *
 * Security rules:
 * - The real key is NEVER displayed.
 * - When a key is already set, shows "•••••••{last4}" (read-only badge).
 * - Clicking "Change" switches to a blank password input so the user can
 *   enter a new key. "Cancel" reverts to the masked display.
 * - No "reveal" toggle exists anywhere.
 */

import { useState } from 'react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface ApiKeyFieldProps {
  /** Current key value (from vault). Used only to derive the mask. */
  value: string;
  onChange: (newKey: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  changeLabel?: string;
  cancelLabel?: string;
  saveLabel?: string;
}

/** Returns "•••••••XXXX" for a set key, empty string otherwise. */
export function maskApiKey(key: string): string {
  if (!key) return '';
  return `•••••••${key.slice(-4)}`;
}

export function ApiKeyField({
  value,
  onChange,
  placeholder = 'Enter API key…',
  id,
  className,
  changeLabel,
  cancelLabel,
  saveLabel,
}: ApiKeyFieldProps) {
  const { t } = useLanguage();
  const changeText = changeLabel ?? t.settings.apiKeyChange;
  const cancelText = cancelLabel ?? t.settings.apiKeyCancel;
  const saveText = saveLabel ?? t.settings.apiKeySave;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const hasKey = !!value;

  // Commit the new key and exit edit mode
  const commit = (newKey: string) => {
    if (newKey) onChange(newKey);
    setDraft('');
    setEditing(false);
  };

  if (hasKey && !editing) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <input
          readOnly
          type="text"
          value={maskApiKey(value)}
          className="border-input bg-muted text-muted-foreground h-10 flex-1 cursor-default rounded-lg border px-3 font-mono text-sm select-none"
          aria-label="API key set"
        />
        <button
          type="button"
          onClick={() => {
            setDraft('');
            setEditing(true);
          }}
          className="text-primary hover:text-primary/80 shrink-0 text-sm font-medium"
        >
          {changeText}
        </button>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <input
        id={id}
        type="password"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(draft);
          if (e.key === 'Escape' && hasKey) {
            setDraft('');
            setEditing(false);
          }
        }}
        placeholder={placeholder}
        autoComplete="new-password"
        className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 flex-1 rounded-lg border px-3 font-mono text-sm focus:ring-2 focus:outline-none"
        autoFocus={editing} // safe: triggered only by explicit user action (clicking "Change")
      />
      {draft && (
        <button
          type="button"
          onClick={() => commit(draft)}
          className="text-primary hover:text-primary/80 shrink-0 text-sm font-medium"
        >
          {saveText}
        </button>
      )}
      {hasKey && editing && (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            setEditing(false);
          }}
          className="text-muted-foreground hover:text-foreground shrink-0 text-sm"
        >
          {cancelText}
        </button>
      )}
    </div>
  );
}
