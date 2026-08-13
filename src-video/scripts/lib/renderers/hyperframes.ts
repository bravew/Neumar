import {
  pathExists,
  rawEntryDir,
  renderEntryDir,
  type NormalizedDocMediaVideoEntry,
  VIDEO_ROOT,
} from '../docs-media-config';
import { type RendererOptions, type RendererResult } from './remotion';

import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';

const HYPERFRAMES_ROOT = path.join(VIDEO_ROOT, 'hyperframes');
const SOURCE_ASSET_NAME = 'source.mp4';
const require = createRequire(import.meta.url);
const hyperframesPackage = require('hyperframes/package.json') as {
  version: string;
};

function projectDirFor(entry: NormalizedDocMediaVideoEntry) {
  return entry.renderer.hyperframes?.projectDir
    ? path.resolve(VIDEO_ROOT, entry.renderer.hyperframes.projectDir)
    : path.join(HYPERFRAMES_ROOT, entry.page, entry.slot);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function percentAt(ms: number, durationSeconds: number) {
  return `${Math.max(0, Math.min(100, (ms / 1000 / durationSeconds) * 100)).toFixed(3)}%`;
}

function cameraStateFor(
  entry: NormalizedDocMediaVideoEntry,
  zoom: { targetX: number; targetY: number; zoomLevel: number },
) {
  const stageWidth = entry.viewport.width;
  const stageHeight = entry.viewport.height;
  const minX = stageWidth - stageWidth * zoom.zoomLevel;
  const minY = stageHeight - stageHeight * zoom.zoomLevel;
  const x = Math.min(
    0,
    Math.max(minX, stageWidth / 2 - zoom.targetX * stageWidth * zoom.zoomLevel),
  );
  const y = Math.min(
    0,
    Math.max(
      minY,
      stageHeight / 2 - zoom.targetY * stageHeight * zoom.zoomLevel,
    ),
  );

  return { x, y, scale: zoom.zoomLevel };
}

function transformFor(
  entry: NormalizedDocMediaVideoEntry,
  zoom: { targetX: number; targetY: number; zoomLevel: number },
) {
  const state = cameraStateFor(entry, zoom);
  return `translate3d(${state.x.toFixed(2)}px, ${state.y.toFixed(2)}px, 0) scale(${state.scale})`;
}

function generatedCameraKeyframes(
  entry: NormalizedDocMediaVideoEntry,
  durationSeconds: number,
) {
  let currentTransform = 'translate3d(0px, 0px, 0) scale(1)';
  const frames = [`0% { transform: ${currentTransform}; }`];

  for (const zoom of entry.camera.zooms) {
    const startMs = zoom.fromMs;
    const endMs = zoom.fromMs + zoom.durationMs;
    frames.push(
      `${percentAt(startMs, durationSeconds)} { transform: ${currentTransform}; }`,
    );
    currentTransform = transformFor(entry, zoom);
    frames.push(
      `${percentAt(endMs, durationSeconds)} { transform: ${currentTransform}; }`,
    );
  }

  frames.push(`100% { transform: ${currentTransform}; }`);
  return `@keyframes recording-camera {\n${frames.map((frame) => `        ${frame}`).join('\n')}\n      }`;
}

function generatedIntroKeyframes(durationSeconds: number) {
  return `@keyframes intro-card {
        0%, ${percentAt(120, durationSeconds)} {
          opacity: 0;
          transform: translateY(10px);
        }
        ${percentAt(440, durationSeconds)}, ${percentAt(3350, durationSeconds)} {
          opacity: 1;
          transform: translateY(0);
        }
        ${percentAt(3650, durationSeconds)}, 100% {
          opacity: 0;
          transform: translateY(-8px);
        }
      }`;
}

function generatedProgressKeyframes() {
  return `@keyframes progress-fill {
        from { transform: scaleX(0); }
        to { transform: scaleX(1); }
      }`;
}

function chapterTiming(
  zoom: NormalizedDocMediaVideoEntry['camera']['zooms'][number],
) {
  const inMs = Math.max(550, zoom.fromMs + zoom.durationMs + 160);
  const holdMs = Math.max(2400, Math.min(4500, (zoom.holdMs ?? 2200) + 900));
  return { inMs, holdMs, outMs: inMs + holdMs };
}

function generatedChapterKeyframes(
  entry: NormalizedDocMediaVideoEntry,
  durationSeconds: number,
) {
  return entry.camera.zooms
    .map((zoom, index) => {
      const { inMs, outMs } = chapterTiming(zoom);
      return `@keyframes chapter-${index} {
        0%, ${percentAt(inMs, durationSeconds)} {
          opacity: 0;
          transform: translateY(12px);
        }
        ${percentAt(inMs + 220, durationSeconds)}, ${percentAt(outMs, durationSeconds)} {
          opacity: 1;
          transform: translateY(0);
        }
        ${percentAt(outMs + 220, durationSeconds)}, 100% {
          opacity: 0;
          transform: translateY(8px);
        }
      }`;
    })
    .join('\n\n      ');
}

function generatedChapterMarkup(entry: NormalizedDocMediaVideoEntry) {
  const total = entry.camera.zooms.length;
  return entry.camera.zooms
    .map(
      (zoom, index) => `<div class="chapter chapter-${index}">
          <div class="chapter-count">${index + 1}/${total}</div>
          <div class="chapter-text">${escapeHtml(zoom.label)}</div>
        </div>`,
    )
    .join('\n        ');
}

async function isSeekableAssetFresh(rawPath: string, assetPath: string) {
  try {
    const [rawStats, assetStats] = await Promise.all([
      fs.stat(rawPath),
      fs.stat(assetPath),
    ]);
    return assetStats.size > 0 && assetStats.mtimeMs >= rawStats.mtimeMs;
  } catch {
    return false;
  }
}

function transcodeSeekableVideoAsset(
  rawPath: string,
  assetPath: string,
  fps: number,
) {
  const keyframeInterval = String(fps);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      rawPath,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(fps),
      '-g',
      keyframeInterval,
      '-keyint_min',
      keyframeInterval,
      '-sc_threshold',
      '0',
      '-an',
      '-movflags',
      '+faststart',
      assetPath,
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
}

async function ensureProject(
  entry: NormalizedDocMediaVideoEntry,
  projectDir: string,
) {
  const indexPath = path.join(projectDir, 'index.html');
  const configPath = path.join(projectDir, 'hyperframes.json');
  const assetsDir = path.join(projectDir, 'assets');
  await fs.mkdir(assetsDir, { recursive: true });

  await fs.writeFile(indexPath, generatedIndex(entry));
  await fs.writeFile(configPath, generatedConfig(entry));

  const rawPath = path.join(rawEntryDir(entry), 'source.webm');
  const assetPath = path.join(assetsDir, SOURCE_ASSET_NAME);
  if (await pathExists(rawPath)) {
    if (!(await isSeekableAssetFresh(rawPath, assetPath))) {
      transcodeSeekableVideoAsset(rawPath, assetPath, entry.camera.fps);
    }
  }
}

function generatedIndex(entry: NormalizedDocMediaVideoEntry) {
  const compositionId = `${entry.page}-${entry.slot}`;
  const durationSeconds =
    (entry.camera.durationMs ?? entry.budgets.maxDurationMs ?? 15_000) / 1000;
  const sourceStartSeconds = (entry.camera.sourceStartMs ?? 0) / 1000;
  const cameraKeyframes = generatedCameraKeyframes(entry, durationSeconds);
  const introKeyframes = generatedIntroKeyframes(durationSeconds);
  const progressKeyframes = generatedProgressKeyframes();
  const chapterKeyframes = generatedChapterKeyframes(entry, durationSeconds);
  const chapterMarkup = generatedChapterMarkup(entry);
  const cameraFrames = JSON.stringify(
    entry.camera.zooms.map((zoom) => ({
      fromMs: zoom.fromMs,
      durationMs: zoom.durationMs,
      ...cameraStateFor(entry, zoom),
    })),
  ).replace(/<\//g, '<\\/');
  const chapterTimings = JSON.stringify(
    entry.camera.zooms.map(chapterTiming),
  ).replace(/<\//g, '<\\/');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=${entry.viewport.width}, height=${entry.viewport.height}" />
    <title>${escapeHtml(entry.title)}</title>
    <style>
      ${cameraKeyframes}

      ${introKeyframes}

      ${progressKeyframes}

      ${chapterKeyframes}

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        width: ${entry.viewport.width}px;
        height: ${entry.viewport.height}px;
        overflow: hidden;
        background: #09090b;
        color: #fafafa;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      }

      main {
        display: block;
        width: 100%;
        height: 100vh;
        padding: 0;
      }

      .stage {
        position: relative;
        margin: 0;
        width: 100%;
        height: 100%;
        aspect-ratio: ${entry.viewport.width} / ${entry.viewport.height};
      }

      .camera {
        position: absolute;
        inset: 0;
        overflow: hidden;
        border: 0;
        border-radius: 0;
        background: #09090b;
      }

      .recording {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform-origin: 0 0;
        transition: none !important;
      }

      .intro {
        position: absolute;
        left: 28px;
        top: 26px;
        z-index: 3;
        max-width: 520px;
        border: 1px solid rgb(255 255 255 / 0.14);
        border-radius: 12px;
        background: rgb(9 9 11 / 0.76);
        color: #fafafa;
        opacity: 0;
        padding: 16px 18px;
        backdrop-filter: blur(12px);
      }

      .intro-title {
        font-size: 22px;
        font-weight: 700;
        line-height: 1.2;
      }

      .intro-intent {
        margin-top: 8px;
        color: rgb(250 250 250 / 0.72);
        font-size: 14px;
        line-height: 1.35;
      }

      .chapter {
        position: absolute;
        left: 28px;
        bottom: 28px;
        z-index: 3;
        display: flex;
        align-items: center;
        max-width: min(620px, calc(100% - 56px));
        gap: 12px;
        border: 1px solid rgb(255 255 255 / 0.14);
        border-radius: 999px;
        background: rgb(9 9 11 / 0.78);
        color: #fafafa;
        opacity: 0;
        padding: 11px 16px 11px 12px;
        backdrop-filter: blur(12px);
      }

      .chapter-count {
        min-width: 46px;
        border-radius: 999px;
        background: rgb(99 102 241 / 0.92);
        color: #ffffff;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        line-height: 1;
        padding: 8px 10px;
        text-align: center;
      }

      .chapter-text {
        overflow: hidden;
        color: #fafafa;
        font-size: 16px;
        font-weight: 650;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .progress {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 4;
        height: 4px;
        background: rgb(255 255 255 / 0.1);
      }

      .progress-fill {
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, #14b8a6, #6366f1);
        transform: scaleX(0);
        transform-origin: 0 50%;
      }
    </style>
  </head>
  <body>
    <main
      id="root"
      data-composition-id="${compositionId}"
      data-width="${entry.viewport.width}"
      data-height="${entry.viewport.height}"
      data-start="0"
      data-duration="${durationSeconds}"
      data-hf-scene="docs-demo"
    >
      <div class="stage">
        <div class="camera">
        <video
          id="source-recording"
          class="recording"
          src="./assets/${SOURCE_ASSET_NAME}"
          muted
          playsinline
          preload="auto"
          data-start="0"
          data-media-start="${sourceStartSeconds}"
          data-duration="${durationSeconds}"
          data-track-index="1"
        ></video>
        </div>
        <div class="intro">
          <div class="intro-title">${escapeHtml(entry.title)}</div>
          <div class="intro-intent">${escapeHtml(entry.intent)}</div>
        </div>
        ${chapterMarkup}
        <div class="progress"><div class="progress-fill"></div></div>
      </div>
    </main>
    <script>
      window.__timelines = window.__timelines || {};
      let currentTime = 0;
      const duration = ${durationSeconds};
      const cameraFrames = ${cameraFrames};
      const chapterTimings = ${chapterTimings};
      const recording = document.querySelector('.recording');
      const intro = document.querySelector('.intro');
      const chapters = Array.from(document.querySelectorAll('.chapter'));
      const progress = document.querySelector('.progress-fill');

      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }

      function smoothstep(value) {
        const t = clamp(value, 0, 1);
        return t * t * (3 - 2 * t);
      }

      function mix(from, to, amount) {
        return from + (to - from) * amount;
      }

      function fadeWindow(time, inTime, inDuration, outTime, outDuration) {
        if (time < inTime) return 0;
        if (time < inTime + inDuration) {
          return smoothstep((time - inTime) / inDuration);
        }
        if (time < outTime) return 1;
        if (time < outTime + outDuration) {
          return 1 - smoothstep((time - outTime) / outDuration);
        }
        return 0;
      }

      function updateCamera(timeMs) {
        let previous = { x: 0, y: 0, scale: 1 };
        let current = previous;

        for (const frame of cameraFrames) {
          const endMs = frame.fromMs + frame.durationMs;
          if (timeMs < frame.fromMs) break;
          if (timeMs <= endMs) {
            const amount = smoothstep((timeMs - frame.fromMs) / frame.durationMs);
            current = {
              x: mix(previous.x, frame.x, amount),
              y: mix(previous.y, frame.y, amount),
              scale: mix(previous.scale, frame.scale, amount),
            };
            break;
          }
          previous = { x: frame.x, y: frame.y, scale: frame.scale };
          current = previous;
        }

        recording.style.transform =
          'translate3d(' + current.x.toFixed(2) + 'px, ' +
          current.y.toFixed(2) + 'px, 0) scale(' +
          current.scale.toFixed(4) + ')';
      }

      function updateOverlays(timeMs) {
        const introOpacity = fadeWindow(timeMs, 120, 320, 3350, 300);
        intro.style.opacity = String(introOpacity);
        intro.style.transform =
          'translateY(' + mix(10, -8, smoothstep(timeMs / 3650)).toFixed(2) + 'px)';

        for (const [index, chapter] of chapters.entries()) {
          const timing = chapterTimings[index];
          const opacity = fadeWindow(
            timeMs,
            timing.inMs,
            220,
            timing.outMs,
            220,
          );
          chapter.style.opacity = String(opacity);
          chapter.style.transform =
            'translateY(' + (12 * (1 - opacity)).toFixed(2) + 'px)';
        }

        progress.style.transform =
          'scaleX(' + clamp(timeMs / (duration * 1000), 0, 1).toFixed(5) + ')';
      }

      function update(time) {
        const timeMs = clamp(Number(time) || 0, 0, duration) * 1000;
        updateCamera(timeMs);
        updateOverlays(timeMs);
      }

      update(0);
      window.__timelines[${JSON.stringify(compositionId)}] = {
        pause() { return this; },
        play() { return this; },
        seek(time) {
          currentTime = Math.max(0, Math.min(duration, Number(time) || 0));
          update(currentTime);
          return this;
        },
        totalTime(time) {
          if (time === undefined) return currentTime;
          currentTime = Math.max(0, Math.min(duration, Number(time) || 0));
          update(currentTime);
          return currentTime;
        },
        time() { return currentTime; },
        duration() { return duration; },
        timeScale() { return this; },
      };
    </script>
  </body>
</html>
`;
}

function generatedConfig(entry: NormalizedDocMediaVideoEntry) {
  return `${JSON.stringify(
    {
      $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
      fps: entry.camera.fps,
      durationMs: entry.camera.durationMs ?? entry.budgets.maxDurationMs,
      snapshotAtMs: entry.renderer.hyperframes?.snapshotAtMs ?? [],
      paths: {
        blocks: 'compositions',
        components: 'compositions/components',
        assets: 'assets',
      },
    },
    null,
    2,
  )}\n`;
}

function runHyperframes(args: string[], cwd: string) {
  return execFileSync('pnpm', ['exec', 'hyperframes', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

export async function renderWithHyperframes(
  entry: NormalizedDocMediaVideoEntry,
  options: RendererOptions,
): Promise<RendererResult> {
  const projectDir = projectDirFor(entry);
  const outputDir = renderEntryDir('hyperframes', entry);
  const outputPath = path.join(outputDir, 'source.mp4');
  const metadataPath = path.join(outputDir, 'render.json');
  const snapshotAtMs = entry.renderer.hyperframes?.snapshotAtMs ?? [];

  if (options.dryRun) {
    console.log(`  hyperframes ${entry.id}: lint ${projectDir}`);
    for (const ms of snapshotAtMs) {
      console.log(`  hyperframes ${entry.id}: snapshot ${ms}ms`);
    }
    console.log(
      `  hyperframes ${entry.id}: render${options.ci ? ' --docker' : ''} -> ${outputPath}`,
    );
    return {
      renderer: 'hyperframes',
      entryId: entry.id,
      outputPath,
      metadataPath,
    };
  }

  await ensureProject(entry, projectDir);
  await fs.mkdir(outputDir, { recursive: true });

  const lintOutput = runHyperframes(['lint', projectDir], VIDEO_ROOT);
  const snapshotPaths: string[] = [];

  if (snapshotAtMs.length > 0) {
    const snapshotDir = path.join(projectDir, 'snapshots');
    await fs.rm(snapshotDir, { force: true, recursive: true });
    runHyperframes(
      [
        'snapshot',
        '--at',
        snapshotAtMs.map((ms) => String(ms / 1000)).join(','),
        projectDir,
      ],
      VIDEO_ROOT,
    );
    if (await pathExists(snapshotDir)) {
      const entries = await fs.readdir(snapshotDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          snapshotPaths.push(path.join(snapshotDir, entry.name));
        }
      }
    }
  }

  const renderArgs = [
    'render',
    '-o',
    outputPath,
    '-q',
    options.quality,
    projectDir,
  ];
  if (options.ci && entry.renderer.hyperframes?.docker) {
    renderArgs.push('--docker');
  }
  runHyperframes(renderArgs, VIDEO_ROOT);

  await fs.writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        command: `pnpm exec hyperframes ${renderArgs.join(' ')}`,
        renderer: 'hyperframes',
        rendererVersion: hyperframesPackage.version,
        sourceCompositionPath: path.join(projectDir, 'index.html'),
        durationMs: entry.camera.durationMs ?? entry.budgets.maxDurationMs,
        fps: entry.camera.fps,
        outputPath,
        snapshotPaths,
        lintResult: lintOutput.trim() || 'ok',
        ci: options.ci,
        docker: options.ci && entry.renderer.hyperframes?.docker === true,
        quality: options.quality,
      },
      null,
      2,
    )}\n`,
  );

  return {
    renderer: 'hyperframes',
    entryId: entry.id,
    outputPath,
    metadataPath,
  };
}
