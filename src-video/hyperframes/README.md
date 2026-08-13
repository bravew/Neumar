# Docs Demo HyperFrames Projects

Each docs demo slot has a generated HyperFrames project at:

```text
src-video/hyperframes/<page>/<slot>/
```

Expected structure:

```text
index.html
hyperframes.json
assets/
  source.webm
snapshots/
```

`scripts/render-docs.ts` creates and refreshes `index.html` whenever a video
spec sets `renderer.hyperframes.generatedProject: true`. Raw recordings are
copied from
`src-video/public/docs/raw/<page>/<slot>/source.webm` into `assets/` before
lint, snapshot, or render commands run.

## Camera Rig

Generated projects use a fixed camera layer:

- `.camera` is the overflow-hidden viewport.
- `.recording` is the raw capture and is animated with GSAP `scale`, `x`, and
  `y` only. Width and height are never animated.
- `.cursor` and `.pulse` are separate overlay layers so click focus can be
  re-timed without re-capturing the source video.
- `.annotation` is a short callout tied to a single hold beat.

Camera moves are driven from `entry.camera.zooms` in `src-video/docs.config.ts`.
Use eased 500-800 ms moves, 800-1500 ms holds, and zoom levels between `1.08`
and `1.25` for normal UI. Use up to `1.35` only for dense forms or small text.
Avoid `back`, `elastic`, and `bounce` easings for product demos.

Use the pinned local binary:

```bash
pnpm --filter @neumar/video docs:render -- --only=projects.create --renderer=hyperframes --quality=draft
```

For CI/final validation, pass `--ci`; the renderer will use Docker when the
slot config requires it.

## Snapshot Review

Every primary HyperFrames entry must define `snapshotAtMs`. Review the generated
PNG snapshots before promoting a render to docs:

- focal points align with the UI action being demonstrated
- text remains sharp at maximum zoom
- cursor and pulse do not cover important labels
- no workspace paths, credentials, email addresses, or account identifiers are
  visible

## Rollback

To roll back a docs demo:

1. Remove the `{% demo id="..." /%}` or `{% figure id="..." /%}` tag from every
   locale `.mdoc` file.
2. Set the matching `docs.config.ts` entry to `priority: 'defer'` or remove it.
3. Run `pnpm --filter @neumar/video docs:check`.
4. Delete public files only after a release ships without references to that
   media ID.
