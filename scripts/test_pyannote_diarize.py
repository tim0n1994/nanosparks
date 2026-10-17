import contextlib
import importlib.util
import io
import os
import tempfile
import types
import unittest
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "pyannote_diarize", Path(__file__).with_name("pyannote_diarize.py")
)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class Annotation:
    def __init__(self, labels: list[str]) -> None:
        self.labels = labels

    def itertracks(
        self, yield_label: bool = False
    ) -> Iterator[tuple[types.SimpleNamespace, int, str]]:
        assert yield_label
        for index, label in enumerate(self.labels):
            turn = types.SimpleNamespace(start=index + 0.12345, end=index + 0.98765)
            yield turn, index, label


class PyannoteContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.calls = []
        self.output = types.SimpleNamespace(
            exclusive_speaker_diarization=Annotation(["A", "B", "A"]),
            speaker_diarization=Annotation(["overlap"]),
        )

        def load(checkpoint: str, *, token: str | None = None) -> Callable[[str], Any]:
            self.calls.append((checkpoint, token))
            return lambda audio_path: self.output

        audio = types.ModuleType("pyannote.audio")
        audio.Pipeline = types.SimpleNamespace(from_pretrained=load)
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.modules = patch.dict("sys.modules", {"pyannote.audio": audio})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        self.addCleanup(self.environment.stop)

    def test_hub_uses_v4_token_and_exclusive_output(self) -> None:
        result = adapter.diarize("audio.wav", hf_token="test-only")
        self.assertEqual(self.calls, [("pyannote/speaker-diarization-community-1", "test-only")])
        self.assertEqual(result["speakerCount"], 2)
        self.assertEqual([row["label"] for row in result["segments"]], ["A", "B", "A"])
        self.assertEqual(result["segments"][0]["start"], 0.123)

    def test_nonexclusive_selects_regular_annotation(self) -> None:
        result = adapter.diarize("audio.wav", use_exclusive=False, hf_token="test-only")
        self.assertEqual(result["segments"][0]["label"], "overlap")

    def test_hub_without_authorization_fails_before_load(self) -> None:
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit):
            adapter.diarize("audio.wav")
        self.assertEqual(self.calls, [])

    def test_explicit_local_directory_needs_no_token(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "config.yaml").write_text("fixture", encoding="utf8")
            result = adapter.diarize("audio.wav", model_dir=directory)
            self.assertEqual(self.calls, [(directory, None)])
            self.assertEqual(result["speakerCount"], 2)
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
            self.assertEqual(os.environ["PYANNOTE_METRICS_ENABLED"], "0")

    def test_environment_selects_local_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "config.yaml").write_text("fixture", encoding="utf8")
            os.environ["PYANNOTE_MODEL_DIR"] = directory
            adapter.diarize("audio.wav")
            self.assertEqual(self.calls, [(directory, None)])

    def test_invalid_local_directory_never_falls_back_to_hub(self) -> None:
        for directory in ("relative/model", "/nonexistent-pyannote-contract-fixture", ""):
            with self.subTest(directory=directory):
                with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit):
                    adapter.diarize("audio.wav", model_dir=directory)
        self.assertEqual(self.calls, [])

    def test_local_directory_requires_pipeline_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit):
                adapter.diarize("audio.wav", model_dir=directory)
        self.assertEqual(self.calls, [])

    def test_cli_forwards_model_directory_and_output_mode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            audio_path = Path(directory, "audio.wav")
            audio_path.write_bytes(b"fixture")
            with patch.object(adapter, "diarize", return_value={}) as run:
                argv = [
                    "script", "--audio", str(audio_path), "--model-dir", directory,
                    "--no-exclusive",
                ]
                with patch("sys.argv", argv):
                    with contextlib.redirect_stdout(io.StringIO()):
                        adapter.main()
            run.assert_called_once_with(str(audio_path), use_exclusive=False, model_dir=directory)


if __name__ == "__main__":
    unittest.main()
