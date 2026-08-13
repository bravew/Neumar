import { useCallback, useEffect, useState } from 'react';

import { AlertTriangle, Loader2, Server } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  compareSemver,
  getJson,
  getServerVersion,
  IMMICH_SAFE_VERSION,
  patchJson,
  postJson,
  requestConnectionTest,
  stringValue,
  type TestResult,
} from './personalMediaConnectDialogUtils';
import { PersonalMediaConnectionFields } from './PersonalMediaConnectionFields';
import type {
  CloudStorageConnection,
  PersonalMediaConnectionDetails,
} from './types';

interface PersonalMediaConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (connection: CloudStorageConnection) => void;
  connection?: CloudStorageConnection | null;
  onUpdated?: (connection: CloudStorageConnection) => void;
}

export function PersonalMediaConnectDialog({
  open,
  onOpenChange,
  onCreated,
  connection,
  onUpdated,
}: PersonalMediaConnectDialogProps) {
  const { t } = useLanguage();
  const s = t.cloudStorage;
  const editingConnectionId = connection?.id ?? '';
  const isEditing = editingConnectionId !== '';
  const [provider, setProvider] = useState<'immich' | 'photoprism'>('immich');
  const [displayName, setDisplayName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [initialBaseUrl, setInitialBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const serverVersion = getServerVersion(testResult);
  const baseUrlChanged = isEditing && baseUrl.trim() !== initialBaseUrl.trim();
  const saveDisabled =
    busy ||
    detailsLoading ||
    baseUrl.trim() === '' ||
    (!isEditing && apiKey.trim() === '') ||
    (baseUrlChanged && apiKey.trim() === '');
  const showImmichVersionWarning =
    provider === 'immich' &&
    testResult?.ok === true &&
    serverVersion !== undefined &&
    compareSemver(serverVersion, IMMICH_SAFE_VERSION) < 0;

  useEffect(() => {
    if (!open) return;

    setError('');
    setTestResult(null);
    setApiKey('');
    if (!editingConnectionId) {
      setProvider('immich');
      setDisplayName('');
      setBaseUrl('');
      setInitialBaseUrl('');
      setDetailsLoading(false);
      return;
    }

    setProvider(
      connection?.provider === 'photoprism' ? 'photoprism' : 'immich',
    );
    setDisplayName(connection?.displayName ?? '');
    setBaseUrl('');
    setInitialBaseUrl('');
    setDetailsLoading(true);
    const ctrl = new AbortController();
    let active = true;

    getJson<{ item?: PersonalMediaConnectionDetails }>(
      `/connections/${encodeURIComponent(editingConnectionId)}`,
      ctrl.signal,
    )
      .then((body) => {
        if (!active) return;
        const details = body.item;
        if (!details) throw new Error(s.connectionLoadError);
        const loadedBaseUrl = details.credential?.baseUrl ?? '';
        setProvider(
          details.provider === 'photoprism' ? 'photoprism' : 'immich',
        );
        setDisplayName(details.displayName ?? '');
        setBaseUrl(loadedBaseUrl);
        setInitialBaseUrl(loadedBaseUrl);
      })
      .catch((err) => {
        if (active && (err as { name?: string }).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : s.connectionLoadError);
        }
      })
      .finally(() => {
        if (active) setDetailsLoading(false);
      });

    return () => {
      active = false;
      ctrl.abort();
    };
  }, [
    connection?.displayName,
    connection?.provider,
    editingConnectionId,
    open,
    s.connectionLoadError,
  ]);

  const testConnection = useCallback(async (): Promise<TestResult | null> => {
    setBusy(true);
    setError('');
    setTestResult(null);
    try {
      const result = await requestConnectionTest(provider, baseUrl, apiKey);
      setTestResult(result);
      if (!result.ok) {
        // Don't surface machine error codes (e.g. `lan_url_requires_explicit_opt_in`)
        // directly — show a localized message instead.
        setError(s.connectionTestFailed);
        return null;
      }
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : s.connectionTestFailed);
      return null;
    } finally {
      setBusy(false);
    }
  }, [apiKey, baseUrl, provider, s.connectionTestFailed]);

  const saveConnection = useCallback(async () => {
    setBusy(true);
    setError('');
    setTestResult(null);
    try {
      if (baseUrlChanged && apiKey.trim() === '') {
        setError(s.apiKeyRequiredForUrlChange);
        return;
      }

      let serverInfo: Record<string, unknown> = {};
      if (!isEditing || apiKey.trim() !== '') {
        const result = await requestConnectionTest(provider, baseUrl, apiKey);
        setTestResult(result);
        if (!result.ok) {
          // Don't surface machine error codes (e.g. `lan_url_requires_explicit_opt_in`)
          // directly — show a localized message instead.
          setError(s.connectionTestFailed);
          return;
        }
        serverInfo = result.serverInfo ?? {};
      }

      if (isEditing) {
        const body = await patchJson<{ item: CloudStorageConnection }>(
          `/connections/${encodeURIComponent(editingConnectionId)}`,
          {
            displayName: displayName.trim() || undefined,
            credential: {
              baseUrl,
              apiKey: apiKey.trim() || undefined,
              serverVersion: stringValue(
                serverInfo.serverVersion ?? serverInfo.version,
              ),
              serverInstanceId: stringValue(serverInfo.serverInstanceId),
              userId: stringValue(serverInfo.userId),
            },
          },
        );
        onUpdated?.(body.item);
      } else {
        const body = await postJson<{ item: CloudStorageConnection }>(
          '/connections',
          {
            provider,
            kind: 'personal-media',
            displayName: displayName.trim() || undefined,
            credential: {
              baseUrl,
              apiKey,
              serverVersion: stringValue(
                serverInfo.serverVersion ?? serverInfo.version,
              ),
              serverInstanceId: stringValue(serverInfo.serverInstanceId),
              userId: stringValue(serverInfo.userId),
            },
          },
        );
        onCreated(body.item);
      }

      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isEditing
            ? s.connectionUpdateError
            : s.connectionCreateError,
      );
    } finally {
      setBusy(false);
    }
  }, [
    apiKey,
    baseUrl,
    baseUrlChanged,
    displayName,
    editingConnectionId,
    isEditing,
    onCreated,
    onOpenChange,
    onUpdated,
    provider,
    s.apiKeyRequiredForUrlChange,
    s.connectionCreateError,
    s.connectionTestFailed,
    s.connectionUpdateError,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? s.editConnection : s.selfHostedMediaTitle}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? s.editSelfHostedMediaDescription
              : s.selfHostedMediaDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <PersonalMediaConnectionFields
            provider={provider}
            setProvider={setProvider}
            displayName={displayName}
            setDisplayName={setDisplayName}
            baseUrl={baseUrl}
            setBaseUrl={setBaseUrl}
            apiKey={apiKey}
            setApiKey={setApiKey}
            isEditing={isEditing}
            detailsLoading={detailsLoading}
            s={s}
          />

          {testResult?.ok && (
            <p className="flex items-center gap-2 text-sm text-emerald-600">
              <Server className="size-4" />
              {s.connectionTestPassed}
            </p>
          )}
          {showImmichVersionWarning && (
            <p className="text-warning-foreground bg-warning/10 border-warning/30 flex items-start gap-2 rounded-md border p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {s.immichVersionWarning.replace('{version}', serverVersion)}
              </span>
            </p>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {s.cancel}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={
              busy ||
              detailsLoading ||
              baseUrl.trim() === '' ||
              apiKey.trim() === ''
            }
            onClick={testConnection}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {s.testConnection}
          </Button>
          <Button
            type="button"
            disabled={saveDisabled}
            onClick={saveConnection}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {isEditing ? s.updateConnection : s.createConnection}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
