import { heroScript } from '../src/data/hero-demo';

import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const VOICEOVER_DIR = path.resolve(import.meta.dirname, '../public/voiceover');

interface VoiceoverSpec {
  compositionId: string;
  scenes: Array<{
    name: string;
    text: string;
  }>;
}

const specs: VoiceoverSpec[] = [
  {
    compositionId: 'HeroDemo',
    scenes: heroScript.scenes
      .filter((s) => s.narration)
      .map((s) => ({ name: s.name, text: s.narration })),
  },
  {
    compositionId: 'FeatureClip',
    scenes: [
      {
        name: 'agent-chat',
        text: 'Execute complex tasks through natural language conversation. The agent streams its thinking, tool calls, and results in real-time.',
      },
      {
        name: 'mcp-tools',
        text: 'Connect any tool via Model Context Protocol. File operations, web browsing, code execution, and more.',
      },
      {
        name: 'automation',
        text: 'Set it and forget it. Schedule tasks with cron, trigger via webhooks, and deliver results across channels.',
      },
    ],
  },
];

/**
 * Generate voiceover using edge-tts (free, no API key required).
 * Install: pip install edge-tts
 *
 * For higher quality, use ElevenLabs:
 * Set ELEVENLABS_API_KEY env var and uncomment the ElevenLabs section below.
 */
async function generateWithEdgeTTS(
  text: string,
  outputPath: string,
  voice = 'en-US-GuyNeural',
) {
  execFileSync(
    'edge-tts',
    ['--text', text, '--voice', voice, '--write-media', outputPath],
    { stdio: 'pipe' },
  );
}

async function generateAll() {
  const useElevenLabs = !!process.env.ELEVENLABS_API_KEY;

  console.log(
    `Generating voiceover using ${useElevenLabs ? 'ElevenLabs' : 'edge-tts'}...\n`,
  );

  for (const spec of specs) {
    const outDir = path.join(VOICEOVER_DIR, spec.compositionId);
    await fs.mkdir(outDir, { recursive: true });

    for (const scene of spec.scenes) {
      const filePath = path.join(outDir, `${scene.name}.mp3`);

      // Skip if file already exists
      try {
        await fs.access(filePath);
        console.log(`  = ${spec.compositionId}/${scene.name}.mp3 (exists)`);
        continue;
      } catch {
        // File doesn't exist, generate it
      }

      try {
        if (useElevenLabs) {
          // Dynamic import to avoid requiring elevenlabs when not needed
          // @ts-expect-error -- optional peer dep, only loaded when ELEVENLABS_API_KEY is set
          const { ElevenLabs } = await import('elevenlabs');
          const client = new ElevenLabs({
            apiKey: process.env.ELEVENLABS_API_KEY,
          });
          const audio = await client.textToSpeech.convert(
            '21m00Tcm4TlvDq8ikWAM', // Rachel voice
            {
              text: scene.text,
              model_id: 'eleven_multilingual_v2',
            },
          );
          // ElevenLabs returns a readable stream
          const chunks: Buffer[] = [];
          for await (const chunk of audio as AsyncIterable<Buffer>) {
            chunks.push(chunk);
          }
          await fs.writeFile(filePath, Buffer.concat(chunks));
        } else {
          await generateWithEdgeTTS(scene.text, filePath);
        }
        console.log(`  + ${spec.compositionId}/${scene.name}.mp3`);
      } catch (err) {
        console.error(`  x ${spec.compositionId}/${scene.name}: ${err}`);
      }
    }
  }

  console.log('\nDone.');
}

generateAll();
