import fs from 'node:fs/promises';

import Anthropic from '@anthropic-ai/sdk';

import { DEFAULT_AGENT_MODEL } from '@/config/constants';

import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('VideoImageAnalysis');

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageFocalAnalysis {
  /** One-line description of the photo. */
  description: string;
  /** Primary subject category the focal point sits on. */
  subject: 'face' | 'person' | 'group' | 'object' | 'text' | 'scene';
  /** Normalized 0..1 center of the focal subject. */
  focus: { x: number; y: number };
  /** Suggested Ken Burns keyframes: zoom from the full frame toward the subject. */
  kenBurns: { from: Rect; to: Rect };
}

const ACCEPTED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

// Anthropic's vision API guidance is ~5MB per image; also guards against a giant
// asset blowing up Node heap (base64) and API spend.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Cap the focal-point call so a stalled upstream never hangs the MCP tool.
const IMAGE_ANALYSIS_TIMEOUT_MS = 30_000;

const ANALYSIS_PROMPT = `You are framing a Ken Burns pan/zoom for a slideshow.
Identify the single most important focal subject of this image.
Respond with ONLY compact JSON, no prose:
{"description": string up to 120 chars,
 "subject": one of "face"|"person"|"group"|"object"|"text"|"scene",
 "focusX": number 0..1, "focusY": number 0..1,
 "tightness": number 0.5..0.95}
focusX/focusY = normalized center of the subject (0,0 = top-left, 1,1 = bottom-right).
tightness = how much to zoom toward it (smaller = tighter crop on the subject).`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveAnthropic(): { client: Anthropic; model: string } {
  const apiKey =
    getSetting('anthropicApiKey') ||
    getSetting('apiKey') ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) {
    throw new Error('No Anthropic API key configured for image analysis');
  }
  const baseURL = process.env.ANTHROPIC_BASE_URL;
  if (baseURL) {
    // Defense-in-depth: reject a malformed/non-HTTP(S) base URL before it
    // becomes a server-side request target.
    const parsed = new URL(baseURL);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Invalid ANTHROPIC_BASE_URL protocol');
    }
  }
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_AGENT_MODEL;
  return {
    client: new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) }),
    model,
  };
}

/**
 * Analyze a local image with a vision model to locate its focal subject and
 * derive a Ken Burns plan that zooms from the full frame toward that subject.
 * Used by the video agent's `video_analyze_image` tool so photo slides pan/zoom
 * onto what matters instead of a blind center crop.
 */
export async function analyzeImageFocalPoint(
  filePath: string,
  mimeType: string,
): Promise<ImageFocalAnalysis> {
  const mediaType = ACCEPTED_MEDIA_TYPES.has(mimeType)
    ? mimeType
    : 'image/jpeg';
  const { client, model } = resolveAnthropic();
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image too large to analyze (${(stat.size / 1024 / 1024).toFixed(1)}MB > 5MB)`,
    );
  }
  const data = (await fs.readFile(filePath)).toString('base64');

  let response: Anthropic.Message;
  try {
    response = await client.messages.create(
      {
        model,
        max_tokens: 400,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType as
                    | 'image/jpeg'
                    | 'image/png'
                    | 'image/gif'
                    | 'image/webp',
                  data,
                },
              },
              { type: 'text', text: ANALYSIS_PROMPT },
            ],
          },
        ],
      },
      { timeout: IMAGE_ANALYSIS_TIMEOUT_MS },
    );
  } catch (error) {
    // Don't surface SDK error bodies/URLs (which can include the base URL or
    // request metadata) into the agent's tool-call context.
    if (error instanceof Anthropic.APIError) {
      throw new Error(`Image analysis request failed (HTTP ${error.status})`);
    }
    throw new Error('Image analysis request failed');
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  const parsed = parseAnalysisJson(text);
  const focusX = clamp(parsed.focusX, 0, 1);
  const focusY = clamp(parsed.focusY, 0, 1);
  const tightness = clamp(parsed.tightness, 0.5, 0.95);
  const toX = clamp(focusX - tightness / 2, 0, 1 - tightness);
  const toY = clamp(focusY - tightness / 2, 0, 1 - tightness);

  return {
    description: parsed.description.slice(0, 200),
    subject: parsed.subject,
    focus: { x: focusX, y: focusY },
    kenBurns: {
      from: { x: 0, y: 0, width: 1, height: 1 },
      to: { x: toX, y: toY, width: tightness, height: tightness },
    },
  };
}

interface ParsedAnalysis {
  description: string;
  subject: ImageFocalAnalysis['subject'];
  focusX: number;
  focusY: number;
  tightness: number;
}

const SUBJECTS = new Set([
  'face',
  'person',
  'group',
  'object',
  'text',
  'scene',
]);

function parseAnalysisJson(text: string): ParsedAnalysis {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    logger.warn('Image analysis returned no JSON; using center fallback');
    return {
      description: '',
      subject: 'scene',
      focusX: 0.5,
      focusY: 0.5,
      tightness: 0.85,
    };
  }
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    const subject = String(raw.subject ?? 'scene');
    return {
      description: typeof raw.description === 'string' ? raw.description : '',
      subject: (SUBJECTS.has(subject)
        ? subject
        : 'scene') as ParsedAnalysis['subject'],
      focusX: Number(raw.focusX ?? 0.5),
      focusY: Number(raw.focusY ?? 0.5),
      tightness: Number(raw.tightness ?? 0.85),
    };
  } catch {
    logger.warn('Image analysis JSON parse failed; using center fallback');
    return {
      description: '',
      subject: 'scene',
      focusX: 0.5,
      focusY: 0.5,
      tightness: 0.85,
    };
  }
}
