/**
 * Google Workspace Services Section
 *
 * Manages incremental OAuth scope authorization for Google Workspace services
 * (Gmail, Calendar, Drive, etc.). Shows checkboxes for each service and handles
 * adding/removing scopes via re-authorization flows.
 */

import { useEffect, useMemo, useState } from 'react';

import { ExternalLink, Info, Loader2, RefreshCw } from 'lucide-react';

import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { useAuth } from '@/shared/hooks/useAuth';
import { openExternalUrl } from '@/shared/lib/open-external-url';
import { useLanguage } from '@/shared/providers/language-provider';

import { GOOGLE_SERVICES } from './google-workspace-constants';
import { GoogleServiceList } from './GoogleServiceList';

const GOOGLE_API_KEY_URL = 'https://console.cloud.google.com/apis/credentials';

export function GoogleWorkspaceSection() {
  const { t } = useLanguage();
  const auth = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedServices, setSelectedServices] = useState<Set<string>>(
    new Set(),
  );
  const [deselectedGranted, setDeselectedGranted] = useState<Set<string>>(
    new Set(),
  );
  const [authorizing, setAuthorizing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const googleConnection = auth.getConnection('google');
  const isSignedIn = auth.isConnected('google');

  // Compute which services already have ALL their scopes granted.
  const grantedServices = useMemo<Set<string>>(() => {
    const granted = new Set<string>();
    if (!googleConnection?.scopes) return granted;
    for (const service of GOOGLE_SERVICES) {
      const hasAllScopes = service.scopes.every((s) =>
        googleConnection.scopes.includes(s),
      );
      if (hasAllScopes) granted.add(service.id);
    }
    return granted;
  }, [googleConnection?.scopes]);

  // Auto-clear pending selections when polling confirms the scope change.
  useEffect(() => {
    setSelectedServices((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const id of prev) {
        if (grantedServices.has(id)) next.delete(id);
      }
      return next.size === prev.size ? prev : next;
    });
    setDeselectedGranted((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const id of prev) {
        if (!grantedServices.has(id)) next.delete(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [grantedServices]);

  const isChecked = (serviceId: string) => {
    if (grantedServices.has(serviceId))
      return !deselectedGranted.has(serviceId);
    return selectedServices.has(serviceId);
  };

  const allChecked = GOOGLE_SERVICES.every((s) => isChecked(s.id));

  const pendingToAdd = useMemo(
    () =>
      GOOGLE_SERVICES.filter(
        (s) => !grantedServices.has(s.id) && selectedServices.has(s.id),
      ),
    [grantedServices, selectedServices],
  );

  const pendingToRemove = useMemo(
    () =>
      GOOGLE_SERVICES.filter(
        (s) => grantedServices.has(s.id) && deselectedGranted.has(s.id),
      ),
    [grantedServices, deselectedGranted],
  );

  const pendingCount = pendingToAdd.length + pendingToRemove.length;

  const toggleAll = () => {
    if (allChecked) {
      setSelectedServices(new Set());
      setDeselectedGranted(new Set(grantedServices));
    } else {
      setSelectedServices(
        new Set(
          GOOGLE_SERVICES.filter((s) => !grantedServices.has(s.id)).map(
            (s) => s.id,
          ),
        ),
      );
      setDeselectedGranted(new Set());
    }
  };

  const toggleService = (serviceId: string) => {
    if (grantedServices.has(serviceId)) {
      setDeselectedGranted((prev) => {
        const next = new Set(prev);
        if (next.has(serviceId)) next.delete(serviceId);
        else next.add(serviceId);
        return next;
      });
    } else {
      setSelectedServices((prev) => {
        const next = new Set(prev);
        if (next.has(serviceId)) next.delete(serviceId);
        else next.add(serviceId);
        return next;
      });
    }
  };

  const handleAuthorizeSelected = async () => {
    if (pendingCount === 0) return;
    setAuthorizing(true);
    try {
      if (pendingToRemove.length > 0) {
        const scopesToKeep = GOOGLE_SERVICES.filter((s) => {
          const kept =
            grantedServices.has(s.id) && !deselectedGranted.has(s.id);
          const added =
            !grantedServices.has(s.id) && selectedServices.has(s.id);
          return kept || added;
        }).flatMap((s) => [...s.scopes]);
        await auth.disconnect('google');
        if (scopesToKeep.length > 0) {
          await auth.connect('google', scopesToKeep);
        }
      } else {
        const allScopes = pendingToAdd.flatMap((s) => [...s.scopes]);
        await auth.requestScopes('google', allScopes);
      }
    } finally {
      setAuthorizing(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await auth.refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-foreground text-sm font-semibold">
            {t.settings.connectedServices}
          </h3>
          <p className="text-muted-foreground text-xs">
            {t.settings.connectedServicesDescription}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <a
            href={GOOGLE_API_KEY_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault();
              void openExternalUrl(GOOGLE_API_KEY_URL);
            }}
            className="border-border bg-background hover:bg-accent hover:text-accent-foreground inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors"
            aria-label={t.connectors.card.apiKeyLabel.replace(
              '{name}',
              t.settings.googleWorkspaceServices,
            )}
          >
            {t.connectors.card.apiKeyButton}
            <ExternalLink className="size-3" />
          </a>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
            aria-label={t.settings.refresh}
          >
            {refreshing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            {t.settings.refresh}
          </button>
        </div>
      </div>

      {auth.loading ? (
        <div className="border-border flex items-center justify-center rounded-lg border p-8">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : isSignedIn ? (
        <GoogleServiceList
          expanded={expanded}
          onToggleExpanded={() => setExpanded((v) => !v)}
          grantedServices={grantedServices}
          isChecked={isChecked}
          allChecked={allChecked}
          toggleAll={toggleAll}
          toggleService={toggleService}
          pendingCount={pendingCount}
          pendingToRemoveCount={pendingToRemove.length}
          authorizing={authorizing}
          onAuthorize={handleAuthorizeSelected}
        />
      ) : (
        <div className="border-border rounded-lg border p-4">
          {auth.availableProviders.includes('google') ? (
            <>
              <p className="text-muted-foreground mb-3 text-xs">
                {t.settings.googleSignInPrompt}
              </p>
              <GoogleSignInButton onSignIn={() => auth.connect('google')} />
            </>
          ) : (
            <div className="flex items-start gap-2">
              <Info className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
              <p className="text-muted-foreground text-xs">
                {t.settings.googleNotConfigured}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
