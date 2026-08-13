/**
 * Google Contacts Integration (People API)
 *
 * Provides People API v1 operations using the user's OAuth tokens.
 * Requires the contacts.readonly scope, requested incrementally.
 */

import {
  GOOGLE_CONTACTS_SCOPES,
  GOOGLE_DIRECTORY_SCOPES,
} from '@/config/oauth';

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ContactsIntegration');

const PEOPLE_API_BASE = 'https://people.googleapis.com/v1';

/** Required scopes for Contacts operations */
export const REQUIRED_SCOPES = GOOGLE_CONTACTS_SCOPES;

/** Required scopes for Directory operations */
export const DIRECTORY_REQUIRED_SCOPES = GOOGLE_DIRECTORY_SCOPES;

/** Default fields to request on every person resource */
const DEFAULT_PERSON_FIELDS =
  'names,emailAddresses,phoneNumbers,organizations,photos,metadata';

// ============================================================================
// Types
// ============================================================================

export interface PersonName {
  displayName: string;
  givenName?: string;
  familyName?: string;
}

export interface PersonEmail {
  value: string;
  type?: string;
  formattedType?: string;
}

export interface PersonPhone {
  value: string;
  type?: string;
  formattedType?: string;
}

export interface PersonOrganization {
  name?: string;
  title?: string;
  department?: string;
}

export interface PersonPhoto {
  url: string;
  default?: boolean;
}

export interface Person {
  resourceName: string;
  etag: string;
  names?: PersonName[];
  emailAddresses?: PersonEmail[];
  phoneNumbers?: PersonPhone[];
  organizations?: PersonOrganization[];
  photos?: PersonPhoto[];
  metadata?: { sources: Array<{ type: string; id: string }> };
}

// ============================================================================
// Helpers
// ============================================================================

async function peopleFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const client = await getConnectionBroker().getServiceClient('google');
  const res = await client(`${PEOPLE_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(`People API error (${path}): ${res.status} ${body}`);
    throw new Error(`People API error: ${res.status} — ${body}`);
  }

  return res;
}

// ============================================================================
// Public API
// ============================================================================

/** List the user's contacts */
export async function listContacts(
  pageSize = 100,
  pageToken?: string,
): Promise<{
  contacts: Person[];
  nextPageToken?: string;
  totalItems?: number;
}> {
  const params = new URLSearchParams({
    personFields: DEFAULT_PERSON_FIELDS,
    pageSize: String(pageSize),
    sortOrder: 'LAST_MODIFIED_DESCENDING',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const res = await peopleFetch(`/people/me/connections?${params.toString()}`);
  const data = await res.json();
  return {
    contacts: (data.connections as Person[]) ?? [],
    nextPageToken: data.nextPageToken,
    totalItems: data.totalItems,
  };
}

/** Get a single contact by resource name (e.g. "people/c1234567890") */
export async function getContact(resourceName: string): Promise<Person> {
  const params = new URLSearchParams({
    personFields: DEFAULT_PERSON_FIELDS,
  });
  const res = await peopleFetch(`/${resourceName}?${params.toString()}`);
  return res.json() as Promise<Person>;
}

/** Search contacts by name, email, or phone */
export async function searchContacts(
  query: string,
  pageSize = 10,
): Promise<Person[]> {
  const params = new URLSearchParams({
    query,
    readMask: DEFAULT_PERSON_FIELDS,
    pageSize: String(pageSize),
  });
  const res = await peopleFetch(`/people:searchContacts?${params.toString()}`);
  const data = await res.json();
  return (
    (data.results as Array<{ person: Person }>)?.map((r) => r.person) ?? []
  );
}

/** Create a new contact */
export async function createContact(contact: {
  givenName: string;
  familyName?: string;
  email?: string;
  phone?: string;
  organization?: string;
  title?: string;
}): Promise<Person> {
  const body: Record<string, unknown> = {
    names: [
      {
        givenName: contact.givenName,
        familyName: contact.familyName,
      },
    ],
  };

  if (contact.email) {
    body.emailAddresses = [{ value: contact.email }];
  }
  if (contact.phone) {
    body.phoneNumbers = [{ value: contact.phone }];
  }
  if (contact.organization || contact.title) {
    body.organizations = [{ name: contact.organization, title: contact.title }];
  }

  const res = await peopleFetch('/people:createContact', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const created = (await res.json()) as Person;
  logger.info(`Created contact: ${created.resourceName}`);
  return created;
}

/** Update a contact (partial update via updatePersonFields mask) */
export async function updateContact(
  resourceName: string,
  updates: {
    givenName?: string;
    familyName?: string;
    email?: string;
    phone?: string;
    organization?: string;
    title?: string;
  },
  etag: string,
): Promise<Person> {
  const updateMasks: string[] = [];
  const body: Record<string, unknown> = { etag };

  if (updates.givenName !== undefined || updates.familyName !== undefined) {
    body.names = [
      { givenName: updates.givenName, familyName: updates.familyName },
    ];
    updateMasks.push('names');
  }
  if (updates.email !== undefined) {
    body.emailAddresses = [{ value: updates.email }];
    updateMasks.push('emailAddresses');
  }
  if (updates.phone !== undefined) {
    body.phoneNumbers = [{ value: updates.phone }];
    updateMasks.push('phoneNumbers');
  }
  if (updates.organization !== undefined || updates.title !== undefined) {
    body.organizations = [{ name: updates.organization, title: updates.title }];
    updateMasks.push('organizations');
  }

  const params = new URLSearchParams({
    updatePersonFields: updateMasks.join(','),
  });

  const res = await peopleFetch(
    `/${resourceName}:updateContact?${params.toString()}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  );
  return res.json() as Promise<Person>;
}

