# Marketing Hub: design system (MASTER), v2 "Picsart Academy brand"

> Source of truth for every screen in `frontend/`. Before building a page, check `design-system/marketing-hub/pages/<page>.md`; if it exists, its rules override this file. Otherwise follow this file.
>
> Code: tokens `src/styles/tokens.css`, base `src/styles/base.css`, components `src/styles/components.css` + `src/ui/*`. Live preview: `#/design-system`.

v3 (2026-11-22, RESTRUCTURE R1): the same visual style in a dense analytics layout: left grouped navigation, full-width 12-column pages, filter panel, chart cards with a Table view, one chart library (Recharts). Structure follows `docs/references/analytics-ref/`; its blue accent is not used. v2.1 (2026-11-20): motion and interaction (section 6), brighter colors, official logo. v2 (2026-11-20) replaces the first "Swiss minimal blue" system at the user's request. It follows the references in `docs/references/` (`concept.png`, `tables.png`, brand colors, logo): style and principles, not a pixel copy. Built with `ui-ux-pro-max` (typography and font lookups, UX and chart rules) and checked against PRD 9.6, 13.6, 13.7 and 14.5.

## 1. Direction

- **Mood:** bold brand product, not a grey admin panel. Near-black surfaces, three saturated brand colors used as large flat fills, heavy geometric type, big radii, everything interactive is a pill.
- **Dark first.** Dark is the default theme; light is opt-in (theme switch: dark / light / system). Both are contrast-checked.
- **Color is loud but rationed:** per view, at most one row of brand-filled highlight cards and one brand-filled tile. Everything else sits on dark surfaces; data stays neutral (white/grey numbers).
- **Density:** comfortable around data, dense inside it. Generous card padding (24px) and section gaps (32px); tables keep 44px rows and 14px text. The Overview must still fit a 1366×768 laptop without scrolling (13.7): tiles + channel table, highlight cards optional there.
- **Languages:** staff UI in English and Armenian, public pages hy/en/ru. Components wrap long Armenian/Russian strings; nothing truncates silently.

## 2. Color

### Brand (same in both themes)

| Token | Hex | Role | Text on it |
|---|---|---|---|
| `--brand-yellow` | `#FFDC00` | primary button, active nav pill, counters, brand badges, search icon, one highlight tile | ink `#131317` |
| `--brand-aqua` | `#70FFE9` | selected chip / toggle, info, links (dark), focus ring (dark), highlight card | ink |
| `--brand-magenta` | `#D400C7` | highlight card only | white (4.54:1) |
| `--brand-ink` | `#131317` | text on brand fills, icon tiles | — |
| `--gradient-brand` | aqua → lilac → pink → yellow | one accent word in a page title (`PageHeader accent`), display size only | — |
| `--gradient-glow` | yellow → green → aqua | border of the hero search field | — |

Sampled from the references: magenta `#D400C7`, aqua `#70FFE9`, yellow `#FFDC00`, page `#151517`, panel `#1B1B1E`, nav bar `#232325`, chip `#2B2B2F`, divider `#272729`, muted text `#B3B9C7`.

### Semantic tokens

| Token | Dark (default) | Light | Use |
|---|---|---|---|
| `--color-bg` | `#141416` | `#F6F5FA` | page |
| `--color-surface` | `#1C1C21` | `#FFFFFF` | cards, tables, panels |
| `--color-surface-raised` | `#26262C` | `#F0EEF7` | nav bar, inputs, inset boxes, row hover |
| `--color-surface-chip` | `#303037` | `#E7E4F2` | chips, tags, hover |
| `--color-text` | `#FFFFFF` | `#121216` | text, numbers |
| `--color-text-muted` | `#C8CEDB` | `#43465A` | secondary text |
| `--color-text-subtle` | `#A6ACBB` | `#575B70` | helper text, table headers |
| `--color-border` | `#313138` | `#E0DDEB` | card outlines, dividers (decorative) |
| `--color-border-strong` | `#787C88` | `#7F8296` | input and control boundaries (≥3:1) |
| `--color-primary` / `--color-on-primary` | yellow / ink | yellow / ink | primary fills |
| `--color-primary-edge` | transparent | ink | edge on yellow/aqua states in light theme (fills alone are ~1.2:1 on white) |
| `--color-primary-text` | `#FFE433` | `#765C00` | yellow as text/icon (active sort, empty-state icon) |
| `--color-secondary` / `-text` | aqua / `#7DFFEC` | aqua / `#00786A` | selection; aqua as text |
| `--color-tertiary-text` | `#FF70F8` | `#B000A6` | magenta as text |
| `--color-link` | `#7DFFEC` | `#B000A6` | links |
| `--color-success` / `-soft` | `#5CF59B` / `#123A23` | `#0E7A36` / `#D9F7E4` | pass, delivered, up |
| `--color-warning` / `-soft` | `#FFB547` / `#3D2A0C` | `#B04A00` / `#FFEBD1` | maturing, warm-up, stale |
| `--color-danger` / `-soft` | `#FF8F8F` / `#451A1F` | `#C8102E` / `#FFE3E6` | errors, destructive |
| `--color-ring` | `#7DFFEC` | `#B000A6` | focus ring (ink or white inside brand cards) |

