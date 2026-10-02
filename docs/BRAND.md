# Brand

## Name and domain
- Name: League of Agents. Sentence case in UI copy; the name itself keeps its capitals.
- Site: https://leagueofagents.dev (registered on Vercel). `www.leagueofagents.dev` redirects to it.
- The bridge prints `https://leagueofagents.dev/#bridge=PORT&t=TOKEN` by default.

## Logo
A silver serif L on a deep purple panel, in a dark bevelled frame.

| File | Size | Use |
|---|---|---|
| `brand/logo-source.png` | 1254×1254, transparent margin | Original. Never edited. |
| `brand/logo-1024.png` | 1024×1024 | Master: cropped to the logo, square, opaque, no margin |
| `brand/logo-512.png` | 512×512 | General use |
| `brand/apple-touch-icon.png` | 180×180 | iOS home screen (opaque, as iOS requires) |
| `brand/favicon-32.png` | 32×32 | Framed logo at 32px |
| `brand/logo-simple-1024.png` | 1024×1024 | Simplified variant: the purple panel and L, no frame |
| `brand/favicon-16.png` | 16×16 | Simplified variant at 16px |
| `brand/favicon.ico` | 16×16 and 32×32 | Browser tab icon, simplified variant at both sizes |

How they were made:
- **Crop.** The logo's solid area in the source is 1023×1015 px at (116, 120). It was cropped and scaled to a square; the 0.8% stretch is not visible, and cutting it square instead would remove the thin outer rim on two sides. The 1–3 px anti-aliased rim was flattened onto the rim's own lavender (#D5CFE6), so there is no white or transparent margin.
- **Resizing.** Every size is resampled from the 1024 master with Lanczos.

At 16px the frame takes about 2 of 16 pixels on each side and the L becomes a small grey-ringed blob, so tabs use the simplified variant. Chrome shows the 32px icon on Retina screens, so `favicon.ico` uses the simplified variant at both sizes and the tab looks the same everywhere. The framed logo is used from 32px up everywhere else.

## Wordmark
"League of Agents" in the same silver and purple as the logo, on a transparent background. It reads on light and dark backgrounds alike.

| File | Size | Use |
|---|---|---|
| `brand/wordmark-source.png` | 1536×1024, transparent margin | Original. Never edited. |
| `brand/wordmark.png` | 1445×655 | Trimmed to the letters: the video's logo card |
| `brand/wordmark-1200.png` | 1200 wide | Large uses |
| `brand/wordmark-600.png` | 600 wide | The top of the README, the social preview |

Used in three places only: the video's logo card, the top of the README, and the social preview image. Inside the app the L monogram stays, and there is no loading or splash screen.

## Direction

- **Dark theme like Vercel's:** near-black backgrounds and neutral grays.
- **Light theme like Cursor's:** a clean off-white with soft gray panels.
- **Calm and spacious like Claude's design,** but with no warm colors in the UI: no beige, cream, or orange. This covers UI surfaces and accents only; diff and agent identity colours are data and keep their colours.
- **Purple is the only accent.**

## Colours

### Logo
Sampled from the source panel, which is a radial gradient:

| | Hex |
|---|---|
| Brand purple, centre | `#431485` |
| Brand purple, median | `#340C63` |
| Brand purple, edge | `#22073F` |
| L silver | `#D7D6E9` |

The silver L on the centre purple is 8.75:1.

### Accent
Purple, at the logo's hue (265°), with one value per theme.

The accent is used for selection, focus rings, the selection outline and handles, and the selection label pill. Nothing else in the UI is purple.

| Theme | Accent | Contrast | Soft fill (`--sel-soft`) | Text on accent (`--on-sel`) |
|---|---|---|---|---|
| Light | `#7C2BEE` | 6.11:1 on white; at least 5.07:1 on every light surface (`#FFFFFF`, `#FAFAFB`, `#F2F3F5`, `#E8EAED`) | `rgba(124, 43, 238, .09)` | `#FFFFFF`, 6.11:1 |
| Dark | `#A871F4` | 5.83:1 on the canvas `#0C0E11`; at least 5.26:1 on every dark surface, black included | `rgba(168, 113, 244, .14)` | `#0C0E11`, 5.83:1 |

How it was derived: keep the logo's hue (265°), then pick the lightness and saturation that are vivid but clear 4.5:1 on every surface of that theme.

- The logo purple itself is too dark to use in dark mode: 1.54:1 on the canvas.
- The neutrals live in `web/src/theme.css`. `web/tests/unit/contrast.test.ts` checks every text pairing in both themes, the accent included, on each commit.

### Agents
No agent colour may be purple. Agent colours are muted and used only for dots, the run path, and folder labels during a run.

| Agent | Light | Dark | Hue |
|---|---|---|---|
| Claude Code | `#B34A20` | `#E8845C` | 16°, warm: allowed, as identity data |
| Codex | `#0A7071` | `#3DC2C2` | 180° |
| Cursor | `#2F3440` | `#C9CED6` | neutral |
| Watch mode (was "Any editor") | `#7F620E` | `#E3B341` | 44°, warm: allowed, as identity data |
| Hermes, when it returns | `#2A62C9` | `#6F9BF2` | 220°, was violet `#6A4BE0` |

The light values are dark enough for folder labels to reach 4.5:1 on the canvas.

### Code
Syntax colours are data too. Keywords are blue (`#0A5BC4` light, `#6EA8FE` dark), no longer violet, so purple keeps meaning selection. Strings are teal, numbers orange, comments the muted ink. All clear 4.5:1 on cards and on added and removed lines.

### Warm colours
"No warm colors" applies to UI surfaces and accents only. Diff colours and agent identity colours are data, so they stay, including Claude Code's orange, the watch mode amber, and amber for modified and red for removed in diffs.

## Proof
A manual screenshot of a real Chrome tab (2026-09-30, light) shows the favicon and the title. Automated tab screenshots were dropped.
