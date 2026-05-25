# Chidori · Design System

> Editorial scientific instrument. Source of truth: `Programacion_UI_Micro /UI_REACT/src/index.css`.
> Every token is exposed as a CSS custom property under `:root` / `.light-theme`.

## Color

All colors are **OKLCH**. Neutrals are tinted toward warm graphite (hue 60–80) and
never pure black/white. There is exactly **one signal color** and **one alarm color**.

### Dark (default)

| Token | OKLCH | Role |
|---|---|---|
| `--paper`      | `0.158 0.006 60`  | App background |
| `--ink-1`      | `0.196 0.006 60`  | Surface |
| `--ink-2`      | `0.235 0.006 60`  | Raised |
| `--ink-3`      | `0.295 0.006 60`  | Inactive control |
| `--hairline`   | `0.340 0.008 60`  | 1px border |
| `--hairline-strong` | `0.430 0.010 60` | Emphasis border |
| `--type-hi`    | `0.965 0.005 80`  | Primary text |
| `--type-med`   | `0.730 0.008 60`  | Secondary text |
| `--type-low`   | `0.550 0.010 60`  | Labels |
| `--type-mute`  | `0.420 0.010 60`  | Hints, footer |
| `--signal`     | `0.640 0.180 268` | Live state, focus, primary action |
| `--alarm`      | `0.620 0.190 22`  | Danger only |
| `--confirm`    | `0.660 0.110 145` | Confirmed write only |

### Light

Same tokens, inverted luminances. `--paper` is warm bone (`0.985 0.008 80`),
signal and alarm shift slightly darker (`0.510`) for AA contrast.

### Rules

- **No gradient text. Ever.** `background-clip: text + gradient` is banned.
- **No glassmorphism.** No `backdrop-filter: blur` used decoratively.
- Use `--signal` only for: active state, primary CTA, focus rings, live curve, links.
- Use `--alarm` only for: alarm banner, danger buttons, dangerous progress indicator.
- Shadow tokens use `oklch(0 0 0 / α)` (alpha-tinted), never raw rgba.

## Typography

- **Display serif** · `Fraunces` (variable, opsz 9–144, wght 300–600). Used for
  headings (h1–h3) and prominent numerals. Variation: `'opsz' 144` for headlines,
  `'opsz' 96` for h3.
- **UI sans** · `IBM Plex Sans` (400/500/600). Body text and buttons.
- **Mono / data** · `IBM Plex Mono` (400/500/600). Labels, badges, tabular numbers,
  field labels (uppercased + letter-spaced).
- Body: `font-variant-numeric: tabular-nums` and `font-feature-settings: 'cv11', 'ss01'`.

### Scale (ratio 1.250 major third)

`11 · 13 · 15 · 19 · 24 · 30 · 38 · 48 px` → `--t-xs` … `--t-4xl`

| Class | Where |
|---|---|
| `.section-label` | Tiny mono uppercased labels above titles |
| `.numeric` | Forces tabular numerals (added implicitly via body) |
| `.kbd` | Keyboard hint inline element |

### Headings

- h1: Fraunces 500, 38px, opsz 144, letter-spacing -0.01em
- h2: Fraunces 500, 24px, opsz 144
- h3: Fraunces 500, 19px, opsz 96

## Geometry

- Border radius scale: `--r-sm 4 / --r-md 6 / --r-lg 10` px (square-shouldered, instrument)
- Hairlines: `1px solid var(--hairline)` for surface borders; `--hairline-strong` for emphasis
- No nested cards. Surfaces are flat panels separated by hairlines and whitespace

## Spacing

No rigid scale; spacing varies for rhythm. Common values: 6, 8, 10, 12, 14, 18, 22, 28 px.
Section gaps use 20–28 px depending on density.

## Motion

- **Default easing**: `ease-out-quart` (`cubic-bezier(0.25, 1, 0.5, 1)`) for snap, `ease-out-quint`
  for slower transitions
- **No bounce / elastic**. Banned.
- **No layout-property animations**. Width/height/padding/margin transitions are banned —
  use `transform: scaleX/Y`, `clip-path`, or animate on `grid-template-rows`.
- **Durations**: fast 140ms, base 220ms, slow 360ms
- Hover transitions only on color/border/background, never on transform-lift

### Reserved motion

Only these elements move:
- **Alarm banner** (strobe + emit ring + dot scale)
- **Live state pill** (slow opacity pulse on the dot)
- **Cloud sync icon** (rotating refresh icon during write)
- **Hold-to-confirm button** (linear fill while held)
- **Drawer entry** (translateX + opacity, 360ms)

The data curve does NOT animate during updates (`animation.duration = 0` in Chart.js).

## Components

### Primitive
- `.surface` — Default panel: `var(--ink-1)`, 1px hairline, radius `--r-md`
- `.surface-pad` — `.surface` with 20px 22px padding
- `.hairline` — 1px separator
- `.kbd` — keyboard hint

