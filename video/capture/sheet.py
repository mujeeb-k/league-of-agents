"""The frame sheet for review: stills from the 60-second video and the 15-second cut, each with its time,
on-screen line and what is shown. Run from video/: python3 capture/sheet.py [out.png] (renders the stills
itself; writes out/frame-sheet.png unless given a path)."""
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont

FPS = 30
MAIN = [
    (150, "Hook · dark", "Claude Code just took 25 actions. / What did it change?", "The real 52-second session scrolling in the terminal; the counter runs to 25"),
    (245, "Skim · dark", "You skim the changes and hope.", "A real 80-second task (25 actions, $0.43): its summary scrolls past"),
    (315, "Skim · dark", "If you review the code at all.", "The person types \"continue and make no mistakes\" at the prompt"),
    (350, "Skim · dark", "(same line)", "Sent: done"),
    (430, "Wordmark · turns light", "Introducing / See every change your agents make.", "Zooms through from the dark terminal"),
    (505, "Map", "Your whole project, on one screen.", "The whole map, in the app, at 6%; the line on a card over the empty canvas"),
    (550, "Map", "(same line)", "The app's own zoom: folders with their files' names, at 13%"),
    (675, "Map", "(same line)", "On in to one file's code, at 100%, held"),
    (750, "Point", "Select the exact lines for your agent to work on.", "Close in on the editor: lines 34–56 dragged"),
    (840, "Point", "Or edit the file yourself.", "A comment typed into config.py and saved"),
    (930, "Propagate", "Rename a function.", "_extract_refined_prompt renamed in the editor and saved"),
    (1010, "Propagate", "See every file it worked on, across your project.", "The camera on the first folder as it lights up"),
    (1105, "Propagate", "(same line)", "Back to all three folders, lit in order; the run's numbers"),
    (1205, "Review · dark", "Check every line before you keep it.", "Before, After and Diff in the app's dark theme; the passing backend tests"),
    (1375, "Keep", "Keep it, or undo it in one click.", "Close in on Keep, then Revert"),
    (1470, "Agents", "Works with Claude Code, Codex and Cursor.", "The agents' own icons; Beta under Codex and Cursor"),
    (1570, "Setup", "Set it up with one line.", "Paste into your agent: Copy clicked, Copied"),
    (1615, "Setup", "(same line)", "Or run: Copy clicked, Copied"),
    (1790, "End", "npx leagueofagents-cli · leagueofagents.dev", "Each line in turn, slowly; the whole card holds for about 3 s"),
]
CUT = [(60, "Hook"), (170, "Map"), (325, "Propagate"), (440, "End")]


def still(comp, frame):
    path = f"out/sheet/{comp}-{frame:04d}.png"
    subprocess.run(["npx", "remotion", "still", comp, path, f"--frame={frame}", "--log=error"], check=True)
    return Image.open(path)


TW, TH, PAD, CAP, COLS = 880, 495, 40, 120, 2
SW = (COLS * TW + PAD - 3 * PAD) // 4
W = COLS * TW + (COLS + 1) * PAD
rows = (len(MAIN) + 1) // COLS
H = 120 + rows * (TH + CAP + PAD) + 70 + SW * 9 // 16 + 60 + PAD
font = lambda s, bold=False: ImageFont.truetype("/System/Library/Fonts/HelveticaNeue.ttc", s, index=1 if bold else 0)
sheet = Image.new("RGB", (W, H), "#ffffff")
d = ImageDraw.Draw(sheet)
d.text((PAD, 40), "League of Agents: 60-second video (1920 × 1080, 30 fps)", font=font(34, True), fill="#18181b")
for i, (frame, scene, line, visual) in enumerate(MAIN):
    x, y = PAD + i % COLS * (TW + PAD), 120 + i // COLS * (TH + CAP + PAD)
    sheet.paste(still("Main", frame).resize((TW, TH), Image.LANCZOS), (x, y))
    d.rectangle([x, y, x + TW - 1, y + TH - 1], outline="#e4e4e7")
    d.text((x, y + TH + 12), f"{scene}  ·  {frame / FPS:.1f} s", font=font(22, True), fill="#7c2bee")
    size = 22
    while d.textlength(line, font=font(size, True)) > TW and size > 14:
        size -= 1
    d.text((x, y + TH + 44), line, font=font(size, True), fill="#18181b")
    d.text((x, y + TH + 78), visual, font=font(20), fill="#52525b")
y = 120 + rows * (TH + CAP + PAD) + 10
d.text((PAD, y), "15-second cut", font=font(30, True), fill="#18181b")
for i, (frame, scene) in enumerate(CUT):
    x = PAD + i * (SW + PAD)
    sheet.paste(still("Cut15", frame).resize((SW, SW * 9 // 16), Image.LANCZOS), (x, y + 60))
    d.text((x, y + 70 + SW * 9 // 16), f"{scene}  ·  {frame / FPS:.1f} s", font=font(20, True), fill="#7c2bee")
sheet.save(sys.argv[1] if len(sys.argv) > 1 else "out/frame-sheet.png", optimize=True)
