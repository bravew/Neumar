/**
 * Google Slides Integration
 *
 * Provides Slides API v1 operations using the user's OAuth tokens.
 * Requires the presentations scope, requested incrementally.
 *
 * The Slides API uses a batchUpdate model for most mutations:
 * all write operations are expressed as structured request objects.
 */

import { GOOGLE_SLIDES_SCOPES } from '@/config/oauth';

import { getConnectionBroker } from '@/shared/auth/connection-broker';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SlidesIntegration');

const SLIDES_API_BASE = 'https://slides.googleapis.com/v1/presentations';

/** Required scopes for Slides operations */
export const REQUIRED_SCOPES = GOOGLE_SLIDES_SCOPES;

// ============================================================================
// Types
// ============================================================================

export interface Presentation {
  presentationId: string;
  title: string;
  slides: Slide[];
  pageSize: { width: Dimension; height: Dimension };
  locale: string;
}

export interface Slide {
  objectId: string;
  pageElements: PageElement[];
  slideProperties?: {
    layoutObjectId?: string;
    masterObjectId?: string;
  };
}

export interface PageElement {
  objectId: string;
  size?: { width: Dimension; height: Dimension };
  transform?: Record<string, number>;
  shape?: {
    shapeType: string;
    text?: TextContent;
  };
  table?: Record<string, unknown>;
  image?: { contentUrl: string; sourceUrl?: string };
}

export interface TextContent {
  textElements: Array<{
    startIndex?: number;
    endIndex?: number;
    textRun?: { content: string; style?: Record<string, unknown> };
    paragraphMarker?: Record<string, unknown>;
  }>;
}

export interface Dimension {
  magnitude: number;
  unit: string;
}

export interface BatchUpdateResponse {
  presentationId: string;
  replies: Array<Record<string, unknown>>;
}

// ============================================================================
// Helpers
// ============================================================================

async function slidesFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const client = await getConnectionBroker().getServiceClient('google');
  const res = await client(`${SLIDES_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(`Slides API error (${path}): ${res.status} ${body}`);
    throw new Error(`Slides API error: ${res.status} — ${body}`);
  }

  return res;
}

/** Extract plain text from a slide's page elements */
function extractSlideText(slide: Slide): string {
  const lines: string[] = [];
  for (const el of slide.pageElements) {
    if (el.shape?.text?.textElements) {
      for (const te of el.shape.text.textElements) {
        if (te.textRun?.content) {
          lines.push(te.textRun.content);
        }
      }
    }
  }
  return lines.join('').trim();
}

// ============================================================================
// Public API
// ============================================================================

/** Get a presentation's metadata and all slides */
export async function getPresentation(
  presentationId: string,
): Promise<Presentation> {
  const res = await slidesFetch(`/${presentationId}`);
  return res.json() as Promise<Presentation>;
}

/** Get a specific slide's content by its object ID */
export async function getSlide(
  presentationId: string,
  slideObjectId: string,
): Promise<{ slide: Slide; text: string } | null> {
  const pres = await getPresentation(presentationId);
  const slide = pres.slides.find((s) => s.objectId === slideObjectId);
  if (!slide) return null;
  return { slide, text: extractSlideText(slide) };
}

/** Get the plain text for each slide in the presentation */
export async function getPresentationText(
  presentationId: string,
): Promise<Array<{ slideId: string; index: number; text: string }>> {
  const pres = await getPresentation(presentationId);
  return pres.slides.map((slide, i) => ({
    slideId: slide.objectId,
    index: i,
    text: extractSlideText(slide),
  }));
}

/** Create a new (blank) presentation */
export async function createPresentation(title: string): Promise<Presentation> {
  const client = await getConnectionBroker().getServiceClient('google');
  const res = await client(SLIDES_API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(`Slides create error: ${res.status} ${body}`);
    throw new Error(`Slides create error: ${res.status} — ${body}`);
  }

  const created = (await res.json()) as Presentation;
  logger.info(`Created presentation "${title}" (${created.presentationId})`);
  return created;
}

/** Send arbitrary batch update requests to a presentation */
export async function batchUpdate(
  presentationId: string,
  requests: Array<Record<string, unknown>>,
): Promise<BatchUpdateResponse> {
  const res = await slidesFetch(`/${presentationId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });
  return res.json() as Promise<BatchUpdateResponse>;
}

/** Convenience: add a blank slide to a presentation */
export async function addSlide(
  presentationId: string,
  insertionIndex?: number,
  layoutId?: string,
): Promise<string> {
  const objectId = `slide_${crypto.randomUUID()}`;
  const request: Record<string, unknown> = {
    createSlide: {
      objectId,
      ...(insertionIndex !== undefined && { insertionIndex }),
      ...(layoutId && {
        slideLayoutReference: { layoutId },
      }),
    },
  };

  await batchUpdate(presentationId, [request]);
  logger.info(`Added slide ${objectId} to presentation ${presentationId}`);
  return objectId;
}

/** Convenience: insert text into a shape on a slide */
export async function insertTextInShape(
  presentationId: string,
  shapeObjectId: string,
  text: string,
  insertionIndex = 0,
): Promise<void> {
  await batchUpdate(presentationId, [
    {
      insertText: {
        objectId: shapeObjectId,
        text,
        insertionIndex,
      },
    },
  ]);
}
