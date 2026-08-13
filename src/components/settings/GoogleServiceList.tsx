/**
 * Google Workspace Service List
 *
 * Renders the expandable list of Google Workspace services with checkboxes
 * for enabling/disabling individual service scopes.
 */

import { useMemo } from 'react';

import { ChevronDown, ExternalLink, Loader2, Shield } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { GOOGLE_SERVICES } from './google-workspace-constants';

interface GoogleServiceListProps {
  expanded: boolean;
  onToggleExpanded: () => void;
  grantedServices: Set<string>;
  isChecked: (serviceId: string) => boolean;
  allChecked: boolean;
  toggleAll: () => void;
  toggleService: (serviceId: string) => void;
  pendingCount: number;
  pendingToRemoveCount: number;
  authorizing: boolean;
  onAuthorize: () => void;
}

export function GoogleServiceList({
  expanded,
  onToggleExpanded,
  grantedServices,
  isChecked,
  allChecked,
  toggleAll,
  toggleService,
  pendingCount,
  pendingToRemoveCount,
  authorizing,
  onAuthorize,
}: GoogleServiceListProps) {
  const { t } = useLanguage();

  const googleServiceMeta = useMemo<
    Record<string, { label: string; description: string }>
  >(
    () => ({
      gmail: {
        label: t.settings.serviceGmail,
        description: t.settings.serviceGmailDescription,
      },
      calendar: {
        label: t.settings.serviceCalendar,
        description: t.settings.serviceCalendarDescription,
      },
      drive: {
        label: t.settings.serviceDrive,
        description: t.settings.serviceDriveDescription,
      },
      photos: {
        label: t.settings.servicePhotos,
        description: t.settings.servicePhotosDescription,
      },
      meet: {
        label: t.settings.serviceMeet,
        description: t.settings.serviceMeetDescription,
      },
      docs: {
        label: t.settings.serviceDocs,
        description: t.settings.serviceDocsDescription,
      },
      sheets: {
        label: t.settings.serviceSheets,
        description: t.settings.serviceSheetsDescription,
      },
      contacts: {
        label: t.settings.serviceContacts,
        description: t.settings.serviceContactsDescription,
      },
      directory: {
        label: t.settings.serviceDirectory,
        description: t.settings.serviceDirectoryDescription,
      },
    }),
    [t],
  );

  return (
    <div className="space-y-2">
      <div className="border-border rounded-lg border">
        {/* Header with Select All + collapse toggle */}
        <button
          onClick={onToggleExpanded}
          className="border-border/50 flex w-full cursor-pointer items-center gap-3 border-b px-4 py-3 text-left"
          aria-expanded={expanded}
          aria-label={t.settings.toggleServicesList}
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              toggleAll();
            }}
          >
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              onClick={(e) => e.stopPropagation()}
              className="border-border bg-background accent-primary size-4 shrink-0 cursor-pointer rounded"
              aria-label={t.settings.selectAll}
            />
          </div>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg text-blue-500">
            <Shield className="size-4" />
          </div>
          <div className="flex-1">
            <p className="text-foreground text-sm font-medium">
              {t.settings.googleWorkspaceServices}
            </p>
            <p className="text-muted-foreground text-xs">
              {t.settings.googleWorkspaceServicesDescription}
            </p>
          </div>
          <ChevronDown
            className={cn(
              'text-muted-foreground size-4 shrink-0 transition-transform duration-200',
              expanded && 'rotate-180',
            )}
          />
        </button>
        {/* Service rows */}
        {expanded && (
          <div className="divide-border/50 divide-y px-4">
            {GOOGLE_SERVICES.map((service) => {
              const isGranted = grantedServices.has(service.id);
              const checked = isChecked(service.id);
              const isDeselected = isGranted && !checked;
              const meta = googleServiceMeta[service.id];
              return (
                <label
                  key={service.id}
                  className="flex cursor-pointer items-center gap-3 py-2.5 select-none"
                  aria-label={`${checked ? (isGranted ? t.settings.authorized : t.settings.serviceSelected) : t.settings.serviceSelect}: ${meta?.label}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleService(service.id)}
                    className="border-border bg-background accent-primary size-4 shrink-0 cursor-pointer rounded"
                  />
                  <div className="flex-1">
                    <span className="text-foreground text-sm">
                      {meta?.label}
                    </span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {meta?.description}
                    </span>
                  </div>
                  {isGranted && checked && (
                    <span className="text-[10px] font-medium text-green-600 dark:text-green-400">
                      {t.settings.authorized}
                    </span>
                  )}
                  {isDeselected && (
                    <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      {t.settings.removeAccess}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>
      {/* Action button — shown when there are pending changes */}
      {pendingCount > 0 && (
        <div className="border-border/50 border-t px-4 py-3">
          <button
            onClick={onAuthorize}
            disabled={authorizing}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            aria-label={`${pendingToRemoveCount > 0 ? t.settings.reauthorize : t.settings.authorizeSelected} (${pendingCount})`}
          >
            {authorizing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ExternalLink className="size-3.5" />
            )}
            {authorizing
              ? t.settings.authorizing
              : pendingToRemoveCount > 0
                ? `${t.settings.reauthorize} (${pendingCount})`
                : `${t.settings.authorizeSelected} (${pendingCount})`}
          </button>
        </div>
      )}
    </div>
  );
}
