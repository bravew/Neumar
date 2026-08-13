import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Artifact } from '@/components/artifacts/types';
import type { MediaVersion } from '@/components/workspace/types';
import {
  getMediaVersionsByTaskId,
  saveMediaVersion,
} from '@/shared/db/database';
import type { MediaVersionRecord } from '@/shared/db/types';
import type { AgentMessage } from '@/shared/hooks/useAgent';

// Partitioned extension sets — single source of truth for media type detection
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
]);
const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'mov',
  'avi',
  'mkv',
  'wmv',
  'flv',
]);
const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'flac',
  'ogg',
  'aac',
  'm4a',
  'wma',
]);

function getMediaType(path: string): 'image' | 'video' | 'audio' | null {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return null;
}

function isMediaArtifact(artifact: Artifact): boolean {
  if (['image', 'video', 'audio'].includes(artifact.type)) return true;
  if (artifact.path) {
    return getMediaType(artifact.path) !== null;
  }
  return false;
}

function toMediaVersion(record: MediaVersionRecord): MediaVersion {
  return {
    id: record.id,
    taskId: record.task_id,
    artifactId: record.artifact_id,
    versionNumber: record.version_number,
    path: record.path,
    prompt: record.prompt,
    previousVersionId: record.previous_version_id || undefined,
    type: record.type as 'image' | 'video' | 'audio',
    createdAt: record.created_at,
  };
}

function toRecord(version: MediaVersion): MediaVersionRecord {
  return {
    id: version.id,
    task_id: version.taskId,
    artifact_id: version.artifactId,
    version_number: version.versionNumber,
    path: version.path,
    prompt: version.prompt,
    previous_version_id: version.previousVersionId || null,
    type: version.type,
    created_at: version.createdAt,
  };
}

export function useMediaVersions(
  taskId: string,
  messages: AgentMessage[],
  artifacts: Artifact[],
): {
  versions: MediaVersion[];
  getVersionsForArtifact: (artifactId: string) => MediaVersion[];
  currentVersion: MediaVersion | null;
  selectVersion: (version: MediaVersion) => void;
} {
  const [versions, setVersions] = useState<MediaVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  // Ref to read current versions without adding to effect deps (avoids circular dependency)
  const versionsRef = useRef<MediaVersion[]>([]);
  const processedCountRef = useRef(0);

  // Keep ref in sync with state
  useEffect(() => {
    versionsRef.current = versions;
  }, [versions]);

  // Reset state and load persisted versions whenever taskId changes.
  // Combined into a single effect to avoid a race condition where separate
  // reset/load effects on [taskId] would run in the wrong order (load skips
  // because a stale guard ref is still true, then reset clears it too late).
  useEffect(() => {
    // Reset
    processedCountRef.current = 0;
    setVersions([]);
    setSelectedVersionId(null);

    if (!taskId) return;

    let cancelled = false;

    getMediaVersionsByTaskId(taskId)
      .then((records) => {
        if (cancelled) return;
        if (records.length > 0) {
          const loaded = records.map(toMediaVersion);
          setVersions(loaded);
          processedCountRef.current = loaded.length;
        }
      })
      .catch((err) => {
        console.error('[useMediaVersions] Failed to load versions:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Derive versions from messages and artifacts
  // NOTE: `versions` is intentionally NOT in the dependency array.
  // We read current versions via versionsRef to avoid a circular dependency
  // (effect modifies versions → versions changes → effect re-runs).
  useEffect(() => {
    if (!taskId || artifacts.length === 0) return;

    // Only process new artifacts we haven't seen
    const mediaArtifacts = artifacts.filter(isMediaArtifact);
    if (mediaArtifacts.length === 0) return;
    if (mediaArtifacts.length <= processedCountRef.current) return;

    // Deduplicate by file basename — multiple DB/message sources can reference
    // the same output file. Keep the last occurrence (typically the final path).
    const seenBasenames = new Map<string, Artifact>();
    for (const artifact of mediaArtifacts) {
      const path = artifact.path || artifact.id;
      const basename = path.split('/').pop() || path;
      seenBasenames.set(basename, artifact);
    }
    const dedupedArtifacts = Array.from(seenBasenames.values());

    const currentVersions = versionsRef.current;

    // Build version chain from deduplicated artifacts
    const newVersions: MediaVersion[] = [];
    let versionNumber = 1;

    for (const artifact of dedupedArtifacts) {
      const path = artifact.path || artifact.id;
      const mediaType = getMediaType(path);
      if (!mediaType) continue;

      // Check if we already have a version for this artifact
      const existing = currentVersions.find(
        (v) => v.artifactId === artifact.id,
      );
      if (existing) {
        newVersions.push(existing);
        versionNumber = existing.versionNumber + 1;
        continue;
      }

      // Find the user message that prompted this artifact (temporal proximity)
      const artifactIndex = messages.findIndex(
        (m) =>
          m.type === 'tool_use' &&
          m.name === 'Write' &&
          (m.input as Record<string, unknown> | undefined)?.file_path === path,
      );

      let prompt = '';
      if (artifactIndex >= 0) {
        // Find the most recent user message before this tool_use
        for (let i = artifactIndex - 1; i >= 0; i--) {
          if (messages[i].type === 'user') {
            prompt = messages[i].content || '';
            break;
          }
        }
      } else {
        // Fallback: use the last user message
        const userMessages = messages.filter((m) => m.type === 'user');
        if (userMessages.length > 0) {
          prompt = userMessages[userMessages.length - 1]?.content || '';
        }
      }

      const previousVersion =
        newVersions.length > 0
          ? newVersions[newVersions.length - 1]
          : undefined;

      const version: MediaVersion = {
        id: `mv-${taskId}-${artifact.id}-${versionNumber}`,
        taskId,
        artifactId: artifact.id,
        versionNumber,
        path,
        prompt,
        previousVersionId: previousVersion?.id,
        type: mediaType,
        createdAt: new Date().toISOString(),
      };

      newVersions.push(version);
      versionNumber++;

      // Persist to database
      saveMediaVersion(toRecord(version)).catch((err) => {
        console.error('[useMediaVersions] Failed to save version:', err);
      });
    }

    if (newVersions.length > 0) {
      processedCountRef.current = mediaArtifacts.length;
      setVersions(newVersions);
    }
  }, [taskId, artifacts, messages]);

  const getVersionsForArtifact = useCallback(
    (artifactId: string) => {
      // Get the version chain that includes this artifact
      const targetVersion = versions.find((v) => v.artifactId === artifactId);
      if (!targetVersion) return [];

      // Return all versions of the same media type in this task
      return versions.filter((v) => v.type === targetVersion.type);
    },
    [versions],
  );

  const currentVersion = useMemo(() => {
    if (selectedVersionId) {
      return versions.find((v) => v.id === selectedVersionId) || null;
    }
    return versions.length > 0 ? versions[versions.length - 1] : null;
  }, [versions, selectedVersionId]);

  const selectVersion = useCallback((version: MediaVersion) => {
    setSelectedVersionId(version.id);
  }, []);

  return {
    versions,
    getVersionsForArtifact,
    currentVersion,
    selectVersion,
  };
}