**v2.1 "brighter":** brand fills stay at the exact logo colors (a brighter magenta would drop white text below 4.5:1). The extra brightness comes from pure-white text, lighter muted text, more saturated status colors and tints, slightly lifted surfaces with a hint of violet in light theme, and colored hover glows (`--glow-primary/-aqua/-magenta`).

Yellow is the brand primary, so **warning is orange**, never yellow. Status is always icon + text (14.5).

**Verified (WCAG 2.1 AA):** every text pair ≥4.5:1 in both themes, controls and focus ≥3:1. Lowest: white on magenta 4.54, light text pairs ≥4.72, dark pairs ≥6.62. Gradient title stops: dark ≥6.9:1, light ≥3.96:1, so the gradient is allowed **only at display size** (large-text rule).

### Charts

| Token | Dark | Light | Line style |
|---|---|---|---|
| `--chart-1` | `#FFE433` | `#8A6A00` | solid |
| `--chart-2` | `#7DFFEC` | `#00786A` | dashed `6 4` |
| `--chart-3` | `#FF70F8` | `#B000A6` | dotted `2 3` |
| `--chart-4` | `#5CF59B` | `#0E7A36` | dash-dot |
| `--chart-5` | `#FFB547` | `#C2410C` | long dash |
| `--chart-6` | `#B4BEFF` | `#4F46E5` | solid + square markers |

Gridlines `--chart-grid`. Bars and lines in the brand colors on dark cards, like the "Growth" card in `tables.png`. Every chart has a table alternative and a one-sentence summary.

**Library:** Recharts 3 for every chart (`src/charts`: bar vertical and horizontal, multi-line, funnel, donut ≤6 slices, sparkline). Colours only from these tokens, so both themes stay checked; lines also differ by dash; the funnel prints values and conversion as text; the donut lists value and share. The module is loaded only by lazy pages (never in the main bundle); animation follows reduced motion.

## 3. Typography

- **Manrope Variable** (Latin, Cyrillic) → **Noto Sans Armenian Variable** (Armenian) → system UI. Self-hosted via `@fontsource-variable/*`, no Google Fonts CDN (NFR-P7). No single Google font covers Latin + Cyrillic + Armenian; Manrope is the closest geometric match to the concept, Noto Sans Armenian renders Armenian.
- Body weight is **medium (500)**; the concept never uses thin text on dark.
- Numbers: `tabular-nums` in tables, tiles, counters.

| Token | Size | Weight | Use |
|---|---|---|---|
| `--text-display` | 36–52px fluid | 800 | page title (h1) |
| `--text-2xl` | 36px | 800 | tile values |
| `--text-xl` | 28px | 800 | section titles, highlight card titles, dialog title |
| `--text-lg` | 20px | 700 | card titles |
| `--text-md` | 16px | 500 | body, inputs |
| `--text-sm` | 14px | 600 | tables, nav, buttons, helper text |
| `--text-xs` | 12px | 700 | badges, tags |
| `--text-2xs` | 11px | 700 uppercase, tracking 0.08em | eyebrow labels, table headers |

## 4. Shape, spacing, elevation

- **Radius:** `--radius-sm` 8 (tags, kbd), `--radius-md` 12 (inputs, icon tiles), `--radius-lg` 18 (tables, inset boxes, alerts, search), `--radius-xl` 24 (cards, tiles, dialogs), `--radius-pill` (buttons, chips, nav, badges, segmented controls).
- **Spacing:** 4px grid (`--space-1`…`--space-12`). Card padding 24, card gap 16, section gap 32, page gutters 16 / 24 / 40.
- **Elevation:** flat at rest. Cards = surface + 1px border. Hover on interactive elements adds lift + `--shadow-hover`; brand cards and the active nav pill get a colored glow. Big shadow only on overlays (dialog, menu, tooltip).
- **Layers:** sticky 10, header/nav 20, overlay 40, dialog 100, toast 1000.

