import { describe, expect, it } from 'vitest';

import {
  buildCaptionSidecarSrt,
  buildMultiSceneRenderArgs,
  buildRenderArgs,
  selectFinalRenderer,
  timelineCaptionSubtitles,
  transitionDegradationsForScenes,
  type OverlayClip,
  type SceneClip,
} from '@/shared/video/pipeline';
import type { VideoProject } from '@/shared/video/types';

describe('video render args', () => {
  it('keeps the single-image path simple and silent', () => {
    const args = buildRenderArgs({
      inputPath: '/workspace/image.png',
      outputPath: '/workspace/out.mp4',
      assetKind: 'image',
      durationSec: 4,
      aspectRatio: '16:9',
      mode: 'speed',
    });

    expect(args).toEqual([
      '-loop',
      '1',
      '-t',
      '4',
      '-i',
      '/workspace/image.png',
      '-vf',
      [
        'scale=1920:1080:force_original_aspect_ratio=decrease',
        'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
        'fps=30',
        'setsar=1',
        'format=yuv420p',
        'setpts=PTS-STARTPTS',
      ].join(','),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-an',
      '-movflags',
      '+faststart',
      '/workspace/out.mp4',
    ]);
  });

  it('renders a blurred backdrop behind a contained image (blur-pad)', () => {
    const args = buildRenderArgs({
      inputPath: '/workspace/logo.png',
      outputPath: '/workspace/out.mp4',
      assetKind: 'image',
      durationSec: 4,
      aspectRatio: '16:9',
      mode: 'speed',
      blurPad: true,
    });
    // split/overlay needs -filter_complex (not -vf) with an explicit [vout] map.
    expect(args).not.toContain('-vf');
    const fc = args[args.indexOf('-filter_complex') + 1]!;
    expect(fc.startsWith('[0:v]')).toBe(true);
    expect(fc.endsWith('[vout]')).toBe(true);
    expect(fc).toContain('split[bpa0][bpb0]');
    expect(fc).toContain(
      'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=20:1[bpbg0]',
    );
    expect(fc).toContain(
      'scale=1920:1080:force_original_aspect_ratio=decrease[bpfg0]',
    );
    expect(fc).toContain('[bpbg0][bpfg0]overlay=(W-w)/2:(H-h)/2');
    expect(args.slice(args.indexOf('-map'))).toContain('[vout]');
    // not a plain letterbox
    expect(fc).not.toContain('pad=1920:1080:(ow-iw)/2:(oh-ih)/2');
  });

  it('maps audio through filter_complex for a blur-pad video', () => {
    const args = buildRenderArgs({
      inputPath: '/workspace/clip.mp4',
      outputPath: '/workspace/out.mp4',
      assetKind: 'video',
      durationSec: 4,
      hasAudio: true,
      aspectRatio: '16:9',
      mode: 'speed',
      blurPad: true,
    });
    expect(args).not.toContain('-vf');
    expect(args).toContain('-filter_complex');
    expect(args).toContain('[vout]');
    expect(args).toContain('0:a?');
  });

  it('uses scene-indexed blur-pad labels in the multi-scene graph', () => {
    const blurScene: SceneClip = {
      inputPath: '/workspace/logo.png',
      durationSec: 3,
      kind: 'image',
      blurPad: true,
    };
    const args = buildMultiSceneRenderArgs({
      scenes: [imageScene('/workspace/a.png', 4, 'cut'), blurScene],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'speed',
    });
    const filter = filterGraph(args);
    expect(filter).toContain('split[bpa1][bpb1]');
    expect(filter).toContain('[bpbg1][bpfg1]overlay=(W-w)/2:(H-h)/2');
  });

  it('applies final bookend fades on the single video path', () => {
    const args = buildRenderArgs({
      inputPath: '/workspace/video.mp4',
      outputPath: '/workspace/out.mp4',
      assetKind: 'video',
      durationSec: 4,
      aspectRatio: '16:9',
      mode: 'speed',
      introMs: 500,
      outroMs: 800,
    });

    expect(args).toContain(
      [
        'scale=1920:1080:force_original_aspect_ratio=decrease',
        'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
        'fps=30',
        'setsar=1',
        'format=yuv420p',
        'setpts=PTS-STARTPTS',
        'fade=t=in:st=0:d=0.5',
        'fade=t=out:st=3.2:d=0.8',
      ].join(','),
    );
    expect(args).toContain('afade=t=in:st=0:d=0.5,afade=t=out:st=3.2:d=0.8');
  });

  it('does not attach audio filters to silent single video renders', () => {
    const args = buildRenderArgs({
      inputPath: '/workspace/silent.mp4',
      outputPath: '/workspace/out.mp4',
      assetKind: 'video',
      durationSec: 4,
      hasAudio: false,
      aspectRatio: '16:9',
      mode: 'speed',
      introMs: 500,
    });

    expect(args.join(' ')).toContain('fade=t=in:st=0:d=0.5');
    expect(args).toContain('-an');
    expect(args).not.toContain('-af');
  });

  it('retimes single video playback with video PTS and audio tempo filters', () => {
    const args = buildRenderArgs({
      inputPath: '/workspace/video.mp4',
      outputPath: '/workspace/out.mp4',
      assetKind: 'video',
      durationSec: 2,
      sourceStartSec: 1,
      playback: { speed: 2, reverse: false },
      hasAudio: true,
      aspectRatio: '16:9',
      mode: 'speed',
    });

    expect(args.slice(0, 5)).toEqual(['-ss', '1', '-t', '4', '-i']);
    expect(args).toContain('/workspace/video.mp4');
    expect(args).toContain(
      [
        'scale=1920:1080:force_original_aspect_ratio=decrease',
        'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
        'fps=30',
        'setsar=1',
        'format=yuv420p',
        'setpts=(PTS-STARTPTS)/2',
      ].join(','),
    );
    expect(args).toContain('-af');
    expect(args[args.indexOf('-af') + 1]).toBe('atempo=2,asetpts=PTS-STARTPTS');
  });

  it('builds cut concat for silent image scenes', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [
        imageScene('/workspace/a.png', 5, 'cut'),
        imageScene('/workspace/b.png', 3),
      ],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'speed',
    });

    expect(args).toContain('anullsrc=channel_layout=stereo:sample_rate=48000');
    const filter = filterGraph(args);
    expect(filter).toContain('[v0][v1]concat=n=2:v=1:a=0[vjoin1]');
    expect(filter).toContain('[a0][a1]concat=n=2:v=0:a=1[ajoin1]');
    expect(args.slice(-15)).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      '/workspace/out.mp4',
    ]);
  });

  it('builds xfade and acrossfade for fade transitions', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [
        videoScene('/workspace/a.mp4', 5, true, 'fade'),
        imageScene('/workspace/b.png', 3),
      ],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '9:16',
      mode: 'speed',
    });

    expect(args.slice(0, 4)).toEqual(['-t', '5', '-i', '/workspace/a.mp4']);
    expect(args).toContain('anullsrc=channel_layout=stereo:sample_rate=48000');
    const filter = filterGraph(args);
    expect(filter).toContain(
      'scale=1080:1920:force_original_aspect_ratio=decrease',
    );
    expect(filter).toContain('[0:a]aformat=sample_rates=48000');
    expect(filter).toContain(
      '[v0][v1]xfade=transition=fade:duration=0.5:offset=4.5[vjoin1]',
    );
    expect(filter).toContain('[a0][a1]acrossfade=d=0.5[ajoin1]');
  });

  it('keeps a hard audio cut when a visual transition opts out', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [
        {
          ...videoScene('/workspace/a.mp4', 5, true, 'fade'),
          audioSeamToNext: 'cut',
        },
        videoScene('/workspace/b.mp4', 3, true),
      ],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'speed',
    });

    const filter = filterGraph(args);
    expect(filter).toContain(
      '[v0][v1]xfade=transition=fade:duration=0.5:offset=4.5[vjoin1]',
    );
    expect(filter).toContain('[a0][a1]concat=n=2:v=0:a=1[ajoin1]');
    expect(filter).not.toContain('[a0][a1]acrossfade');
  });

  it('seeks trimmed EDL video sources before rendering', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [
        {
          ...videoScene('/workspace/a.mp4', 2.5, true),
          sourceStartSec: 1.25,
        },
      ],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'speed',
    });

    expect(args.slice(0, 6)).toEqual([
      '-ss',
      '1.25',
      '-t',
      '2.5',
      '-i',
      '/workspace/a.mp4',
    ]);
  });

  it('trims before reversing and retiming multi-scene video audio', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [
        {
          ...videoScene('/workspace/a.mp4', 2, true),
          playback: { speed: 2, reverse: true },
          sourceStartSec: 1.25,
        },
      ],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'speed',
    });

    expect(args.slice(0, 6)).toEqual([
      '-ss',
      '1.25',
      '-t',
      '4',
      '-i',
      '/workspace/a.mp4',
    ]);
    const filter = filterGraph(args);
    expect(filter).toContain(
      '[0:v]reverse,scale=1920:1080:force_original_aspect_ratio=decrease',
    );
    expect(filter).toContain('format=yuv420p,setpts=(PTS-STARTPTS)/2[v0]');
    expect(filter).toContain(
      '[0:a]areverse,atempo=2,aformat=sample_rates=48000',
    );
  });

  it('maps slide transitions to slideleft and chains mixed joins', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [
        imageScene('/workspace/a.png', 4, 'slide'),
        videoScene('/workspace/b.mp4', 5, true, 'cut'),
        imageScene('/workspace/c.png', 2),
      ],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '1:1',
      mode: 'speed',
    });

    const filter = filterGraph(args);
    expect(filter).toContain(
      '[v0][v1]xfade=transition=slideleft:duration=0.5:offset=3.5[vjoin1]',
    );
    expect(filter).toContain('[vjoin1][v2]concat=n=2:v=1:a=0[vjoin2]');
    expect(filter).toContain('[ajoin1][a2]concat=n=2:v=0:a=1[ajoin2]');
  });

  it.each([
    ['iris', 'circleopen'],
    ['dissolve', 'dissolve'],
    ['pixelize', 'pixelize'],
    ['soft-wipe', 'smoothright'],
    [{ kind: 'soft-wipe', params: { angle: 90, reverse: true } }, 'smoothdown'],
    ['clock-wipe', 'radial'],
    [{ kind: 'cover', direction: 'from-top', durationMs: 800 }, 'coverdown'],
    [{ kind: 'reveal', direction: 'from-bottom' }, 'revealup'],
  ] satisfies Array<[SceneClip['transitionToNext'], string]>)(
    'maps advanced FFmpeg-native transition %j',
    (transitionToNext, expectedXfade) => {
      const args = buildMultiSceneRenderArgs({
        scenes: [
          imageScene('/workspace/a.png', 4, transitionToNext),
          imageScene('/workspace/b.png', 4),
        ],
        outputPath: '/workspace/out.mp4',
        aspectRatio: '16:9',
        mode: 'speed',
      });

      const filter = filterGraph(args);
      expect(filter).toContain(`xfade=transition=${expectedXfade}`);
      if (typeof transitionToNext === 'object' && transitionToNext.durationMs) {
        expect(filter).toContain(':duration=0.8:offset=3.2');
      }
    },
  );

  it.each([
    [{ kind: 'flip', direction: 'from-left' }, 'fade', 'fade', undefined],
    [{ kind: 'cube', direction: 'from-right' }, 'fade', 'fade', undefined],
    [
      { kind: 'pixelize', params: { steps: 12 } },
      'pixelize',
      'pixelize',
      ['steps'],
    ],
    [
      { kind: 'soft-wipe', params: { angle: 45 } },
      'wiperight',
      'wipe',
      ['angle'],
    ],
    ['polygon-iris', 'circleopen', 'iris', ['sides']],
    ['zoom-blur', 'fade', 'fade', undefined],
    ['zoom-in-out', 'circleopen', 'iris', undefined],
  ] satisfies Array<
    [SceneClip['transitionToNext'], string, string, string[] | undefined]
  >)(
    'falls back or degrades transition %j on FFmpeg',
    (
      transitionToNext,
      expectedXfade,
      expectedFallbackKind,
      expectedUnsupportedParams,
    ) => {
      const scenes = [
        imageScene('/workspace/a.png', 4, transitionToNext),
        imageScene('/workspace/b.png', 4),
      ];
      const args = buildMultiSceneRenderArgs({
        projectId: 'project-1',
        scenes,
        outputPath: '/workspace/out.mp4',
        aspectRatio: '16:9',
        mode: 'speed',
      });

      expect(filterGraph(args)).toContain(`xfade=transition=${expectedXfade}`);
      expect(transitionDegradationsForScenes(scenes, 'project-1')).toEqual([
        {
          seamIndex: 1,
          requestedKind:
            typeof transitionToNext === 'string'
              ? transitionToNext
              : transitionToNext.kind,
          fallbackKind: expectedFallbackKind,
          renderer: 'ffmpeg',
          projectId: 'project-1',
          ...(expectedUnsupportedParams
            ? { unsupportedParams: expectedUnsupportedParams }
            : {}),
        },
      ]);
    },
  );

  it('reports Remotion fallback degradations for unsupported params', () => {
    const scenes = [
      imageScene('/workspace/a.png', 4, {
        kind: 'pixelize',
        params: { steps: 12 },
      }),
      imageScene('/workspace/b.png', 4),
    ];

    expect(
      transitionDegradationsForScenes(scenes, 'project-1', 'remotion'),
    ).toEqual([
      {
        seamIndex: 1,
        requestedKind: 'pixelize',
        fallbackKind: 'dissolve',
        renderer: 'remotion',
        projectId: 'project-1',
        unsupportedParams: ['steps'],
      },
    ]);
  });

  it('selects FFmpeg for simple native transition renders', () => {
    expect(
      selectFinalRenderer({
        scenes: [
          imageScene('/workspace/a.png', 4, 'fade'),
          imageScene('/workspace/b.png', 4),
        ],
      }),
    ).toBe('ffmpeg');
    expect(
      selectFinalRenderer({
        scenes: [
          imageScene('/workspace/a.png', 4, 'pixelize'),
          imageScene('/workspace/b.png', 4),
        ],
      }),
    ).toBe('ffmpeg');
    expect(
      selectFinalRenderer({
        scenes: [
          imageScene('/workspace/a.png', 4, {
            kind: 'soft-wipe',
            params: { angle: 270, reverse: true },
          }),
          imageScene('/workspace/b.png', 4),
        ],
      }),
    ).toBe('ffmpeg');
  });

  it('selects WebCodecs when FFmpeg would degrade transition semantics', () => {
    expect(
      selectFinalRenderer({
        scenes: [
          imageScene('/workspace/a.png', 4, 'zoom-blur'),
          imageScene('/workspace/b.png', 4),
        ],
      }),
    ).toBe('webcodecs');
  });

  it('falls back to Remotion when automatic WebCodecs has no render host', () => {
    expect(
      selectFinalRenderer({
        scenes: [
          imageScene('/workspace/a.png', 4, 'zoom-blur'),
          imageScene('/workspace/b.png', 4),
        ],
        webCodecsHostAvailable: false,
      }),
    ).toBe('remotion');
  });

  it('selects WebCodecs for parameterized transitions that FFmpeg would degrade', () => {
    expect(
      selectFinalRenderer({
        scenes: [
          imageScene('/workspace/a.png', 4, {
            kind: 'pixelize',
            params: { steps: 12 },
          }),
          imageScene('/workspace/b.png', 4),
        ],
      }),
    ).toBe('webcodecs');
    expect(
      selectFinalRenderer({
        scenes: [
          imageScene('/workspace/a.png', 4, {
            kind: 'soft-wipe',
            params: { angle: 45 },
          }),
          imageScene('/workspace/b.png', 4),
        ],
      }),
    ).toBe('webcodecs');
    expect(
      selectFinalRenderer({
        scenes: [
          imageScene('/workspace/a.png', 4, {
            kind: 'polygon-iris',
            params: { sides: 5 },
          }),
          imageScene('/workspace/b.png', 4),
        ],
      }),
    ).toBe('webcodecs');
  });

  it('keeps FFmpeg for clock wipe because xfade has a radial native', () => {
    expect(
      selectFinalRenderer({
        scenes: [
          imageScene('/workspace/a.png', 4, 'clock-wipe'),
          imageScene('/workspace/b.png', 4),
        ],
      }),
    ).toBe('ffmpeg');
    expect(
      selectFinalRenderer({
        scenes: [
          imageScene('/workspace/a.png', 4, {
            kind: 'clock-wipe',
            params: { sectors: 4 },
          }),
          imageScene('/workspace/b.png', 4),
        ],
      }),
    ).toBe('webcodecs');
  });

  it('lets explicit and environment renderer overrides win', () => {
    const previous = process.env.NEUMA_VIDEO_FINAL_RENDERER;
    try {
      process.env.NEUMA_VIDEO_FINAL_RENDERER = 'ffmpeg';
      expect(
        selectFinalRenderer({
          scenes: [
            imageScene('/workspace/a.png', 4, 'cube'),
            imageScene('/workspace/b.png', 4),
          ],
        }),
      ).toBe('ffmpeg');

      process.env.NEUMA_VIDEO_FINAL_RENDERER = 'remotion';
      expect(selectFinalRenderer({ scenes: [] })).toBe('remotion');
      process.env.NEUMA_VIDEO_FINAL_RENDERER = 'webcodecs';
      expect(selectFinalRenderer({ scenes: [] })).toBe('webcodecs');
      expect(
        selectFinalRenderer({
          scenes: [
            imageScene('/workspace/a.png', 4, 'cube'),
            imageScene('/workspace/b.png', 4),
          ],
          webCodecsHostAvailable: false,
        }),
      ).toBe('webcodecs');
      expect(
        selectFinalRenderer({ opts: { renderer: 'ffmpeg' }, scenes: [] }),
      ).toBe('ffmpeg');
      expect(
        selectFinalRenderer({
          opts: { renderer: 'webcodecs' },
          scenes: [],
          webCodecsHostAvailable: false,
        }),
      ).toBe('webcodecs');
    } finally {
      if (previous === undefined) delete process.env.NEUMA_VIDEO_FINAL_RENDERER;
      else process.env.NEUMA_VIDEO_FINAL_RENDERER = previous;
    }
  });

  it('keeps image-pan scenes in the multi-scene graph', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [
        {
          ...imageScene('/workspace/a.png', 4, 'cut'),
          imagePan: {
            kind: 'image-pan',
            assetId: 'a',
            kenBurns: {
              from: { x: 0, y: 0, width: 1, height: 1 },
              to: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
            },
          },
        },
        videoScene('/workspace/b.mp4', 4, false),
      ],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'reproducible',
    });

    const filter = filterGraph(args);
    expect(filter).toContain("zoompan=z='1+(0.666667)*(on/119)'");
    expect(args).toContain('-bitexact');
    expect(args).toContain('+bitexact');
  });

  it('tone-maps HDR clips before scaling and transitions', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [
        {
          ...videoScene('/workspace/hdr.mov', 4, true, 'fade'),
          color: { colorTransfer: 'smpte2084' },
        },
        imageScene('/workspace/b.png', 4),
      ],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'speed',
    });

    const filter = filterGraph(args);
    expect(filter).toContain(
      '[0:v]zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,scale=1920:1080',
    );
    expect(filter).toContain(
      '[v0][v1]xfade=transition=fade:duration=0.5:offset=3.5[vjoin1]',
    );
  });

  it('applies scene reframe before transitions', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [
        {
          ...videoScene('/workspace/talking-head.mp4', 4, true, 'fade'),
          reframe: { aspect: '9:16', anchor: 'left' },
        },
        imageScene('/workspace/b.png', 4),
      ],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '9:16',
      mode: 'speed',
    });

    const filter = filterGraph(args);
    expect(filter).toContain(
      '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:min(max(0\\,0)\\,iw-ow):min(max((ih-oh)/2\\,0)\\,ih-oh),fps=30',
    );
    expect(filter).toContain(
      '[v0][v1]xfade=transition=fade:duration=0.5:offset=3.5[vjoin1]',
    );
  });

  it('applies conservative auto color before the final format', () => {
    const args = buildRenderArgs({
      inputPath: '/workspace/video.mp4',
      outputPath: '/workspace/out.mp4',
      assetKind: 'video',
      durationSec: 4,
      aspectRatio: '16:9',
      mode: 'speed',
      autoColorFilter: 'eq=contrast=1.1:brightness=0.02:saturation=1.05',
    });

    expect(args).toContain(
      [
        'eq=contrast=1.1:brightness=0.02:saturation=1.05',
        'scale=1920:1080:force_original_aspect_ratio=decrease',
        'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
        'fps=30',
        'setsar=1',
        'format=yuv420p',
        'setpts=PTS-STARTPTS',
      ].join(','),
    );
  });

  it('mixes storyboard music and narration under scene audio', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [videoScene('/workspace/a.mp4', 6, true)],
      audioTracks: [
        { inputPath: '/workspace/music.wav', role: 'music', volume: 0.25 },
        {
          inputPath: '/workspace/narration.wav',
          role: 'narration',
          volume: 1,
        },
      ],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'speed',
    });

    expect(args).toContain('/workspace/music.wav');
    expect(args).toContain('/workspace/narration.wav');
    const filter = filterGraph(args);
    expect(filter).toContain('volume=0.25');
    expect(filter).toContain('volume=1');
    expect(filter).toContain('amix=inputs=3:duration=first');
    expect(filter).toContain('alimiter=limit=0.95[aout]');
  });

  it('applies EDL timing, source trims, and fades to additional audio clips', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [videoScene('/workspace/a.mp4', 6, true)],
      audioTracks: [
        {
          inputPath: '/workspace/narration.wav',
          role: 'narration',
          volume: 1,
          timelineStartSec: 1.5,
          sourceStartSec: 1.25,
          durationSec: 2.5,
          fadeInMs: 30,
          fadeOutMs: 30,
        },
      ],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'speed',
    });

    const filter = filterGraph(args);
    expect(filter).toContain('atrim=start=1.25:duration=2.5');
    expect(filter).toContain('afade=t=in:st=0:d=0.03');
    expect(filter).toContain('afade=t=out:st=2.47:d=0.03');
    expect(filter).toContain('adelay=1500|1500');
    expect(filter).toContain('atrim=duration=6');
  });

  it('maps audio fade curves and volume keyframes in additional audio clips', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [videoScene('/workspace/a.mp4', 6, true)],
      audioTracks: [
        {
          inputPath: '/workspace/music.wav',
          role: 'music',
          volume: 1,
          trackVolumeDb: -6,
          durationSec: 4,
          fadeInMs: 1000,
          fadeInCurve: 'equal-power',
          fadeOutMs: 1000,
          fadeOutCurve: 'ease-in-out',
          keyframes: [
            {
              property: 'volumeDb',
              keys: [
                { atMs: 0, value: -12 },
                { atMs: 1000, value: -3, interp: 'smooth' },
                { atMs: 2000, value: -9, interp: 'hold' },
              ],
            },
          ],
        },
      ],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'speed',
    });

    const filter = filterGraph(args);
    expect(filter).toContain("volume='min(2\\,pow(10\\,(-6+if(lt(t\\,1)");
    expect(filter).toContain(':eval=frame');
    expect(filter).toContain('afade=t=in:st=0:d=1:curve=qsin');
    expect(filter).toContain('afade=t=out:st=3:d=1:curve=esin');
  });

  it('chains audio tempo filters outside the high-quality single-filter range', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [videoScene('/workspace/a.mp4', 6, true)],
      audioTracks: [
        {
          inputPath: '/workspace/narration.wav',
          role: 'narration',
          volume: 1,
          sourceStartSec: 0,
          durationSec: 1,
          playback: { speed: 8, reverse: false },
        },
      ],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'speed',
    });

    const filter = filterGraph(args);
    expect(filter).toContain(
      'atrim=start=0:duration=8,atempo=2,atempo=2,atempo=2,aformat=sample_rates=48000',
    );
  });

  it('applies final bookend fades after captions and audio mix in filtergraphs', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [videoScene('/workspace/a.mp4', 6, true)],
      audioTracks: [
        { inputPath: '/workspace/music.wav', role: 'music', volume: 0.5 },
      ],
      captionFilePath: '/workspace/captions.srt',
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'speed',
      introMs: 500,
      outroMs: 1000,
    });

    const filter = filterGraph(args);
    expect(filter).toContain(
      "[v0]subtitles=filename='/workspace/captions.srt'[vsub]",
    );
    expect(filter).toContain(
      '[vsub]fade=t=in:st=0:d=0.5,fade=t=out:st=5:d=1[vbookend]',
    );
    expect(filter).toContain(
      '[aout]afade=t=in:st=0:d=0.5,afade=t=out:st=5:d=1[abookend]',
    );
    expect(args).toContain('[vbookend]');
    expect(args).toContain('[abookend]');
  });

  it('burns caption files into the final video stream', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [imageScene('/workspace/a.png', 4)],
      captionFilePath: "/workspace/render's captions.srt",
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'speed',
    });

    const filter = filterGraph(args);
    expect(filter).toContain(
      "subtitles=filename='/workspace/render\\'s captions.srt'[vsub]",
    );
    expect(args).toContain('[vsub]');
  });

  it('places EDL overlays by source trim and PTS shift before captions', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [videoScene('/workspace/a.mp4', 6, true)],
      overlays: [
        overlayClip('/workspace/broll.mp4', {
          timelineStartSec: 3,
          sourceStartSec: 1.25,
          durationSec: 2,
          ptsShiftSec: 1.75,
        }),
      ],
      captionFilePath: '/workspace/captions.srt',
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'speed',
    });

    expect(args).toContain('/workspace/broll.mp4');
    const filter = filterGraph(args);
    expect(filter).toContain(
      '[1:v]trim=start=1.25:duration=2,scale=1920:1080:force_original_aspect_ratio=decrease',
    );
    expect(filter).toContain('format=yuva420p,setpts=PTS+1.75/TB[overlay0]');
    expect(filter).toContain(
      '[v0][overlay0]overlay=eof_action=pass:shortest=0:format=auto[voverlay0]',
    );
    expect(filter).toContain(
      "[voverlay0]subtitles=filename='/workspace/captions.srt'[vsub]",
    );
    expect(args).toContain('[vsub]');
  });

  it('retimes overlay playback before applying timeline PTS shift', () => {
    const args = buildMultiSceneRenderArgs({
      scenes: [videoScene('/workspace/a.mp4', 6, true)],
      overlays: [
        overlayClip('/workspace/broll.mp4', {
          timelineStartSec: 3,
          sourceStartSec: 1.25,
          durationSec: 2,
          playback: { speed: 2, reverse: true },
          ptsShiftSec: 1.75,
        }),
      ],
      outputPath: '/workspace/out.mp4',
      aspectRatio: '16:9',
      mode: 'speed',
    });

    const filter = filterGraph(args);
    expect(filter).toContain(
      '[1:v]trim=start=1.25:duration=4,reverse,scale=1920:1080:force_original_aspect_ratio=decrease',
    );
    expect(filter).toContain(
      'format=yuva420p,setpts=(PTS-STARTPTS)/2,setpts=PTS+3/TB[overlay0]',
    );
  });

  it('builds caption sidecars from timeline captions instead of storyboard order', () => {
    const project = timelineCaptionProject();

    expect(timelineCaptionSubtitles(project)).toEqual([
      {
        index: 1,
        startMs: 1200,
        endMs: 3000,
        text: 'Timeline caption',
      },
    ]);
    expect(buildCaptionSidecarSrt(project)).toBe(
      '1\n00:00:01,200 --> 00:00:03,000\nTimeline caption\n',
    );
  });
});

