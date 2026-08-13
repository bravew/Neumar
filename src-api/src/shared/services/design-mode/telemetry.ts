import { getSetting } from '@/shared/db/operations';

import { redactDesignTelemetryPayload } from './redact';

export interface DesignTelemetrySettings {
  enabled: boolean;
  sendIdentity: boolean;
  sendAssistantText: boolean;
  sendArtifactManifests: boolean;
  categories: {
    runs: boolean;
    schedules: boolean;
    errors: boolean;
  };
}

export interface DesignTelemetryEvent {
  type: string;
  at: string;
  payload: unknown;
}

export interface DesignTelemetrySink {
  send(event: DesignTelemetryEvent): Promise<void>;
  test?(): Promise<{ ok: boolean; message?: string }>;
}

export interface ArtifactManifestItem {
  path: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
}

const DEFAULT_TELEMETRY: DesignTelemetrySettings = {
  enabled: false,
  sendIdentity: false,
  sendAssistantText: false,
  sendArtifactManifests: false,
  categories: {
    runs: true,
    schedules: true,
    errors: true,
  },
};

let sink: DesignTelemetrySink | null = null;

export function setDesignTelemetrySink(next: DesignTelemetrySink | null): void {
  sink = next;
}

export function getDesignTelemetrySink(): DesignTelemetrySink | null {
  return sink;
}

export function getDesignTelemetrySettings(): DesignTelemetrySettings {
  const raw = getSetting('designMode');
  if (!raw) return DEFAULT_TELEMETRY;
  try {
    const parsed = JSON.parse(raw) as {
      telemetry?: Partial<DesignTelemetrySettings>;
    };
    return normalizeTelemetrySettings(parsed.telemetry);
  } catch {
    return DEFAULT_TELEMETRY;
  }
}

export function getDesignTelemetryStatus(): {
  enabled: boolean;
  sinkConfigured: boolean;
  categories: DesignTelemetrySettings['categories'];
  assistantText: boolean;
  artifactManifests: boolean;
  identity: boolean;
} {
  const settings = getDesignTelemetrySettings();
  return {
    enabled: settings.enabled,
    sinkConfigured: sink !== null,
    categories: settings.categories,
    assistantText: settings.sendAssistantText,
    artifactManifests: settings.sendArtifactManifests,
    identity: settings.sendIdentity,
  };
}

export async function emitDesignTelemetry(
  type: string,
  payload: unknown,
  category: keyof DesignTelemetrySettings['categories'],
): Promise<void> {
  const settings = getDesignTelemetrySettings();
  if (!settings.enabled || !settings.categories[category] || !sink) {
    return;
  }
  const redacted = redactDesignTelemetryPayload(payload, {
    sendIdentity: settings.sendIdentity,
    workspaceRoot: getSetting('workDir') ?? undefined,
  });
  await sink.send({ type, at: new Date().toISOString(), payload: redacted });
}

export function summarizeArtifactManifest(
  items: ArtifactManifestItem[],
  settings = getDesignTelemetrySettings(),
): ArtifactManifestItem[] {
  if (!settings.sendArtifactManifests) return [];
  return items.map((item) => ({
    path: item.path,
    byteLength: item.byteLength,
    sha256: item.sha256,
    mediaType: item.mediaType,
  }));
}

function normalizeTelemetrySettings(
  input: Partial<DesignTelemetrySettings> | undefined,
): DesignTelemetrySettings {
  return {
    enabled: input?.enabled === true,
    sendIdentity: input?.sendIdentity === true,
    sendAssistantText: input?.sendAssistantText === true,
    sendArtifactManifests: input?.sendArtifactManifests === true,
    categories: {
      runs: input?.categories?.runs !== false,
      schedules: input?.categories?.schedules !== false,
      errors: input?.categories?.errors !== false,
    },
  };
}
