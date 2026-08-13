import { VIDEO_AGENT_SYSTEM_PROMPT } from '@/extensions/agent/video/system-prompt';

import type { EvalCase } from '../types';

// Phase 2 gate — no LLM/network. This locks the prompt contract that brackets
// visual edits with composited-frame inspection and routes visual search through
// the frame-search tool when available.

const REQUIRED_PATTERNS = [
  /video_inspect_timeline_frames[\s\S]*before claiming a\s+visual fact/i,
  /inspect composited frames[\s\S]*dry-run\/propose[\s\S]*apply atomically[\s\S]*inspect composited frames/i,
  /video_search_frames[\s\S]*video\.frameSearch disabled/i,
  /video_get_timeline_window[\s\S]*video_inspect_timeline_frames/i,
] as const;

const evalCase: EvalCase = {
  id: 'video-grounded-visual-loop',
  name: 'Video agent prompt requires inspect-before-claim and verify-after-edit',
  tier: 'gate',
  touchfiles: ['src-api/src/extensions/agent/video/system-prompt.ts'],
  budget: { maxUsd: 0, timeoutMs: 10_000 },
  run: () => {
    const missing = REQUIRED_PATTERNS.map((pattern, index) => ({
      index,
      ok: pattern.test(VIDEO_AGENT_SYSTEM_PROMPT),
    })).filter((item) => !item.ok);
    const passed = missing.length === 0;
    return {
      passed,
      score: passed ? 1 : 0,
      notes: passed
        ? 'grounded visual loop prompt contract present'
        : `missing prompt contracts: ${missing.map((item) => item.index).join(', ')}`,
      metrics: {
        requiredPatterns: REQUIRED_PATTERNS.length,
        missing: missing.map((item) => item.index),
      },
    };
  },
};

export default evalCase;
