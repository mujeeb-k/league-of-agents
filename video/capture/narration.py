"""The narration for the narrated cut: each line spoken by Kokoro (Apache 2.0 weights, run locally through
kokoro-onnx, MIT), levelled to the same loudness, and timed to its scene. A line that would run past its window is
an error: shorten the line, never speed the voice. Writes public/narration/<id>.wav and public/narration/lines.json.

Usage, from video/, with a Python that has kokoro-onnx and soundfile and espeak-ng installed (brew install espeak-ng):
  python3 capture/narration.py <kokoro-v1.0.onnx> <voices-v1.0.bin>
"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import EspeakConfig, Kokoro

VOICE = "am_michael"  # Kokoro's deepest, calmest American English voice
SPEED = 1.1  # a touch quicker than its default
ESPEAK = "/opt/homebrew/opt/espeak-ng"
OUT = Path("public/narration")
TARGET_RMS = 10 ** (-20 / 20)  # each line at -20 dBFS RMS
PEAK = 10 ** (-1.5 / 20)  # and never above -1.5 dBFS

# (id, start, latest end), in seconds of the full video, and the words. Windows follow the scenes (Main.tsx),
# with short pauses where scenes change. Words are spelled for the voice where it needs help.
SCRIPT = [
    ("hook", 0.2, 4.3, "In under a minute, an agent changed code across your whole project."),
    ("skim", 4.6, 9.8, "It leaves a long summary behind. Most people skim it, and say yes."),
    ("logo", 10.0, 12.9, "League of Agents shows you what changed, and where."),
    ("map", 13.2, 18.2, "Your whole project, laid out as a map. Zoom in from the folders down to the code."),
    ("point", 18.5, 21.6, "Select the lines you want the agent to work on."),
    ("edit", 21.8, 26.2, "Or open the file and edit it yourself. Every save can be undone."),
    ("rename", 26.6, 32.9, "Here, a function gets a new name. The tests fail, because other files still use the old one."),
    ("click", 33.2, 36.8, "One click asks the agent to update everything that uses it."),
    ("folders", 37.1, 41.4, "Each folder lights up as the agent reaches it."),
    ("steps", 41.8, 46.6, "Then you step through every file it changed, one by one."),
    ("review", 47.1, 53.4, "See the code before, after, and exactly what changed. Your tests run on their own."),
    ("keep", 53.6, 56.9, "If it's wrong, one click puts every file back."),
    ("agents", 56.9, 59.4, "It works with the agents you already use."),
    ("setup", 59.6, 62.4, "Set it up with one line, or one command."),
    ("end", 62.7, 67.0, "Free, open source, and running on your own computer."),
]


def level(x):
    """The same loudness for every line, without clipping."""
    x = x * (TARGET_RMS / np.sqrt(np.mean(x[np.abs(x) > 1e-4] ** 2)))
    return x * min(1.0, PEAK / np.max(np.abs(x)))


def main(model, voices):
    kokoro = Kokoro(
        model,
        voices,
        espeak_config=EspeakConfig(lib_path=f"{ESPEAK}/lib/libespeak-ng.dylib", data_path=f"{ESPEAK}/share/espeak-ng-data"),
    )
    OUT.mkdir(parents=True, exist_ok=True)
    lines, late = [], []
    for name, start, end, text in SCRIPT:
        audio, sr = kokoro.create(text, voice=VOICE, speed=SPEED, lang="en-us")
        audio = level(np.asarray(audio, dtype=np.float64))
        sf.write(OUT / f"{name}.wav", audio, sr, subtype="PCM_16")
        length = len(audio) / sr
        lines.append({"id": name, "start": start, "seconds": round(length, 3), "text": text})
        if start + length > end:
            late.append(f"{name}: {length:.2f} s, {start + length - end:.2f} s past {end} s")
        print(f"{name:8s} {start:5.1f}–{start + length:5.2f} s (window to {end} s)  {text}")
    (OUT / "lines.json").write_text(json.dumps(lines, indent=2) + "\n")
    if late:
        sys.exit("Too long, shorten these lines:\n  " + "\n  ".join(late))


if __name__ == "__main__":
    main(*sys.argv[1:3])
