# Full-Deck Templates

Self-contained multi-slide HTML decks live under
`templates/full-decks/<name>/`. Each folder contains:

- `index.html` — complete multi-slide deck.
- `style.css` — scoped with a `.tpl-<name>` class prefix.
- `README.md` — short rationale, inspiration, and use guidance.

All templates pull shared `assets/fonts.css`, `assets/base.css`, and
`assets/runtime.js` from the skill root. Navigate with `← →` / Space, use `F`
for fullscreen, and use `O` for overview.

Use these when you want a coherent, opinionated look for an entire deck rather
than a mix-and-match set of layouts.

## Extracted Looks

### 1. `xhs-white-editorial` — White Editorial Social Style

- **Source inspiration:** editorial social posts and AI testing safety decks.
- **Key traits:** pure-white background, rainbow top bar, large display
  headlines, gradient text, soft macaron cards, focus pills, and a hero quote
  box.
- **When to use:** social carousel decks, dense text with strong emphasis, and
  editorial lifestyle content.
- **Path:** `templates/full-decks/xhs-white-editorial/index.html`

### 2. `graphify-dark-graph` — Dark Knowledge Graph

- **Source inspiration:** Graphify-style knowledge graph presentations.
- **Key traits:** deep-night gradient, drifting blur orbs, SVG force graph
  overlay, rainbow gradient headlines, command-line glow, and glass cards.
- **When to use:** dev tools, CLI products, knowledge graphs, and data
  visualization launches.
- **Path:** `templates/full-decks/graphify-dark-graph/index.html`

### 3. `knowledge-arch-blueprint` — Cream Blueprint Architecture

- **Source inspiration:** architecture diagrams and knowledge-system maps.
- **Key traits:** cream paper base, rust accent, blueprint grid mask, hard
  border cards, pipeline boxes, insight callouts, serif numbers, and dashed
  feedback-loop arrows.
- **When to use:** system architecture diagrams, data-flow maps, engineering
  white papers, and printable technical decks.
- **Path:** `templates/full-decks/knowledge-arch-blueprint/index.html`

### 4. `hermes-cyber-terminal` — Dark Terminal Review

- **Source inspiration:** CLI agent reviews and benchmark traces.
- **Key traits:** black terminal base, cyber grid, CRT vignette, scanlines,
  command-line headlines, mint-green glow text, JetBrains Mono, bar charts, and
  dark code blocks.
- **When to use:** reviews of CLI tools, agents, developer tools, traces, diffs,
  and benchmarks.
- **Path:** `templates/full-decks/hermes-cyber-terminal/index.html`

### 5. `obsidian-claude-gradient` — GitHub Dark Purple Gradient

- **Source inspiration:** developer workflow and AI-tool tutorial decks.
- **Key traits:** GitHub-dark base, purple/blue radial ambient light, masked
  grid, centered layout, purple pill tags, gradient text, and code-oriented
  highlight blocks.
- **When to use:** developer workflow, MCP, agent, or dev-tool tutorials.
- **Path:** `templates/full-decks/obsidian-claude-gradient/index.html`

### 6. `testing-safety-alert` — Red Amber Alert

- **Source inspiration:** AI testing and safety review decks.
- **Key traits:** red-black hazard stripes, red negation headlines, tier cards,
  alert boxes, policy-style code blocks, red/green checklists, and incident bar
  charts.
- **When to use:** safety, risk, incident postmortems, red-team reviews,
  pre-launch AI reviews, and policy-as-code.
- **Path:** `templates/full-decks/testing-safety-alert/index.html`

### 7. `xhs-pastel-card` — Soft Pastel Carousel

- **Source inspiration:** pastel lifestyle and personal-growth carousels.
- **Key traits:** cream base, soft blurred blobs, italic serif display
  headlines, rounded macaron cards, serif numerals, donut chart, and chip
  topbar.
- **When to use:** lifestyle, personal growth, slow-living, and emotionally soft
  content.
- **Path:** `templates/full-decks/xhs-pastel-card/index.html`

### 8. `dir-key-nav-minimal` — Arrow-Key Minimalism

- **Source inspiration:** one-idea-per-slide keynote decks.
- **Key traits:** each slide has a mono background, oversized display type,
  compact accent divider, arrow-prefixed lists, keyboard hints, and generous
  negative space.
- **When to use:** minimalist talks, launches, and public presentations where
  each slide carries one focused idea.
- **Path:** `templates/full-decks/dir-key-nav-minimal/index.html`

## Scenario Decks

These are generic scaffolds for common presentation jobs. Each is visually
distinctive and content-rich out of the box.

| # | Name | Slides | Feel | When to use |
|---|---|---|---|---|
| 9 | `pitch-deck` | 10 | White + blue-purple gradient, YC/VC vibe, big numbers, traction chart | Fundraising, startup pitch, investor meeting |
| 10 | `product-launch` | 8 | Dark hero + light content, warm orange-peach accent, feature cards, pricing tiers, CTA | Product announcements and launch keynotes |
| 11 | `tech-sharing` | 8 | GitHub-dark, JetBrains Mono, terminal code blocks, agenda + Q&A | Internal technical talks and conference talks |
| 12 | `weekly-report` | 7 | Corporate clarity, KPI grid, shipped list, bar chart, next-week table | Team status updates and business reviews |
| 13 | `xhs-post` | 9 | 3:4 at 810x1080, warm pastel, dashed sticker cards, page dots | Social carousels and Instagram-style posts |
| 14 | `course-module` | 7 | Warm paper, Playfair serif, learning-objective sidebar, MCQ self-check | Online courses and workshop modules |
| 15 | `presenter-mode-reveal` | 6 | Presenter mode, Tokyo Night default, five-theme cycle, speaker-note examples | Talks, classes, and live presentations that need `S` key speaker notes |

Each folder has `index.html`, scoped `style.css`, and `README.md`. The
`xhs-post` template overrides the default `.slide` box to fixed `810x1080` for
3:4 portrait output.

For any live presentation, start with `presenter-mode-reveal` or follow
[presenter-mode.md](./presenter-mode.md) to add `<aside class="notes">` to a
different template.

## Authoring Notes

- Every template scopes its CSS under `.tpl-<name>` so multiple templates can
  load on the same page without collisions.
- Swap demo content, but keep the structural classes because they define each
  template's identity.
- Shared runtime (`assets/runtime.js`) provides keyboard navigation,
  fullscreen, overview grid, and theme cycling.
- Charts are hand-rolled SVG with no CDN dependency. Replace them with Chart.js
  or ECharts only when interactive data is required.
