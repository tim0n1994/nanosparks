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
    HF token with access to pyannote/speaker-diarization-community-1

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
import sys
import os


def diarize(audio_path: str, use_exclusive: bool = True, hf_token: str | None = None):
    """Run pyannote diarization and return speaker segments."""
    try:
        from pyannote.audio import Pipeline
    except ImportError:
        print(json.dumps({
            "error": "pyannote.audio not installed. Run: pip install pyannote.audio"
        }))
        sys.exit(1)

    token = hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if not token:
        print(json.dumps({
            "error": "HF_TOKEN not set. Create a token at https://huggingface.co/settings/tokens"
                     " and accept the model license at https://huggingface.co/pyannote/speaker-diarization-community-1"
        }))
        sys.exit(1)

    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-community-1",
        use_auth_token=token,
    )

    # community-1 supports exclusive mode parameter
    if use_exclusive:
        try:
            pipeline.exclusive_mode = True
        except (AttributeError, TypeError):
            # Older versions don't have exclusive mode — proceed without it
            pass

    diarization = pipeline(audio_path)

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


def main():
    parser = argparse.ArgumentParser(description="Speaker diarization with pyannote")
    parser.add_argument("--audio", required=True, help="Path to audio file")
    parser.add_argument("--format", default="json", choices=["json"])
    parser.add_argument("--no-exclusive", action="store_true", help="Disable exclusive mode")
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        print(json.dumps({"error": f"Audio file not found: {args.audio}"}))
        sys.exit(1)

    result = diarize(args.audio, use_exclusive=not args.no_exclusive)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
