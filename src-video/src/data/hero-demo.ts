/**
 * Hero demo narration script and timing data.
 * Used by generate-voiceover.ts and the HeroDemo composition.
 */
export const heroScript = {
  scenes: [
    {
      name: 'intro',
      startFrame: 0,
      durationFrames: 150,
      narration: '',
    },
    {
      name: 'problem',
      startFrame: 150,
      durationFrames: 210,
      narration:
        'You use ten different AI tools. Ten different interfaces. Ten different contexts. Switching costs you hours every week.',
    },
    {
      name: 'solution',
      startFrame: 360,
      durationFrames: 300,
      narration:
        'Neumar brings them all together. One desktop app. Every AI agent. Just tell it what you need.',
    },
    {
      name: 'demo',
      startFrame: 660,
      durationFrames: 600,
      narration:
        'Type a task in natural language. Watch the agent work. It reads files, searches the web, writes code, creates documents. All visible in real-time.',
    },
    {
      name: 'features',
      startFrame: 1260,
      durationFrames: 540,
      narration:
        'Switch between Claude, GPT, and Gemini freely. Connect any MCP tool. Schedule recurring tasks. Get results on Telegram, Slack, or Discord.',
    },
    {
      name: 'platforms',
      startFrame: 1800,
      durationFrames: 300,
      narration:
        'Available on macOS, Windows, and Linux. Desktop power meets cloud convenience.',
    },
    {
      name: 'cta',
      startFrame: 2100,
      durationFrames: 300,
      narration:
        'Neumar. Your tireless AI workhorse. Download free at neumar.app.',
    },
  ],
  totalFrames: 2400,
  fps: 30,
} as const;
