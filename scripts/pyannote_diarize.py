#!/usr/bin/env python3
"""
Speaker diarization using pyannote.audio 4.0 community-1 pipeline.

Uses exclusive mode: at each time step, only the most likely speaker
(considering the transcription) is kept. This eliminates the need for
complex WhisperX-style alignment glue.

Usage:
    python3 scripts/pyannote_diarize.py --audio <path> --format json

Requires:
    pip install pyannote.audio
    HF token with access to pyannote/speaker-diarization-community-1,
    or --model-dir /absolute/local/model (also PYANNOTE_MODEL_DIR).

Output (JSON):
    {
      "segments": [
        {"label": "SPEAKER_00", "start": 0.0, "end": 5.2, "confidence": 0.95},
        ...
      ],
      "speakerCount": 2
    }
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


def diarize(
    audio_path: str,
    use_exclusive: bool = True,
    hf_token: str | None = None,
    model_dir: str | None = None,
) -> dict[str, Any]:
    """Run pyannote diarization and return speaker segments."""
    local_dir = model_dir if model_dir is not None else os.environ.get("PYANNOTE_MODEL_DIR")
    if local_dir is not None:
        directory = Path(local_dir)
        if not directory.is_absolute() or not (directory / "config.yaml").is_file():
            print(json.dumps({
                "error": "Local model must be an absolute directory containing config.yaml"
            }))
            sys.exit(1)
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["PYANNOTE_METRICS_ENABLED"] = "0"

    try:
        from pyannote.audio import Pipeline
    except ImportError:
        print(json.dumps({
            "error": "pyannote.audio not installed. Run: pip install pyannote.audio"
        }))
        sys.exit(1)

    token = hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if local_dir is None and not token:
        print(json.dumps({
            "error": (
                "HF_TOKEN not set. Create a token at https://huggingface.co/settings/tokens"
                " and accept the model license at "
                "https://huggingface.co/pyannote/speaker-diarization-community-1"
            )
        }))
        sys.exit(1)

    pipeline = Pipeline.from_pretrained(
        local_dir if local_dir is not None else "pyannote/speaker-diarization-community-1",
        token=None if local_dir is not None else token,
    )
    if pipeline is None:
        raise RuntimeError("Pyannote pipeline could not be loaded")
    output = pipeline(audio_path)
    diarization = (
        output.exclusive_speaker_diarization
        if use_exclusive
        else output.speaker_diarization
    )

    segments = []
    labels = set()

    for turn, _, label in diarization.itertracks(yield_label=True):
        segments.append({
            "label": label,
            "start": round(turn.start, 3),
            "end": round(turn.end, 3),
            "confidence": 0.9,  # pyannote doesn't expose per-segment confidence; use default
        })
        labels.add(label)

    return {
        "segments": segments,
        "speakerCount": len(labels),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Speaker diarization with pyannote")
    parser.add_argument("--audio", required=True, help="Path to audio file")
    parser.add_argument("--format", default="json", choices=["json"])
    parser.add_argument("--no-exclusive", action="store_true", help="Disable exclusive mode")
    parser.add_argument(
        "--model-dir", help="Absolute local model directory containing config.yaml"
    )
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        print(json.dumps({"error": f"Audio file not found: {args.audio}"}))
        sys.exit(1)

    result = diarize(args.audio, use_exclusive=not args.no_exclusive, model_dir=args.model_dir)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
