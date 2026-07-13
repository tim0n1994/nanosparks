#!/usr/bin/env python3
import sys
import json
import os

try:
    import whisper
except ImportError:
    print(json.dumps({"error": "openai-whisper not installed. Run: pip install openai-whisper"}), file=sys.stderr)
    sys.exit(1)

audio_path = sys.argv[1]
model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

if not os.path.exists(audio_path):
    print(json.dumps({"error": f"Audio file not found: {audio_path}"}), file=sys.stderr)
    sys.exit(1)

model = whisper.load_model(model_size)
result = model.transcribe(audio_path, verbose=False)

segments = []
for seg in result.get("segments", []):
    segments.append({
        "start": seg["start"],
        "end": seg["end"],
        "text": seg["text"].strip(),
    })

output = {
    "text": result.get("text", "").strip(),
    "language": result.get("language", "en"),
    "segments": segments,
}

print(json.dumps(output, ensure_ascii=False))