## 5. Layout and navigation

- **Left sidebar** (RESTRUCTURE §3), groups in this order: MEASURE (Overview, Cohorts, Costs, Campaigns & links, Data health), REACH (Contacts, Segments, Audience health, Events), SEND (Newsletter, Campaign emails, Dev inbox only in dev/demo), SETTINGS (Email settings, Alerts with a count badge of unresolved alerts, Admin). Config: `src/lib/routes.ts`; old addresses (`#/audience…`, `#/campaigns…`, `#/analytics/…`) redirect there.
- Top of the sidebar: logo + "Picsart Academy / MARKETING HUB" and the collapse toggle. Bottom: role (mock sign-in until the Core Engine), language (Հայերեն / English / Русский), theme, Sign out (disabled until the Core Engine sign-in). Active item = yellow fill with ink text, filled icon, `aria-current="page"`.
- Collapsed (remembered in `localStorage`): icons only with their names as titles, group labels become dividers, the alerts badge sits on the icon. Below 1024px the sidebar becomes a slide-in menu behind a burger in the top bar (scrim, Escape closes, focus returns to the burger).
- Thin sticky **top bar**: links "Public sign-up form" (when `VITE_PUBLIC_SIGNUP_URL` is set) and "Newsletter archive", both open in a new tab.
- Content: full width up to 1680px on a 12-column grid (`.grid-12`, `.span-3/4/6/8/12`), stacked on narrow screens. Page: gradient title + one-line description + actions right → sticky filter panel → tiles → tables and chart cards.
- Shell and new component strings exist in hy, en and ru (`src/lib/i18n.ts`); older page texts are translated when their step rebuilds them.
- Logo: official cube from `docs/references/picsart-academy-logo.webp` (transparent), copied to `src/assets/` and `public/favicon.webp`. Shown next to the text "Picsart Academy / MARKETING HUB" (its built-in wordmark is unreadable at that size), `alt=""` because the text names it. Below 420px only the cube shows.

## 6. Motion and interaction

**Principle.** Motion explains a change: what is clickable (hover lift), where something came from (menus grow from their button, dialogs rise), how a number got there (count-up, growing bars). Decorative effects (tilt, spotlight, rainbow) live only on a few large brand elements. Tables, forms and long lists stay still apart from a color change on hover: people read and compare data there, and rows can number in the thousands.

**Tools.** CSS for everything simple (hover, press, focus, dialog enter/exit via `@starting-style`, disclosure chevron, skeleton shimmer, rainbow). **Motion** (`motion` 14, `LazyMotion` + `domAnimation`, components as `m.*`) for: page transitions (`AnimatePresence`), reveal on load/scroll with stagger, pointer tilt (springs), count-up (`animate`), chart grow/draw, menu and disclosure enter/exit. Lifts use the separate `translate`/`scale` CSS properties so they compose with Motion's inline `transform`.

### Tokens (CSS in `tokens.css`, mirrored for Motion in `src/lib/motion.ts`)

| Token | Value | Use |
|---|---|---|
| `--duration-instant` | 100ms | press, small color changes |
| `--duration-fast` | 150ms | hover: buttons, chips, nav, table rows; exit of menus |
| `--duration-base` | 200ms | card lift, menus, tooltips, page change |
| `--duration-moderate` | 250ms | dialogs, disclosure |
| `--duration-slow` | 400ms | reveal of sections and cards |
| `--duration-counter` | 900ms | count-up, bar grow, line draw (×1.2) |
| `--duration-shimmer` / `--duration-rainbow` | 1.4s / 3s | skeleton loop / rainbow loop |
| `--ease-standard` | `cubic-bezier(0.2,0,0,1)` | state changes |
| `--ease-enter` / `--ease-exit` | decelerate / accelerate | arriving / leaving; exit ≈ 70% of enter |
| `--ease-emphasized` | slight overshoot | lifts, arrow nudge, logo |
| `--stagger-step` | 40ms | delay between siblings |
| `--lift-sm` / `--lift-md` | −1px / −3px | buttons, chips / interactive cards |
| `--press-scale` | 0.97 | press |
| `--reveal-distance` | 12px | reveal slide |
| `--tilt-max` | 6° (tiles 4°) | pointer tilt |

### Where each effect is used

