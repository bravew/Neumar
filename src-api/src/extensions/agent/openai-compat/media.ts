/**
 * Media Generation Module (Seedream Image + Seedance Video)
 *
 * Provides image generation via BytePlus Seedream API (synchronous)
 * and video generation via BytePlus Seedance API (async task + polling).
 */

import { promises as fs } from 'fs';
import { join } from 'path';

import OpenAI from 'openai';

import type { AgentMessage } from '@/core/agent/types';

import type { ToolResult } from './tools';

// ============================================================================
// Model Detection
// ============================================================================

const IMAGE_MODEL_PATTERN = /seedream/i;
const VIDEO_MODEL_PATTERN = /seedance/i;

export function isImageModel(model: string): boolean {
  return IMAGE_MODEL_PATTERN.test(model);
}

export function isVideoModel(model: string): boolean {
  return VIDEO_MODEL_PATTERN.test(model);
}

export function isMediaModel(model: string): boolean {
  return isImageModel(model) || isVideoModel(model);
}

// ============================================================================
// Image Generation (Seedream — synchronous)
// ============================================================================

const DEFAULT_IMAGE_MODEL = 'seedream-4-5-251128';

export async function generateImage(
  prompt: string,
  workDir: string,
  apiKey: string,
  baseUrl: string,
  model?: string,
  size?: string,
): Promise<ToolResult> {
  try {
    const client = new OpenAI({ apiKey, baseURL: baseUrl });
    const imageModel = model || DEFAULT_IMAGE_MODEL;

    const response = await client.images.generate({
      model: imageModel,
      prompt,
      // BytePlus Seedream supports '2K' alongside standard OpenAI sizes
      size: (size || '1024x1024') as
        | '256x256'
        | '512x512'
        | '1024x1024'
        | '1792x1024'
        | '1024x1792',
      n: 1,
      response_format: 'url',
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) {
      return { output: 'Error: No image URL returned from API', isError: true };
    }

    // Download and save the image
    const uniqueId = crypto.randomUUID();
    const filename = `generated-image-${uniqueId}.png`;
    const filePath = join(workDir, filename);

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return {
        output: `Error downloading image: HTTP ${imageResponse.status}`,
        isError: true,
      };
    }

    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(filePath, buffer);

    return {
      output: `Image generated successfully.\nModel: ${imageModel}\nSaved to: \`${filePath}\``,
      isError: false,
    };
  } catch (error) {
    return {
      output: `Error generating image: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

// ============================================================================
// Video Generation (Seedance — async task + polling)
// ============================================================================

const DEFAULT_VIDEO_MODEL = 'seedance-2-0';
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 60; // 5 minutes

interface SeedanceCreateResponse {
  id: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
}

export async function generateVideo(
  prompt: string,
  workDir: string,
  apiKey: string,
  baseUrl: string,
  model?: string,
  imageUrl?: string,
  abortSignal?: AbortSignal,
): Promise<ToolResult> {
  try {
    const videoModel = model || DEFAULT_VIDEO_MODEL;

    // Build content array for the chat completions format
    const contentParts: Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }> = [{ type: 'text', text: prompt }];
    if (imageUrl) {
      contentParts.push({ type: 'image_url', image_url: { url: imageUrl } });
    }

    // Create the video generation task
    // baseUrl already contains the version path (e.g. /api/v3), so append directly
    const createResponse = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/content/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: videoModel,
          messages: [{ role: 'user', content: contentParts }],
        }),
        signal: abortSignal,
      },
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      return {
        output: `Error creating video task: HTTP ${createResponse.status} - ${errorText}`,
        isError: true,
      };
    }

    const createData = (await createResponse.json()) as SeedanceCreateResponse;
    const taskId = createData.id;

    if (!taskId) {
      return {
        output: 'Error: No task ID returned from video generation API',
        isError: true,
      };
    }

    // Poll for completion
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      if (abortSignal?.aborted) {
        return { output: 'Video generation cancelled', isError: true };
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const pollResponse = await fetch(
        `${baseUrl.replace(/\/+$/, '')}/content/chat/completions/${taskId}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: abortSignal,
        },
      );

      if (!pollResponse.ok) continue;

      const pollData = (await pollResponse.json()) as SeedanceCreateResponse;
      const choice = pollData.choices?.[0];

      if (choice?.finish_reason === 'stop' && choice.message?.content) {
        // Extract video URL from response content
        const videoUrl = extractVideoUrl(choice.message.content);
        if (!videoUrl) {
          return {
            output: `Error: Could not extract video URL from response: ${choice.message.content}`,
            isError: true,
          };
        }

        // Download and save the video
        const uniqueId = crypto.randomUUID();
        const filename = `generated-video-${uniqueId}.mp4`;
        const filePath = join(workDir, filename);

        const videoResponse = await fetch(videoUrl, { signal: abortSignal });
        if (!videoResponse.ok) {
          return {
            output: `Error downloading video: HTTP ${videoResponse.status}`,
            isError: true,
          };
        }

        const buffer = Buffer.from(await videoResponse.arrayBuffer());
        await fs.mkdir(workDir, { recursive: true });
        await fs.writeFile(filePath, buffer);

        return {
          output: `Video generated successfully.\nModel: ${videoModel}\nSaved to: \`${filePath}\``,
          isError: false,
        };
      }
    }

    return {
      output: 'Error: Video generation timed out after 5 minutes',
      isError: true,
    };
  } catch (error) {
    if (abortSignal?.aborted) {
      return { output: 'Video generation cancelled', isError: true };
    }
    return {
      output: `Error generating video: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

function extractVideoUrl(content: string): string | null {
  // Try to parse as JSON first (common API response format)
  try {
    const parsed = JSON.parse(content);
    if (parsed.url) return parsed.url;
    if (parsed.video_url) return parsed.video_url;
  } catch {
    // Not JSON, try regex
  }

  // Try to find a URL in the content
  const urlMatch = content.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
  if (urlMatch) return urlMatch[0];

  // Try any URL
  const anyUrl = content.match(/https?:\/\/[^\s"'<>]+/);
  if (anyUrl) return anyUrl[0];

  return null;
}

// ============================================================================
// Direct Generation (for selectable media models — yields AgentMessages)
// ============================================================================

export async function* generateImageDirect(
  prompt: string,
  workDir: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): AsyncGenerator<AgentMessage> {
  yield { type: 'text', content: `Generating image with ${model}...\n\n` };

  const result = await generateImage(prompt, workDir, apiKey, baseUrl, model);

  if (result.isError) {
    yield { type: 'error', message: result.output };
  } else {
    yield { type: 'text', content: result.output };
  }
}

export async function* generateVideoDirect(
  prompt: string,
  workDir: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  abortSignal?: AbortSignal,
): AsyncGenerator<AgentMessage> {
  yield {
    type: 'text',
    content: `Generating video with ${model}...\nThis may take a few minutes.\n\n`,
  };

  const result = await generateVideo(
    prompt,
    workDir,
    apiKey,
    baseUrl,
    model,
    undefined,
    abortSignal,
  );

  if (result.isError) {
    yield { type: 'error', message: result.output };
  } else {
    yield { type: 'text', content: result.output };
  }
}
