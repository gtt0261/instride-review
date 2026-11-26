"""Build previews from already published review evidence."""

import argparse
from fractions import Fraction
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from mobile_bench.review import inspect_sources, load_catalog


def frame_times(ffmpeg: str, file: Path) -> list[Fraction]:
    result = subprocess.check_output([
        ffmpeg, "-v", "error", "-i", str(file), "-map", "0:v:0",
        "-vf", "scale=2:2", "-enc_time_base", "1:120", "-fps_mode", "passthrough", "-f", "framehash", "-",
    ], text=True)
    clock = Fraction(next(line.split(": ")[1] for line in result.splitlines() if line.startswith("#tb ")))
    return [
        int(line.split(",")[2]) * clock
        for line in result.splitlines()
        if line and not line.startswith("#")
    ]


def prepare(site: Path, ffmpeg: str, selected: set[str]) -> None:
    cases = {}
    catalog = load_catalog(site)
    if selected - catalog.keys():
        raise ValueError(f"Unknown media cases: {sorted(selected - catalog.keys())}")
    for entry in catalog.values():
        if selected and entry["id"] not in selected:
            cases[entry["id"]], _ = inspect_sources(site, entry)
            continue
        case, route = inspect_sources(site, entry, previews=False)
        directory = site / entry["assets"]
        preview = directory / "preview"
        preview.mkdir(exist_ok=True)
        for key in case["key_frames"]:
            subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(directory / f"{key}.jpg"), "-frames:v", "1",
                "-vf", "scale=1120:-2:flags=lanczos", "-quality", "82",
                str(preview / f"{key}.webp"),
            ], check=True)

        source = directory / "expert.mp4"
        low = directory / "expert-540p.mp4"
        subprocess.run([
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
            "-map", "0:v:0", "-vf", "scale=960:540:flags=lanczos", "-an",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-maxrate", "900k",
            "-bufsize", "1400k", "-g", str(2 * route["fps"]), "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", "-enc_time_base", "1:120", "-video_track_timescale", "24000",
            "-fps_mode", "passthrough", "-threads", "4", str(low),
        ], check=True)
        expected_times = ([Fraction(step, route["frame_time_hz"]) for step in route["frame_control_steps"]]
                          if "frame_control_steps" in route else
                          [Fraction(frame[0], route["fps"]) for frame in route["frames"]])
        if frame_times(ffmpeg, source) != expected_times or frame_times(ffmpeg, low) != expected_times:
            raise ValueError(f"{source}: video presentation times differ from the recorded camera frames")
        cases[entry["id"]], _ = inspect_sources(site, entry)
        print(f"{entry['id']}: {len(expected_times)} frames aligned, "
              f"video {source.stat().st_size:,} → {low.stat().st_size:,} bytes", flush=True)

    index = site / "review-media.json"
    pending = index.with_suffix(".json.tmp")
    pending.write_text(json.dumps({"schema": "instride-review-media/1", "cases": cases},
                                  ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    pending.replace(index)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, default=ROOT)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--case", action="append", default=[])
    args = parser.parse_args()
    prepare(args.site, args.ffmpeg, set(args.case))
