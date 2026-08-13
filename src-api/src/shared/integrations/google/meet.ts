/**
 * Google Meet Integration
 *
 * Provides Meet REST API v2 operations using the user's OAuth tokens.
 * Requires the meetings.space.created and/or meetings.space.readonly scopes.
 */

import { GOOGLE_MEET_SCOPES } from '@/config/oauth';

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('MeetIntegration');

const MEET_API_BASE = 'https://meet.googleapis.com/v2';

/** Required scopes for Meet operations */
export const REQUIRED_SCOPES = GOOGLE_MEET_SCOPES;

// ============================================================================
// Types
// ============================================================================

export interface MeetSpace {
  name: string;
  meetingUri: string;
  meetingCode: string;
  config?: {
    accessType?: string;
    entryPointAccess?: string;
  };
  activeConference?: {
    conferenceRecord: string;
  };
}

export interface ConferenceRecord {
  name: string;
  startTime: string;
  endTime?: string;
  expireTime: string;
  space: string;
}

export interface MeetParticipant {
  name: string;
  earliestStartTime: string;
  latestEndTime?: string;
  signedinUser?: { user: string; displayName?: string };
  anonymousUser?: { displayName: string };
  phoneUser?: { displayName: string };
}

export interface MeetRecording {
  name: string;
  state: string;
  startTime: string;
  endTime?: string;
  driveDestination?: {
    file: string;
    exportUri: string;
  };
}

export interface MeetTranscript {
  name: string;
  state: string;
  startTime: string;
  endTime?: string;
  docsDestination?: {
    document: string;
    exportUri: string;
  };
}

export interface TranscriptEntry {
  name: string;
  participant: string;
  text: string;
  languageCode: string;
  startTime: string;
  endTime: string;
}

// ============================================================================
// Helpers
// ============================================================================

async function meetFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const client = await getConnectionBroker().getServiceClient('google');
  return client(`${MEET_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

// ============================================================================
// Public API — Spaces
// ============================================================================

/** Create a new meeting space */
export async function createSpace(config?: {
  accessType?: string;
  entryPointAccess?: string;
}): Promise<MeetSpace> {
  const body: Record<string, unknown> = {};
  if (config) body.config = config;

  const res = await meetFetch('/spaces', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to create space: ${res.status} ${await res.text()}`,
    );
  }
  const space = await res.json();
  logger.info(`Created Meet space: ${space.meetingCode}`);
  return space;
}

/** Get a meeting space by ID */
export async function getSpace(spaceId: string): Promise<MeetSpace> {
  const res = await meetFetch(`/spaces/${spaceId}`);
  if (!res.ok) {
    throw new Error(`Failed to get space: ${res.status}`);
  }
  return res.json();
}

/** Update a meeting space's config */
export async function updateSpace(
  spaceId: string,
  config: { accessType?: string; entryPointAccess?: string },
): Promise<MeetSpace> {
  const res = await meetFetch(`/spaces/${spaceId}?updateMask=config`, {
    method: 'PATCH',
    body: JSON.stringify({ config }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update space: ${res.status}`);
  }
  return res.json();
}

/** End the active conference in a space */
export async function endActiveConference(spaceId: string): Promise<void> {
  const res = await meetFetch(`/spaces/${spaceId}:endActiveConference`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(`Failed to end conference: ${res.status}`);
  }
  logger.info(`Ended active conference in space ${spaceId}`);
}

// ============================================================================
// Public API — Conference Records
// ============================================================================

/** List conference records */
export async function listConferenceRecords(
  maxResults = 20,
  filter?: string,
): Promise<ConferenceRecord[]> {
  const params = new URLSearchParams({ pageSize: String(maxResults) });
  if (filter) params.set('filter', filter);

  const res = await meetFetch(`/conferenceRecords?${params}`);
  if (!res.ok) {
    throw new Error(`Failed to list conference records: ${res.status}`);
  }
  const data = await res.json();
  return data.conferenceRecords ?? [];
}

/** Get a specific conference record */
export async function getConferenceRecord(
  recordId: string,
): Promise<ConferenceRecord> {
  const res = await meetFetch(`/conferenceRecords/${recordId}`);
  if (!res.ok) {
    throw new Error(`Failed to get conference record: ${res.status}`);
  }
  return res.json();
}

// ============================================================================
// Public API — Participants
// ============================================================================

/** List participants in a conference record */
export async function listParticipants(
  conferenceRecordId: string,
  maxResults = 50,
): Promise<MeetParticipant[]> {
  const params = new URLSearchParams({ pageSize: String(maxResults) });
  const res = await meetFetch(
    `/conferenceRecords/${conferenceRecordId}/participants?${params}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to list participants: ${res.status}`);
  }
  const data = await res.json();
  return data.participants ?? [];
}

// ============================================================================
// Public API — Recordings
// ============================================================================

/** List recordings for a conference record */
export async function listRecordings(
  conferenceRecordId: string,
): Promise<MeetRecording[]> {
  const res = await meetFetch(
    `/conferenceRecords/${conferenceRecordId}/recordings`,
  );
  if (!res.ok) {
    throw new Error(`Failed to list recordings: ${res.status}`);
  }
  const data = await res.json();
  return data.recordings ?? [];
}

/** Get a specific recording */
export async function getRecording(
  conferenceRecordId: string,
  recordingId: string,
): Promise<MeetRecording> {
  const res = await meetFetch(
    `/conferenceRecords/${conferenceRecordId}/recordings/${recordingId}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to get recording: ${res.status}`);
  }
  return res.json();
}

// ============================================================================
// Public API — Transcripts
// ============================================================================

/** List transcripts for a conference record */
export async function listTranscripts(
  conferenceRecordId: string,
): Promise<MeetTranscript[]> {
  const res = await meetFetch(
    `/conferenceRecords/${conferenceRecordId}/transcripts`,
  );
  if (!res.ok) {
    throw new Error(`Failed to list transcripts: ${res.status}`);
  }
  const data = await res.json();
  return data.transcripts ?? [];
}

/** List transcript entries (the actual text content) */
export async function listTranscriptEntries(
  conferenceRecordId: string,
  transcriptId: string,
  maxResults = 100,
): Promise<TranscriptEntry[]> {
  const params = new URLSearchParams({ pageSize: String(maxResults) });
  const res = await meetFetch(
    `/conferenceRecords/${conferenceRecordId}/transcripts/${transcriptId}/entries?${params}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to list transcript entries: ${res.status}`);
  }
  const data = await res.json();
  return data.transcriptEntries ?? [];
}