function imageScene(
  inputPath: string,
  durationSec: number,
  transitionToNext?: SceneClip['transitionToNext'],
): SceneClip {
  return {
    inputPath,
    durationSec,
    kind: 'image',
    transitionToNext,
  };
}

function videoScene(
  inputPath: string,
  durationSec: number,
  hasAudio: boolean,
  transitionToNext?: SceneClip['transitionToNext'],
): SceneClip {
  return {
    inputPath,
    durationSec,
    kind: 'video',
    hasAudio,
    transitionToNext,
  };
}

function overlayClip(
  inputPath: string,
  overrides: Partial<OverlayClip> = {},
): OverlayClip {
  return {
    inputPath,
    kind: 'broll',
    mediaKind: 'video',
    timelineStartSec: 0,
    sourceStartSec: 0,
    durationSec: 1,
    ptsShiftSec: 0,
    ...overrides,
  };
}

function filterGraph(args: string[]): string {
  const index = args.indexOf('-filter_complex');
  expect(index).toBeGreaterThanOrEqual(0);
  return args[index + 1]!;
}

function timelineCaptionProject(): VideoProject {
  return {
    id: 'project-1',
    name: 'Timeline captions',
    template: 'explainer',
    prompt: 'Render timeline captions',
    assets: [],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    scenes: [],
    storyboard: {
      status: 'approved',
      intent: 'Storyboard captions',
      totalDurationMs: 5000,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 5000,
          intent: 'Scene one',
          caption: { text: 'Storyboard caption' },
          assetPlan: { kind: 'ai-image', prompt: 'Scene image' },
        },
      ],
    },
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 5000,
      fps: 30,
      tracks: [
        {
          id: 'track-caption-main',
          kind: 'caption',
          name: 'Captions',
          muted: false,
          locked: false,
          order: 30,
          clips: [
            {
              id: 'clip-caption-scene-1',
              kind: 'caption',
              name: 'Caption',
              sourceRef: { kind: 'scene', sceneId: 'scene-1' },
              sceneId: 'scene-1',
              startMs: 1200,
              durationMs: 1800,
              trimStartMs: 0,
              trimEndMs: 1800,
              text: ' Timeline caption ',
            },
          ],
        },
      ],
    },
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  };
}
