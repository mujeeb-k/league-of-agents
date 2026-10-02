"""The narration for the narrated cuts: each line spoken by Kokoro (Apache 2.0 weights, run locally through
kokoro-onnx, MIT), levelled to the same loudness, and timed to its scene. A line that would run past its window is
an error: shorten the line, never hurry the voice. Writes public/narration/<cut>/<id>.wav and lines.json.

Two cuts:
- documentary: a wildlife-documentary narrator, deep and unhurried, over the video with a little more room;
- clear: plain lines, a little quicker, over a quicker video of about a minute.
Each cut's scene lengths are in src/timing.json.

Usage, from video/, with a Python that has kokoro-onnx and soundfile and espeak-ng installed (brew install espeak-ng):
  python3 capture/narration.py <documentary|clear> <kokoro-v1.0.onnx> <voices-v1.0.bin>
"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import EspeakConfig, Kokoro

ESPEAK = "/opt/homebrew/opt/espeak-ng"
TARGET_RMS = 10 ** (-20 / 20)  # each line at -20 dBFS RMS
PEAK = 10 ** (-1.5 / 20)  # and never above -1.5 dBFS
GAP = 0.35  # the least breath between two lines

# Each cut: the voice, its speed, and its lines. A line is (id, scene, earliest start, latest end), in seconds from
# the scene's start, then its words with pauses in seconds between them, so each beat is real silence. A line starts
# at its moment, or a breath after the line before it ends, whichever is later.
CUTS = {
    "documentary": {
        "voice": "am_puck",  # of Kokoro's deepest voices, the one speech recognition hears most clearly
        "speed": 0.9,  # unhurried
        "lines": [
            ("hook", "Hook", 0.1, 5.4, ["In its natural habitat,", 0.2, "the coding agent.", 0.2, "Twenty-five actions. Under a minute."]),
            ("skim", "Skim", 0.5, 6.0, ["The developer reviews the changes,", 0.25, "briefly.", 0.9, "If at all."]),
            ("logo", "Logo", 0.9, 3.5, ["But something new has emerged."]),
            ("map", "Map", 0.6, 5.9, ["From above, the entire project comes into view.", 0.2, "Every folder. Every file."]),
            ("point", "Point", 0.3, 5.3, ["The developer marks a territory.", 0.15, "The agent may work here,", 0.15, "and nowhere else."]),
            ("edit", "Point", 5.4, 10.2, ["The developer edits by hand.", 0.3, "A rare sight."]),
            ("rename", "Propagate", 0.7, 6.9, ["A single function is renamed.", 0.4, "A disturbance ripples through the codebase."]),
            ("click", "Propagate", 7.2, 10.9, ["The agent is sent to restore order."]),
            ("lights", "Propagate", 12.0, 15.7, ["Four files.", 0.15, "Three folders.", 0.15, "Forty-one seconds."]),
            ("steps", "Propagate", 15.9, 20.7, ["Each change is inspected,", 0.25, "one by one."]),
            ("before", "Review", 0.45, 2.0, ["Before."]),
            ("after", "Review", 2.45, 4.0, ["After."]),
            ("diff", "Review", 4.25, 5.3, ["The difference."]),
            ("tests", "Review", 5.4, 8.0, ["And the tests,", 0.6, "survive."]),
            ("keep", "Keep", 0.9, 4.6, ["Keep it, or undo it.", 0.25, "Nature forgives."]),
            ("agents", "Agents", 0.1, 4.6, ["It thrives with Claude Code.", 0.15, "Codex and Cursor are in beta."]),
            ("setup", "Setup", 0.75, 3.9, ["To observe it yourself, one line is enough."]),
            ("end", "End", 0.4, 5.0, ["League of Agents.", 0.4, "Free, open source, and running on your machine."]),
        ],
    },
    "clear": {
        "voice": "am_michael",  # Kokoro's deepest, calmest American voice
        "speed": 1.2,  # a little quicker than the video
        "lines": [
            ("hook", "Hook", 0.2, 4.0, ["In under a minute, an agent changed code across your whole project."]),
            ("skim", "Skim", 0.3, 5.5, ["It leaves a long summary behind. Most people skim it, and say yes."]),
            ("logo", "Logo", 0.0, 3.3, ["League of Agents shows you what changed, and where."]),
            ("map", "Map", 0.4, 5.5, ["Your whole project, laid out as a map. Zoom in from the folders down to the code."]),
            ("point", "Point", 0.3, 3.4, ["Select the lines for the agent to work on."]),
            ("edit", "Point", 3.6, 7.5, ["Or edit the file yourself. Every save can be undone."]),
            ("rename", "Propagate", 0.4, 6.0, ["A function is renamed, and the tests fail: other files still use the old name."]),
            ("click", "Propagate", 6.2, 9.7, ["One click asks the agent to update everything that uses it."]),
            ("lights", "Propagate", 9.9, 13.9, ["Each folder lights up as the agent reaches it."]),
            ("steps", "Propagate", 14.2, 18.6, ["Then you step through every file it changed, one by one."]),
            ("review", "Review", 0.3, 6.6, ["See the code before, after, and exactly what changed. Your tests run on their own."]),
            ("keep", "Keep", 0.3, 3.8, ["If it's wrong, one click puts every file back."]),
            ("agents", "Agents", 0.1, 2.6, ["It works with the agents you already use."]),
            ("setup", "Setup", 0.2, 3.6, ["Set it up with one line, or one command."]),
            ("end", "End", 0.3, 4.5, ["Free, open source, and running on your own computer."]),
        ],
    },
}


def starts(cut):
    """Where each scene starts in this cut, in seconds, from src/timing.json."""
    timing = json.loads(Path("src/timing.json").read_text())
    lengths = {**timing["scenes"], **timing[cut]}
    out, at = {}, 0
    for name, frames in lengths.items():
        out[name] = at / 30
        at += frames - timing["transition"]
    return out


def level(x):
    """The same loudness for every line, without clipping."""
    x = x * (TARGET_RMS / np.sqrt(np.mean(x[np.abs(x) > 1e-4] ** 2)))
    return x * min(1.0, PEAK / np.max(np.abs(x)))


def main(cut, model, voices):
    spec, at = CUTS[cut], starts(cut)
    kokoro = Kokoro(
        model,
        voices,
        espeak_config=EspeakConfig(lib_path=f"{ESPEAK}/lib/libespeak-ng.dylib", data_path=f"{ESPEAK}/share/espeak-ng-data"),
    )
    out = Path("public/narration") / cut
    out.mkdir(parents=True, exist_ok=True)
    lines, late, previous_end = [], [], -GAP
    for name, scene, earliest, latest, parts in spec["lines"]:
        start, end = max(at[scene] + earliest, previous_end + GAP), at[scene] + latest
        pieces, sr = [], 24000
        for part in parts:
            if isinstance(part, float):
                pieces.append(np.zeros(int(part * sr)))
            else:
                spoken, sr = kokoro.create(part, voice=spec["voice"], speed=spec["speed"], lang="en-us")
                pieces.append(np.asarray(spoken, dtype=np.float64))
        audio = level(np.concatenate(pieces))
        text = " ".join(p for p in parts if isinstance(p, str))
        sf.write(out / f"{name}.wav", audio, sr, subtype="PCM_16")
        length = len(audio) / sr
        previous_end = start + length
        lines.append({"id": name, "start": round(start, 3), "seconds": round(length, 3), "text": text})
        if start + length > end:
            late.append(f"{name}: {length:.2f} s, {start + length - end:.2f} s past {end:.2f} s")
        print(f"{name:8s} {start:5.2f}–{start + length:5.2f} s (window to {end:.2f} s)  {text}")
    (out / "lines.json").write_text(json.dumps(lines, indent=2) + "\n")
    if late:
        sys.exit("Too long, shorten these lines:\n  " + "\n  ".join(late))


if __name__ == "__main__":
    main(*sys.argv[1:4])
