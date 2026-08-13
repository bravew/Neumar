/**
 * Google Calendar Integration
 *
 * Provides Calendar API operations using the user's OAuth tokens.
 * Requires the calendar.readonly and/or calendar.events scopes.
 */

import { GOOGLE_CALENDAR_SCOPES } from '@/config/oauth';

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('CalendarIntegration');

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

/** Required scopes for Calendar operations */
export const REQUIRED_SCOPES = GOOGLE_CALENDAR_SCOPES;

// ============================================================================
// Types
// ============================================================================

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status: string;
  htmlLink: string;
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus: string;
  }>;
  organizer?: { email: string; displayName?: string };
  created: string;
  updated: string;
}

export interface CalendarList {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor?: string;
}

// ============================================================================
// Helpers
// ============================================================================

async function calendarFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const client = await getConnectionBroker().getServiceClient('google');
  const res = await client(`${CALENDAR_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(`Calendar API error (${path}): ${res.status} ${body}`);
    throw new Error(`Calendar API error: ${res.status} — ${body}`);
  }

  return res;
}

// ============================================================================
// Public API
// ============================================================================

/** List calendars the user has access to */
export async function listCalendars(): Promise<CalendarList[]> {
  const res = await calendarFetch('/users/me/calendarList');
  const data = await res.json();
  return (data.items ?? []).map(
    (item: {
      id: string;
      summary: string;
      primary?: boolean;
      backgroundColor?: string;
    }) => ({
      id: item.id,
      summary: item.summary,
      primary: item.primary ?? false,
      backgroundColor: item.backgroundColor,
    }),
  );
}

/** List upcoming events from a calendar */
export async function listEvents(
  calendarId = 'primary',
  maxResults = 10,
  timeMin?: string,
  timeMax?: string,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    maxResults: String(maxResults),
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: timeMin ?? new Date().toISOString(),
  });
  if (timeMax) params.set('timeMax', timeMax);

  const res = await calendarFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
  );
  const data = await res.json();
  return data.items ?? [];
}

/** Get a specific event by ID */
export async function getEvent(
  calendarId: string,
  eventId: string,
): Promise<CalendarEvent | null> {
  try {
    const res = await calendarFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
    return res.json();
  } catch {
    return null;
  }
}

/** Create a new calendar event */
export async function createEvent(
  calendarId: string,
  event: {
    summary: string;
    description?: string;
    location?: string;
    start: { dateTime: string; timeZone?: string };
    end: { dateTime: string; timeZone?: string };
    attendees?: Array<{ email: string }>;
  },
): Promise<CalendarEvent> {
  const res = await calendarFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      body: JSON.stringify(event),
    },
  );

  const data = await res.json();
  logger.info(`Created calendar event: ${data.id}`);
  return data;
}

/** Get today's schedule (upcoming events for the next 24 hours) */
export async function getTodaySchedule(
  calendarId = 'primary',
): Promise<CalendarEvent[]> {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  return listEvents(calendarId, 25, now.toISOString(), endOfDay.toISOString());
}