// ============================================================================
// Directory (People API — company/org directory via searchDirectoryPeople)
// ============================================================================

/**
 * Domain sources used when querying the directory.
 * DOMAIN_PROFILE covers Google Workspace user accounts;
 * DOMAIN_CONTACT covers admin-created domain-shared contacts.
 */
const DIRECTORY_SOURCES = [
  'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE',
  'DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT',
];

const DEFAULT_DIRECTORY_PERSON_FIELDS =
  'names,emailAddresses,phoneNumbers,organizations,photos,metadata,biographies,urls';

export interface DirectoryPerson extends Person {
  biographies?: Array<{ value: string; contentType?: string }>;
  urls?: Array<{ value: string; type?: string; formattedType?: string }>;
}

/**
 * Search the Google Workspace directory for people matching `query`.
 * Uses the `people:searchDirectoryPeople` endpoint — requires
 * `https://www.googleapis.com/auth/directory.readonly`.
 */
export async function searchDirectoryPeople(
  query: string,
  pageSize = 10,
  pageToken?: string,
): Promise<{ people: DirectoryPerson[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    query,
    readMask: DEFAULT_DIRECTORY_PERSON_FIELDS,
    pageSize: String(pageSize),
  });
  for (const source of DIRECTORY_SOURCES) {
    params.append('sources', source);
  }
  if (pageToken) params.set('pageToken', pageToken);

  const res = await peopleFetch(
    `/people:searchDirectoryPeople?${params.toString()}`,
  );
  const data = await res.json();
  return {
    people: (data.people as DirectoryPerson[]) ?? [],
    nextPageToken: data.nextPageToken,
  };
}

/**
 * List all people in the Google Workspace directory.
 * Uses the `people:listDirectoryPeople` endpoint — requires
 * `https://www.googleapis.com/auth/directory.readonly`.
 */
export async function listDirectoryPeople(
  pageSize = 100,
  pageToken?: string,
): Promise<{
  people: DirectoryPerson[];
  nextPageToken?: string;
  totalSize?: number;
}> {
  const params = new URLSearchParams({
    readMask: DEFAULT_DIRECTORY_PERSON_FIELDS,
    pageSize: String(pageSize),
  });
  for (const source of DIRECTORY_SOURCES) {
    params.append('sources', source);
  }
  if (pageToken) params.set('pageToken', pageToken);

  const res = await peopleFetch(
    `/people:listDirectoryPeople?${params.toString()}`,
  );
  const data = await res.json();
  return {
    people: (data.people as DirectoryPerson[]) ?? [],
    nextPageToken: data.nextPageToken,
    totalSize: data.totalSize,
  };
}

/**
 * Get a single person from the directory by their resource name.
 * Works for both personal contacts and directory profiles.
 */
export async function getDirectoryPerson(
  resourceName: string,
): Promise<DirectoryPerson> {
  const params = new URLSearchParams({
    personFields: DEFAULT_DIRECTORY_PERSON_FIELDS,
  });
  const res = await peopleFetch(`/${resourceName}?${params.toString()}`);
  return res.json() as Promise<DirectoryPerson>;
}
