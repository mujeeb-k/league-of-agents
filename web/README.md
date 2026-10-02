# web

The League of Agents web app. Vite, React, strict TypeScript, shadcn/ui and Tailwind CSS.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck and build the static site into `dist/` |
| `npm test` | Typecheck, the no-`any` check, unit tests, then every Playwright suite |
| `npx playwright test --project app` | The interaction suite |
| `npx playwright test --project visual` | Screenshots compared with the approved baselines in `tests/visual/visual.spec.ts-snapshots/` (zero differing pixels) |
| `npx playwright test --project live` | Live mode against a real bridge in temp git repos |
| `npm run states` | The interaction inventory: every interactive element in every state that applies, as one contact sheet per theme in `test-results/states/` |
| `npm run screens` | Every designed screen state at 1440×900 and 1280×800, in both themes, into `test-results/screens/` |
| `npm run perf` | Performance proof, not part of `npm test`: pan and zoom frame times on a generated 1,000-file repo, and first paint on leagueofagents.dev. Opens a visible Chrome window, so the GPU rasterizes as it does for users. Results and a Chrome trace go to `test-results/perf/`. |

Playwright uses production builds only, served by `tests/support/static-server.mjs`. Build first.

## How it is put together

shadcn/ui and Tailwind style the chrome; the canvas is plain CSS.

- `src/theme.css`: every colour, font and radius token, for both themes. shadcn/ui and the canvas read the same values.
- `src/index.css`: cascade layers (theme, base, canvas, components, utilities) and a small base reset.
- `src/styles`: the canvas (frames, file rows, code cards, wires, selection) and the app grid. Plain CSS, because the canvas scales every size by the zoom.
- `src/app.css`: canvas review rings, reply Markdown, and word-level diff marks.
- `src/components/ui`: shadcn/ui components, added with the shadcn CLI and lightly adjusted.

- `src/lib`: model, layout, diff views, imports, syntax tokens, camera, minimap.
- `src/state`: the app state (`app.ts`), actions, and render signals (`render.ts`). Each region (scene, top bar, sidebar, composer, inspector) re-renders when its render function runs. Its content is keyed on a counter so a render replaces the elements.
- `src/api`: bridge wire types, a typed client for every route, the long-poll loop and connection handling.
- `src/components`: one component per region. Event listeners are native, bound once per component.
- `src/demo`: the neutral sample repo (`sample.ts` and `sample.txt`).
- The camera writes the canvas transform directly, outside React, so panning never re-renders.

## Visual baselines
`tests/visual/visual.spec.ts` screenshots nine demo screens at 1440×900 and 1280×800, in light and dark, and compares them with approved baselines. Any visual change fails the suite until the new screenshots are reviewed. To accept an intended change, run `npx playwright test --project visual --update-snapshots`, look at every changed image, and commit them with the change. The baselines are rendered on macOS (`-darwin` in the file name).

## Fonts

IBM Plex Sans and Mono, latin subset, self-hosted in `public/fonts` under the SIL Open Font License (license files alongside).