### Controls
- `.button` (`.button-primary` / `.button-danger` / `.button-ghost` / `.button-sm` / `.button-lg`)
- `.icon-button` — 36×36, used in toolbars and modal closes
- `.input` — Mono input field with focus ring
- `.field` + `.field-label` + `.field-hint` — Form field stack
- `.switch` + `.switch-track` — Custom checkbox toggle
- `.segment` + `.segment-item` — Segmented radio control

### Status
- `.pill` (`.pill-live` / `.pill-syncing` / `.pill-off` / `.pill-confirm` / `.pill-alarm`)
- `.sync-badge` (`.is-ok` / `.is-busy` / `.is-warn` / `.is-off`)

### Composed
- `.readout` + `.readout-cell` + `.readout-cell.hero` — Hierarchical KPI strip
- `.vessel` + `.vessel-fill` + `.vessel-grid` — Deterministic bladder visual
- `.chart-host` + `.chart-host.compact` — Chart container
- `.timeline` + `.timeline-row` — Clinical event log
- `.step-rail` + `.step-rail-item` (`.done` / `.active`) — Wizard progress
- `.alarm-banner` — Persistent top-of-screen alarm
- `.gate-banner` — Connection lost warning
- `.empty-state` + `.empty-steps` + `.empty-step` — Onboarding screen
- `.modal-veil` + `.modal-card` + `.modal-head` / `.modal-body` / `.modal-foot`
- `.drawer-veil` + `.drawer-panel` + `.drawer-head` / `.drawer-body`
- `.hold-button` + `.hold-button-fill` + `.hold-button-label` — Hold-to-confirm
- `.toast-stack` + `.toast` (`.t-info` / `.t-success` / `.t-warn`)

### Layout
- `.app-shell` — Grid auto · 1fr · auto
- `.app-header` — Sticky top, hairline border
- `.app-main` — max-width 1280, padding responsive
- `.app-footer` — Hairline top, mono microcopy
- `.split` — 1.4fr · 1fr (collapses on <980)
- `.split-3` — 3 column grid (collapses on <1080)
- `.row` / `.row-between` / `.stack-sm` / `.stack-md` — Flex utility primitives

## Accessibility

- All buttons have visible focus rings (`outline: 2px solid var(--signal)` with 2px offset)
- Pills include both color and label text; never color-only
- Alarm banner uses `role="alert"` and `aria-live="assertive"`
- Toasts use `role="status"` and `aria-live="polite"`
- Modals dismiss with Esc
- All form inputs have explicit `label` + `id` association
- `sr-only` utility for screen-reader-only context

## Banned patterns (project-wide)

- Gradient text (`background-clip: text` + gradient)
- Glassmorphism as default (`backdrop-filter: blur` on cards)
- Side-stripe borders (`border-left > 1px` as accent)
- Hero-metric template (big gradient number + bouncing arrow + identical satellite tiles)
- Identical card grids (4–6 same-sized icon+label cards)
- `window.confirm` / `window.alert` (use `ConfirmModal`)
- Native `Notification` for alarm-only (Notification is fallback; primary signal is in-app)
- Em dashes in copy (use commas, colons, semicolons, periods)
- Decorative emoji in UI copy
- `transition: width` / `transition: height` (banned by scanner; use transforms)
- `transition: all` (banned; target specific properties)
- `bounce` or `elastic` easing functions (banned; use `ease-out-quart/quint`)
- Inter, Roboto, Geist, Plus Jakarta, Space Grotesk as primary font (overused AI fonts)

## Build / test

- The reference scanner is `npx impeccable --json src/` from the UI_REACT folder
- Expected output: zero `gradient-text`, zero `layout-transition`, zero `bounce-easing`,
  and zero `overused-font` findings
- Re-run `/impeccable critique` after changes; the Nielsen score should land above 30/40

## File layout (UI_REACT/src)

```
src/
├── index.css                  Design system tokens + base styles
├── App.jsx                    Root composition
├── main.jsx                   Vite entry
├── supabaseClient.js          Cloud client factory
└── components/
    ├── AlarmBanner.jsx        ★ persistent alarm state
    ├── BladderVisual.jsx      ★ deterministic bladder visual
    ├── CalibrationWizard.jsx  ★ 4-step calibration
    ├── CloudSyncBadge.jsx     ★ persistence status pill
    ├── ConfirmModal.jsx       ★ hold-to-confirm modal
    ├── ConnectionGate.jsx     ★ ws-disconnected banner
    ├── EmptyState.jsx         ★ onboarding before first data
    ├── ExportModal.jsx        PDF / CSV / TXT
    ├── RealTimeCharts.jsx     Hero impedance curve + dZ/dt
    ├── SettingsPanel.jsx      ★ drawer with WS + Supabase config
    ├── StatsGrid.jsx          ★ hierarchical readout strip
    ├── Timeline.jsx           Event log
    ├── Toasts.jsx             ★ ephemeral notifications
    └── useCloudSync.js        ★ retry queue + state machine

★ = new or significantly rewritten in this design pass
```
