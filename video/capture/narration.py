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

VOICE = "af_heart"  # Kokoro's top-graded English voice
ESPEAK = "/opt/homebrew/opt/espeak-ng"
OUT = Path("public/narration")
TARGET_RMS = 10 ** (-20 / 20)  # each line at -20 dBFS RMS
PEAK = 10 ** (-1.5 / 20)  # and never above -1.5 dBFS

# (id, start, latest end), in seconds of the full video, and the words. Windows follow the scenes (Main.tsx),
# with short pauses where scenes change. Words are spelled for the voice where it needs help.
SCRIPT = [
    ("hook", 0.3, 4.2, "In a minute, an agent can change code all over your project."),
    ("skim", 4.6, 9.8, "Then it hands you a long summary, and it's easy to just say yes."),
    ("logo", 10.1, 12.9, "League of Agents shows you all of it."),
    ("map", 13.2, 18.2, "Your whole project becomes a map, from every folder down to the code."),
    ("point", 18.5, 21.6, "Pick the lines an agent may change."),
    ("edit", 21.8, 26.2, "Or make the edit yourself. Every save is kept, and can be undone."),
    ("rename", 26.6, 32.9, "Here, a function is renamed by hand. The tests now fail, because other files still use the old name."),
    ("click", 33.2, 36.8, "One click asks the agent to fix everything that depended on it."),
    ("folders", 37.1, 41.4, "Each folder lights up as the agent works through it."),
    ("steps", 41.8, 46.6, "Then you step through every changed file, one at a time."),
    ("review", 47.1, 53.4, "Flip between the old code, the new code, and exactly what changed. Your tests run on their own."),
    ("keep", 53.6, 56.9, "If it isn't right, one click puts everything back."),
    ("agents", 56.9, 59.4, "It works with the agents you already use."),
    ("setup", 59.6, 62.4, "Set it up with one line, or one command."),
    ("end", 62.7, 67.0, "It's free, it's open source, and it all runs on your computer."),
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
        audio, sr = kokoro.create(text, voice=VOICE, speed=1.0, lang="en-us")
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
