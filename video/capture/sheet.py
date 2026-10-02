"""The frame sheet for review: stills from the 60-second video and the 15-second cut, each with its time,
on-screen line and what is shown. Run from video/: python3 capture/sheet.py [out.png] (renders the stills
itself; writes out/frame-sheet.png unless given a path)."""
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont

FPS = 30
MAIN = [
    (150, "Hook", "Claude Code just took 25 actions. / What did it change?", "The real 52-second session on averroes scrolling; the counter runs to 25"),
    (250, "Skim", "You skim the changes and hope.", "A real 80-second Claude Code task (25 actions, $0.43): its last steps and summary scroll past"),
    (330, "Skim", "If you review the code at all.", "The end of that summary, as the terminal shows it"),
    (380, "Logo", "(no headline) Introducing", "Introducing, over the L"),
    (430, "Logo", "", "Into the L"),
    (490, "Logo", "League of Agents / See every change your agents make.", "The name, then the line, as every line in the video comes up"),
    (540, "Map", "Your whole project, on one screen.", "The whole map in the app, at 6%"),
    (640, "Map", "(same line)", "The app's own zoom: folders with their files' names, at 13%"),
    (740, "Map", "(same line)", "On in to code, at 100%"),
    (830, "Point", "Select the exact lines for your agent to work on, or edit the file yourself.", "Lines 34–56 of coach.py dragged; the scope reads coach.py:34–56"),
    (910, "Point", "(same line)", "A comment typed into config.py and saved"),
    (990, "Propagate", "Rename a function.", "_extract_refined_prompt renamed in the editor and saved"),
    (1180, "Propagate", "See every file it touched, across your project.", "routers/, tests/, docs/ light up in edit order; the run's numbers as a caption"),
    (1300, "Review", "Check every line before you keep it.", "The diff with changed words marked; the passing backend tests on screen"),
    (1450, "Keep", "Keep it, or undo it in one click.", "Keep, then Revert on the Propagate run"),
    (1570, "Agents", "Works with Claude Code, Codex and Cursor.", "The agents' own logos; Beta under Codex and Cursor"),
    (1650, "Setup", "Set it up with one line.", "Paste into your agent: Copy clicked, Copied"),
    (1700, "Setup", "(same line)", "Or run: Copy clicked, Copied"),
    (1780, "End", "npx leagueofagents-cli · leagueofagents.dev", "Free · Open source · Runs on your machine / Available for macOS · Windows coming soon"),
]
CUT = [(60, "Hook"), (185, "Map"), (345, "Propagate"), (420, "End")]


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
