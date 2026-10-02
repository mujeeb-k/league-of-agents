# Design standard

The bar: a first-time visitor should take it for a well-funded product. Think Figma, Linear, and the Vercel dashboard for level of finish. Visual quality is not negotiable and is checked on every change.

The app's current design is the baseline for layout and behavior. This document is the standard every change is held to.

## Definition of done
Every change, every commit. There is no compromise on performance, interactions, visuals, or functionality.

**Performance.** Proved with performance traces, never claims.
- Pan and zoom run at 60 fps on a 1,000-file repo.
- Every click, keypress, and hover responds within 100 ms.
- Animations only move position or opacity, and never trigger layout.
- No layout shift.
- First paint is under 1.5 s on the hosted site.

**Functionality.**
- After every commit, every existing test, every visual baseline, and the live end-to-end test pass.
- Nothing that works today may break.

**Interactions.**
- Every interactive element has designed states: default, hover, pressed, focus, disabled, loading, and selected where it applies.
- Everything works by keyboard. Tooltips show shortcuts.

**Visuals.**
- Both themes.
- Every screen state is designed.
- No rough edges.

## Product rules
Taken from studying reference products: Sophon, a research terminal, for panels and data; Cursor's explorer for the sidebar. They are the rules shadcn/ui components are configured to.

- **Spacing scale.** 4, 8, 12, 16, 24, 32, 48 px, and nothing in between. Padding, gaps and margins all come from this scale.
- **Section labels.** Small and quiet: 11 px, weight 500, uppercase, letter-spacing about 0.06em, in the muted ink. Examples: "Browse", "Properties", "Checks". They label; they never shout.
- **Purple means selected or focused, nothing else.** Primary buttons are neutral (foreground on background). Toggles and segmented controls show their pressed state as a raised neutral surface, not a purple fill.
- **One main action per place.** The top bar's main action is Connect; secondary actions (such as browsing a local folder) live in ⌘K. Where two actions compete, the evidence picks the primary one: when checks fail, Revert is primary and Keep secondary.
- **Say each state once.** One indicator per state: while connecting, the badge says "Connecting" and the button steps aside rather than repeat it.
- **Disabled, with the reason, in place.** When something can't work yet (not connected, offline), its control stays where it is, disabled, and says why ("Connect a repo to run agents", "Reconnect to run agents"). Nothing silently does something else.
- **No empty scaffolding.** Don't show parts that need data the screen doesn't have: no breadcrumb separator without a repo, no "open a run" hint without a map, no empty minimap frame.
- **One line per idea in compact cards.** Who and when, then what changed, then tags. Tags never break inside.
- **Destructive actions** are outline buttons with red text, never a red fill.
- **Hairlines and low-contrast surfaces.** Structure comes from 1 px hairline borders and surfaces a single step apart in value, not from shadows or fills. Shadows are kept for things that float (menus, dialogs, the composer, the minimap).
- **Soft tinted tags.** A tinted background around 12–16% of the hue, text in the same hue at full strength, radius 4–6 px, 11–12 px text. Used for kinds, statuses and filters. Never solid saturated fills.
- **One icon family.** Lucide, 16 px, 1.5 px stroke, everywhere, sitting optically centred next to text.
- **Tabular numbers** wherever numbers line up or change: counts, stats, percentages, line numbers, durations, costs.
- **Generous whitespace.** At least 24 px between sections in panels, and 32–48 px on page-level layouts. Density comes from type and alignment, not from cramming.
- **One shared alignment grid.** Labels, values, icons and text in a panel share the same left edges. Section labels align with the content below them, and numbers right-align in their column.
- **Explorer** (sidebar):
  - rows of about 24 px;
  - chevrons on folders;
  - file-type icons;
  - indent guides as 1 px hairlines, 12 px per level;
  - the current file highlighted with a soft accent tint, without a heavy fill.

## Principles

From Tufte, *The Visual Display of Quantitative Information*:

- Show the data. Every mark carries information. Remove boxes, borders, and fills that don't.
- Label directly on the graphic. No legends.
- Thin lines. Use weight only to mean something (the run path is heavier than the tree).
- Wider than tall. The map grows left to right.
- Small multiples. Run thumbnails show where each run landed.

