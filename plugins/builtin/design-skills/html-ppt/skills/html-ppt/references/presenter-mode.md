# Presenter Mode Guide

This guide explains how to build an html-ppt deck with presenter mode and
speaker notes.

## When To Use Presenter Mode

Prefer presenter mode when the user needs any of the following:

- A live talk, training session, conference talk, workshop, or roadshow.
- Speaker notes, presenter view, a teleprompter-style helper, or a talk script.
- A 30-minute, 45-minute, or 1-hour presentation where pacing matters.
- A deck for someone who is worried about forgetting transitions.

If the user only wants a static visual deck, social carousel, product lookbook,
or report they will not present live, presenter mode is optional.

## Recommended Path

Use the ready-made `presenter-mode-reveal` template:

```bash
cp -r templates/full-decks/presenter-mode-reveal examples/my-talk
open examples/my-talk/index.html
```

That template already includes:

- `S` key presenter mode.
- `T` key theme cycling across five themes.
- Arrow-key slide navigation.
- 150-300 word sample notes on every slide.
- Footer keyboard hints.

Edit the content and notes directly.

## Add Presenter Mode To Another Template

Presenter mode is built into `runtime.js`, so every full-deck template can use
it. You only need two things:

1. Add `<aside class="notes">` or `<div class="notes">` at the end of every
   slide.
2. Make sure the HTML imports `assets/runtime.js`.

```html
<section class="slide">
  <h2>Your title</h2>
  <p>Audience-facing content...</p>

  <aside class="notes">
    <p>Write the speaker notes here, usually 150-300 words.</p>
  </aside>
</section>
```

## Speaker Script Rules

### Rule 1: Prompt Signals, Not A Script To Read

Avoid long blocks that feel like a formal article. Speaker notes should be
scannable prompts.

Bad:

```html
<p>Welcome to today's presentation. Today I will introduce the work our team
completed over the past three months. First, we will review the background...</p>
```

Good:

```html
<p>Welcome. Today is about the team's work from the <strong>past 3 months</strong>.</p>
<p>Start with the <em>background</em>: three pain points showed up first:
high latency, high cost, and weak stability.</p>
<p>Then walk through how each one was solved.</p>
```

The good version bolds keywords and gives each transition its own paragraph.

### Rule 2: 150-300 Words Per Slide

- Fewer than 150 words often leaves too little guidance.
- More than 300 words is too much to scan while presenting.
- 2-3 minutes per slide is the comfortable pace.

### Rule 3: Conversational Language

Write the way someone would speak. Prefer direct, natural wording over formal
prose. Read the notes aloud once before finalizing.

## Required HTML Structure

```html
<div class="deck" data-themes="tokyo-night,dracula,corporate-clean">
  <section class="slide" data-title="Opening">
    <h1>Your title</h1>
    <p>Subtitle</p>

    <aside class="notes">
      <p>Speaker paragraph 1 with <strong>bold keywords</strong>.</p>
      <p>Speaker paragraph 2 with a clear transition.</p>
      <p>Speaker paragraph 3 that leads into the next slide.</p>
    </aside>
  </section>
</div>

<script src="../../../assets/runtime.js"></script>
```

## Presenter Window

Press `S` to open a separate presenter window while the original page remains
the audience view. The presenter window contains four independent magnetic
cards:

```text
Audience window                 Presenter window
┌──────────────────┐           ┌───────────────┐ ┌───────────────┐
│ Normal slide     │  syncs    │ CURRENT       │ │ NEXT          │
│ Fullscreen view  │  with     │ iframe preview│ │ iframe preview│
└──────────────────┘           ├───────────────┤ ├───────────────┤
                               │ TIMER         │ │ SPEAKER SCRIPT│
                               │ elapsed time  │ │ scrollable    │
                               └───────────────┘ └───────────────┘
```

Card behavior:

- Drag a card header to move the card.
- Drag the bottom-right handle to resize it.
- Positions and sizes are saved to `localStorage`.
- The "Reset layout" button restores the default arrangement.

Card contents:

- **CURRENT** — pixel-perfect preview of the active slide, loaded through the
  same deck HTML with `?preview=N`.
- **NEXT** — pixel-perfect preview of the next slide.
- **SPEAKER SCRIPT** — scrollable speaker notes with inline formatting.
- **TIMER** — elapsed time, slide counter, and navigation buttons.

The two windows stay in sync through `BroadcastChannel`. Preview iframes load
once, then slide changes use `postMessage({ type: 'preview-goto', idx: N })`,
so presenter previews do not reload or flash.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `S` | Open presenter window |
| `←` `→` / Space / PgDn | Navigate slides |
| `T` | Cycle theme |
| `R` | Reset timer in presenter mode |
| `F` | Fullscreen |
| `O` | Overview |
| `Esc` | Close overlays |

## Dual-Screen Flow

1. Open `index.html` and press `S`.
2. Move the audience window to the projector or external display and press `F`.
3. Keep the presenter window on the speaker's screen.
4. Navigate in either window; both stay synchronized.
5. Use the presenter window for notes, next-slide preview, and elapsed time.

## Common Mistakes

### Putting Speaker Notes On The Visible Slide

Bad:

```html
<p>Say this part, then explain the case study...</p>
```

Good:

```html
<aside class="notes">
  <p>Say this part, then explain the case study...</p>
</aside>
```

The `.notes` class is hidden by default and only appears in presenter mode.

### Forgetting `runtime.js`

Without `<script src="../../../assets/runtime.js"></script>`, the deck has no
`S` key, no presenter window, and no keyboard navigation.

### Writing Formal Notes

If the notes sound like an essay when read aloud, rewrite them as direct
speaking prompts.

### Writing Too Little Or Too Much

Each slide should usually have 150-300 words of notes. Shorter notes are easy
to forget; longer notes are hard to scan live.

## AI Prompt For Speaker Notes

> For each slide, write 150-300 words of speaker notes inside
> `<aside class="notes">`. Use conversational language, bold core keywords
> with `<strong>`, put transitions in separate short paragraphs, make the text
> sound spoken rather than formal, and end each slide with a natural bridge to
> the next one.

## Recommended Pairings

- **Themes:** `tokyo-night` for technical talks, `corporate-clean` for business
  reports, `dracula` as a dark alternative.
- **Fonts:** the default Noto Sans + JetBrains Mono stack usually works.
- **Animations:** use restrained effects such as `fade-up` or `rise-in`.
- **Length:** 30 minutes = 8-12 slides; 45 minutes = 12-16 slides; 1 hour =
  16-22 slides.
