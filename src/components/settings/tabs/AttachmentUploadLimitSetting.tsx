import {
  MAX_ATTACHMENT_UPLOAD_LIMIT_MB,
  MIN_ATTACHMENT_UPLOAD_LIMIT_MB,
} from '@/shared/db/settings';
import { useLanguage } from '@/shared/providers/language-provider';

import type { SettingsType } from '../types';

export function AttachmentUploadLimitSetting({
  settings,
  onSettingsChange,
}: {
  settings: SettingsType;
  onSettingsChange: (settings: SettingsType) => void;
}) {
  const { t } = useLanguage();

  return (
    <section
      className="flex flex-col gap-2"
      data-testid="attachment-upload-limit"
    >
      <label
        htmlFor="attachment-upload-limit-input"
        className="text-foreground text-sm font-medium"
      >
        {t.settings.attachmentUploadLimit}
      </label>
      <p className="text-muted-foreground text-xs">
        {t.settings.attachmentUploadLimitDescription}
      </p>
      <div className="flex items-center gap-2">
        <input
          id="attachment-upload-limit-input"
          type="number"
          min={MIN_ATTACHMENT_UPLOAD_LIMIT_MB}
          max={MAX_ATTACHMENT_UPLOAD_LIMIT_MB}
          value={settings.attachmentUploadLimitMb}
          onChange={(e) => {
            const value = Number.parseInt(e.target.value, 10);
            if (!Number.isFinite(value)) return;
            onSettingsChange({
              ...settings,
              attachmentUploadLimitMb: Math.max(
                MIN_ATTACHMENT_UPLOAD_LIMIT_MB,
                Math.min(MAX_ATTACHMENT_UPLOAD_LIMIT_MB, value),
              ),
            });
          }}
          className="border-input bg-background text-foreground focus:ring-ring h-10 w-40 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
        />
        <span className="text-muted-foreground text-sm">
          {t.settings.attachmentUploadLimitUnit}
        </span>
      </div>
    </section>
  );
}
