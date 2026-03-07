"""
Generate 128k and 256k MP3 variants for non-MP3 audio files in the audio/ tree.

Usage:
  python scripts/convert_audio_mp3_variants.py
  python scripts/convert_audio_mp3_variants.py --audio-dir audio/music --overwrite
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

# Common audio source extensions. MP3 files are intentionally excluded.
SOURCE_EXTENSIONS = {
    ".wav",
    ".ogg",
    ".flac",
    ".aif",
    ".aiff",
    ".m4a",
    ".aac",
    ".wma",
    ".opus",
}

TARGET_BITRATES = ("128k", "256k")


def _find_source_files(audio_dir: Path) -> list[Path]:
    return sorted(
        p
        for p in audio_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in SOURCE_EXTENSIONS
    )


def _resolve_ffmpeg_binary() -> str | None:
    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        return ffmpeg_bin

    try:
        import imageio_ffmpeg  # type: ignore
    except ImportError:
        return None

    return imageio_ffmpeg.get_ffmpeg_exe()


def _convert_file(src: Path, bitrate: str, overwrite: bool, ffmpeg_bin: str) -> bool:
    dst = src.with_name(f"{src.stem}_{bitrate}.mp3")
    if dst.exists() and not overwrite:
        print(f"[skip] {dst} (already exists)")
        return False

    cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y" if overwrite else "-n",
        "-i",
        str(src),
        "-codec:a",
        "libmp3lame",
        "-b:a",
        bitrate,
        str(dst),
    ]
    subprocess.run(cmd, check=True)
    print(f"[ok]   {dst}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create 128k and 256k MP3 variants for non-MP3 audio files.",
    )
    parser.add_argument(
        "--audio-dir",
        default="audio",
        help="Path to the audio directory (default: audio)",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing output MP3 files.",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    audio_dir = (root / args.audio_dir).resolve()

    ffmpeg_bin = _resolve_ffmpeg_binary()
    if ffmpeg_bin is None:
        print(
            "Error: ffmpeg binary not found. Install ffmpeg system-wide or run:",
            file=sys.stderr,
        )
        print("  python -m pip install imageio-ffmpeg", file=sys.stderr)
        return 1

    if not audio_dir.exists() or not audio_dir.is_dir():
        print(f"Error: audio directory not found: {audio_dir}", file=sys.stderr)
        return 1

    source_files = _find_source_files(audio_dir)
    if not source_files:
        print(f"No source audio files found under: {audio_dir}")
        return 0

    print(f"Found {len(source_files)} source file(s) in {audio_dir}")

    converted = 0
    failed = 0

    for src in source_files:
        for bitrate in TARGET_BITRATES:
            try:
                if _convert_file(src, bitrate, args.overwrite, ffmpeg_bin):
                    converted += 1
            except subprocess.CalledProcessError:
                failed += 1
                print(f"[fail] {src} -> {bitrate}", file=sys.stderr)

    print(f"Done. Converted: {converted}, Failed: {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
