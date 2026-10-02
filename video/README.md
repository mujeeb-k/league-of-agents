# The demo video

60 seconds, and a 15-second cut, made with [Remotion](https://www.remotion.dev). Every product shot is League of Agents itself, on a clone of [averroes-public](https://github.com/mujeeb-k/averroes-public), captured with Playwright. This folder is not part of the npm package.

1. **Footage.** Clone averroes-public into a folder named `averroes` (the map shows the folder's name), make a Python environment with `backend/requirements.txt` and `pytest`, then:

   ```bash
   npm i
   node capture/footage.mjs <averroes-public clone> <that environment's python>
   ```

   It starts the bridge, drives the app and records the motion clips. It runs Claude Code twice, a block edit and a Propagate run, for about $0.30. It writes clips, stills and the runs' data to `public/footage/` (not committed).

   The hook's terminal is a separate real session, in another clone, capped at $0.50:

   ```bash
   claude -p "Add a short docstring to every public function in backend/app/services and backend/app/repositories that doesn't have one. Keep the code as it is." --output-format stream-json --verbose --permission-mode acceptEdits --max-budget-usd 0.5 > public/footage/hook-session.jsonl
   ```

   Skim's is another, in the same clone reset to its last commit, capped at $0.75:

   ```bash
   claude -p "Every endpoint in backend/app/routers should reject bad input with a clear 4xx error instead of failing later. Add that validation where it's missing, keeping each endpoint's behaviour otherwise the same." --output-format stream-json --verbose --permission-mode acceptEdits --max-budget-usd 0.75 > public/footage/skim-session.jsonl
   ```

   `CLIPS=map node capture/footage.mjs …` records only the map clip, which needs no agent run, and keeps the rest.

   The Agents scene uses the agents' own icons, unaltered, in `public/logos/` (not committed): Claude's and Cursor's app icons (`sips -s format png /Applications/Claude.app/Contents/Resources/electron.icns --out public/logos/claude.png`, and the same with `/Applications/Cursor.app/Contents/Resources/Cursor.icns` for `cursor.png`), and the icon of OpenAI's Codex extension on the VS Code Marketplace (`openai.chatgpt`, its Icons.Default asset) as `codex.png`.
2. **Preview.** `npm run dev` opens Remotion Studio: `Main` (60 s) and `Cut15`.
3. **Frame sheet.** `python3 capture/sheet.py` renders its stills from `Main` and `Cut15` and writes `out/frame-sheet.png`.
4. **Render.** `npx remotion render Main` and `npx remotion render Cut15`.
5. **Narrated cuts.** Two, both spoken by [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0) run locally through [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) (MIT): `documentary`, a wildlife-documentary narrator (voice `am_puck`, 0.9×, about 71 s), and `clear`, plain lines over a quicker video (voice `am_michael`, 1.2×, about 60 s). Each cut's scene lengths are in `src/timing.json`; the silent cut uses the defaults there. Install `kokoro-onnx` and `soundfile` in a Python environment, `brew install espeak-ng`, and download `kokoro-v1.0.onnx` and `voices-v1.0.bin` from kokoro-onnx's `model-files-v1.0` release. Then `python3 capture/narration.py <documentary|clear> kokoro-v1.0.onnx voices-v1.0.bin` writes the lines to `public/narration/<cut>/` (not committed), and `npx remotion render Narrated out/league-of-agents-narrated.mp4` or `npx remotion render NarratedClear out/league-of-agents-narrated-clear.mp4` renders it. The lines are in `capture/narration.py`; a line that would run past its scene stops the script, so shorten the line.