| Effect | Used on | Not used on (why) |
|---|---|---|
| Hover lift + shadow/glow | buttons, chips, interactive cards, highlight cards, logo | table rows (color only: no layout or GPU churn on big tables), form fields (border/glow only) |
| Pointer tilt + spotlight | highlight cards, KPI tiles (`<Tilt>`); spotlight only on interactive item cards | tables, forms, text blocks (tilt hurts reading); touch devices (no hover) |
| Reveal on load/scroll (fade + 12px slide, stagger 40ms, once) | page sections, card grids, highlight row | table rows, list items, form fields (would delay data the user came for) |
| Page change | crossfade + 6px rise, 200ms in / 140ms out, focus moves to `<main>` | — |
| Disclosure, menu, dialog | grow from trigger / height + fade / rise + scale with blurred scrim | — |
| Count-up | KPI tiles only, once when visible; screen readers get only the final value | table cells, totals, anything compared side by side |
| Chart grow/draw | bars grow from baseline (staggered), line draws, end point pops | data tables under charts |
| Rainbow border | the main search field only (one per page) | any other input or card |
| Skeleton | anything loading >300ms, same footprint as the final content (tiles, cards, table rows) | instant (<300ms) data: no flash |

### Reduced motion (PRD 14.5)

`prefers-reduced-motion: reduce` (or the "Reduce motion" preview chip on `/design-system`, which sets `data-motion="reduce"`) makes all durations 1ms, distances 0, `MotionConfig reducedMotion="always"`, disables tilt and spotlight, shows final numbers immediately, renders charts static, and stops loops (rainbow, shimmer, spinner) on a static frame. Verified in Chrome with emulated `prefers-reduced-motion`.

### Performance

No React re-render on pointer move (CSS variables + Motion values) or during count-up (direct DOM write). Pointer effects are throttled to one update per frame and only exist on a handful of cards. Motion adds ~40 KB gzip to the main bundle; the `/design-system` page is a lazy chunk.

## 7. Components (`src/ui`)