From make-interfaces-feel-better:

- Shadows for depth, borders only for structure.
- Concentric radii: inner radius = outer radius minus padding.
- Tabular numbers everywhere numbers change.
- Press feedback: buttons and toggles move down 1 px, because the definition of done allows only position and opacity to animate.
- Animate named properties only. Never `transition: all`.
- Motion only in response to an action. Nothing moves on its own, except live progress (the running dot and spinners) for work the user started. It stops under reduced motion.
- Antialiased text. Optical alignment for icons next to text.

From ui-ux-pro-max:

- SVG icons only, one family (Lucide), 1.5px stroke. No emoji in the UI.
- Pointer cursor on everything clickable. Visible focus rings.
- Text contrast at least 4.5:1. Respect reduced motion.
- Works from 1024 to 2560 wide. Usable at 375 for reviewing only.

## Tokens

All tokens live in `web/src/theme.css`, one source for shadcn/ui and the canvas, following `docs/BRAND.md`. `web/tests/unit/contrast.test.ts` checks every text pairing in both themes.

- Neutrals: cool grays. Canvas slightly darker than chrome. Cards on top are the lightest surface in light mode.
- One accent: purple, `#7C2BEE` light and `#A871F4` dark (see `docs/BRAND.md`). Used for selection, focus, and the selection outline. Nothing else is purple, agent colours included.
- Change colors: green for added, red for removed, amber for modified. Used as small, intense marks on a muted base, never as large fills.
- Agent colors: one per agent, muted. Used only for dots, the run path, and folder label text during a run.
- Radii: 6 (controls), 8 (inputs, list rows), 10 (cards), 12 (panels), 16 (floating composer). On the canvas, file rows and spark marks scale with zoom, and the selection outline keeps square corners and handles, as in Figma.
- The canvas dot grid is a pattern drawn with a CSS radial gradient. It is not a decorative gradient.
- Spacing: 4px grid.
- Type: one sans and one mono from the same family (currently IBM Plex). Sizes 11, 12, 13, 15. Weights 400, 500, 600. Sentence case everywhere.
- Light and dark themes, both first class.

## Components
shadcn/ui (Radix, Tailwind, Lucide) for every panel and control. The canvas renderer stays custom.

## Layout

| Region | Size | Notes |
|---|---|---|
| Top bar | 44px | Brand, repo and branch, run compare control centered, connection status, theme, connect |
| Sidebar | 248px | Files and Runs tabs. Collapsible |
| Canvas | fill | Dot grid only when zoomed in |
| Inspector | 316px | Context for the selection or run. Collapsible |
| Composer | floating, bottom center, max 600px | Scope chips, agent picker, prompt |
| Minimap | 224px, bottom right | Zoom controls in its header |

## Canvas rules

- The map never reshuffles once laid out. New files slot in.
- First open fits the whole repo to the screen, using the screen's shape.
- Zoomed out must look rich: real line-length textures, change ticks, folder labels with totals. No empty rectangles.
- Zoomed in: code boxes like Figma frames, import lines as thin curves, highlighted on hover and selection.
- Selection looks like Figma: blue outline, square corner handles, a small label pill underneath.

## Every state is designed

Each view needs a designed version of: empty, loading, connecting, connected, disconnected, error, agent running, checks running, checks failed, nothing changed, reverted. No raw error strings, no blank panels.

## Scope rule

Scope is enforced as far as each agent allows, and the UI never claims more than that.

- Claude Code runs: out-of-scope edits are blocked live by the scope lock hook.
- Cursor and Codex runs: out-of-scope edits are not blocked. They are flagged after the run, on the run and in its review.

## Copy

- Short, plain, sentence case. Verbs on buttons: "Keep changes", "Revert run".
- No jargon in the UI: say "local network access", not "LNA".
- No game language (fog, lanes, champions).

## Not allowed

- Gradients, glassmorphism, glow effects, emoji, stock illustrations.
- Generic dashboard card grids.
- Placeholder "lorem" or fake metrics in the product. Demo data must look real and neutral.

## Proof

Every visual change closes with Playwright screenshots at 1440×900 and 1280×800, light and dark, for each affected state, reviewed against this document.