| Component | Rules |
|---|---|
| `AppShell`, `PageHeader`, `SectionTitle` | As in section 5. `PageHeader accent` renders one gradient word. `SectionTitle` = 28px heavy title + optional yellow counter badge, divider below. Focus moves to `<main>` on route change; skip link first. |
| `HighlightCard` | Brand-filled (`yellow`, `aqua`, `magenta`) link card: brand badge, big title (the link, whole card clickable), one-line description, round arrow. Max one row of 2–4 per page. |
| Card (`.card`) | Surface, 1px border, radius 24, padding 24. Brand variants `.card--yellow/aqua/magenta` switch all text to ink (white on magenta). Anatomy for item cards: badge row → icon tile + eyebrow + title → text → tags → `.inset` box with status and action → footer strip. |
| `StatTile` | Label + definition tooltip (hover **and** focus, Escape closes), 36px value, optional caption under it (what the number covers) and sparkline, delta pill (sign + arrow + text for screen readers), "See data" link (ANL-15), "fewer than 3" for small numbers (ANL-14). `tone="yellow"` for the single most important tile. |
| `FilterBar` + `PeriodFilter`, `AttributionFilter`, `ViewToggle` | Sticky panel under the top bar. Presets 30 days, 90 days, Last quarter, This year, 12 months, Custom (two dates); attribution First touch / Last touch before application / Position-based 40/20/40; Period / Cohort switch with its explanation. |
| `ChartCard` | Card with title, optional definition (i), Chart / Table switch showing the same data as a `DataTable`, one-sentence summary as `figcaption`; skeleton of the chart's height while loading, empty state instead of an empty axis frame. |
| `Modal`, `Drawer` | Native `<dialog>`: title, close button, Escape and backdrop close, focus returns to the trigger. Modal for short tasks; drawer slides in from the right for details and forms that keep the list in view. |
| `DataTable` | Real `<table>` with caption; uppercase 11px headers on the surface; first column bold white, numbers right-aligned tabular; 44px rows, hover raised; total row in `tfoot` on raised surface (`totals` builds it from the columns); optional inline bar next to the key metric (`bar`), scaled to the largest row; `pageSize` splits long lists into pages; sortable headers as buttons with `aria-sort`, active sort in yellow; scroll wrapper (radius 18) on narrow screens; loading/empty/error inside the body. |
| `Button` | Pills. `primary` yellow/ink (one per view), `secondary` raised + strong border, `ghost`, `danger`. Inside brand cards `primary` becomes an ink pill with yellow text. `loading` = spinner + disabled. |
| `Chip` / `Tag` | Chip = toggle button (`aria-pressed`), selected = aqua. Tag = non-interactive pill (`#courses`, rule summaries). |
| `SearchField` | The main search: animated rainbow border (sliding full-spectrum gradient) + blurred halo, yellow icon square. `role="search"`, `aria-label`. Focus is shown by the standard ring, not by the rainbow. |
| `StatusBadge` / `BrandBadge` | Status: tinted pill + icon + text. Brand: solid yellow pill for categories (Issue, Campaign, Segment). |
| `Field` (`TextField`, `SelectField`) | Visible bold label, required asterisk, hint, error below with icon, `aria-describedby`, `aria-invalid`; radius 12; read-only = dashed border. |
| `Alert` | Soft tinted panel, radius 18, icon + title + text + recovery action; `role="alert"` only for errors. |
| `EmptyState` | Icon in a raised square (yellow icon), title, what to do next, one action (13.7). |
| `ConfirmDialog` | Native `<dialog>`, radius 24, blurred scrim. Title = the action, body = exactly what happens, impact box with the **number of people affected**, confirm button repeats the verb (13.7). |
| `ThemeSwitcher` | Segmented pill: dark / light / system. Saved in `localStorage` (`mh-theme`); `index.html` applies it before first paint. |
| `Skeleton`, `SkeletonTile`, `SkeletonCard` | Pill shimmer with the same footprint as the final content. |
| `Reveal`, `Stagger`/`StaggerItem` (`src/motion`) | Fade + slide once on entering the viewport; sections and card grids only. |
| `Tilt` (`src/motion`) | Pointer tilt (springs) + spotlight glow; `tilt={false}` for glow only. Highlight cards and tiles use it internally. |
| `AnimatedNumber` (`src/motion`) | Count-up once when visible; used by `StatTile countTo`. |
| `Disclosure` (`src/motion`) | Button with `aria-expanded`, animated panel (height + fade). Used for "Show data as a table" under charts and advanced filters. |
| `Menu` (`src/motion`) | WAI-ARIA menu button: ArrowDown opens, arrows/Home/End move, Escape closes and returns focus, click outside closes. |
| Chart kit (`src/charts`) | Recharts 3: `BarChart` (vertical / horizontal with value labels), `LineChart` (several series, dashes), `FunnelChart`, `DonutChart`, `Sparkline`; `SimpleBarChart` / `SimpleLineChart` keep the one-series form with a table in a `Disclosure`. Custom tooltip and legend on tokens; keyboard layer on. |
| `MotionProvider` (`src/motion`) | `LazyMotion` + `MotionConfig`, OS reduced-motion + preview override, `data-motion` on `<html>`. |

## 8. Formatting

`src/lib/format.ts`: `Intl` numbers, percentages, dates and AMD per locale (`hy-AM`, `en`, `ru-RU`); `suppressSmall()` → "fewer than 3". Opens shown as "estimated" (PRD 7.5).

## 9. Anti-patterns

- Raw hex in components (tokens only; brand cards use the ink/white overrides).
- Colored text on brand fills, yellow/aqua text on light surfaces (use the `-text` tokens), gradient on anything smaller than display size.
- More than one highlight row or more than one brand tile per view; brand color as a status signal.
- Yellow for warnings (it is the brand primary; warnings are orange).
- Square corners or mixed radii on the same level; non-pill buttons.
- Hover-only information; destructive action without a count of affected people.
- Third-party font or script CDNs.
- Animating table rows, form fields or numbers in tables; staggering long lists; more than one rainbow element per page.
- Animating `width`/`height`/`top`/`left` (except the short user-triggered disclosure panel); motion without a reduced-motion path; infinite loops other than skeleton, spinner and the main search rainbow.
- `motion.*` components inside `LazyMotion` (use `m.*`).

## 10. What changed from v1

| v1 | v2 | Why |
|---|---|---|
| Light first, blue `#1E40AF` primary, amber accent | Dark first, Picsart yellow / aqua / magenta | References and brand colors |
| Noto Sans | Manrope + Noto Sans Armenian | Geometric look of the concept, keeps Armenian (14.5) |
| Radii 4–10px, square buttons | 8–24px radii, pill controls | Concept |
| Sidebar | Sticky header with pill navigation, drawer below 1280px | Concept |
| Flat dense cards | Large cards, brand highlight cards, inset boxes, icon tiles, tags, glow search | Concept and `tables.png` |
| Grey table header bar | Uppercase header on the surface, bold first column, raised total row | Calmer data inside a loud frame |
