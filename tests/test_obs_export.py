from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from obs_export import ObsExportManager


REQUIRED_REQUESTS = {
    "GetRecordStatus", "GetStreamStatus", "GetSpecialInputs", "GetCurrentProgramScene",
    "GetVideoSettings", "SetVideoSettings", "GetRecordDirectory", "SetRecordDirectory",
    "CreateScene", "RemoveScene", "CreateInput", "RemoveInput", "SetInputAudioMonitorType",
    "SetCurrentProgramScene", "StartRecord", "StopRecord", "SetInputMute",
}


class FakeObsClient:
    def __init__(self, output_dir: Path, special_inputs: dict[str, object] | None = None) -> None:
        self.output_dir = output_dir
        self.special_inputs = special_inputs or {}
        self.password = "secret"
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.closed = False

    def connect(self) -> "FakeObsClient":
        return self

    def close(self) -> None:
        self.closed = True

    def request(self, request_type: str, data: dict[str, object] | None = None) -> dict[str, object]:
        request_data = dict(data or {})
        self.calls.append((request_type, request_data))
        if request_type == "GetVersion":
            return {
                "obsVersion": "31.0.2",
                "obsWebSocketVersion": "5.5.5",
                "availableRequests": sorted(REQUIRED_REQUESTS | {
                    "GetProfileList", "GetProfileParameter",
                }),
            }
        if request_type == "GetRecordStatus":
            return {"outputActive": False}
        if request_type == "GetStreamStatus":
            return {"outputActive": False}
        if request_type == "GetSpecialInputs":
            return dict(self.special_inputs)
        if request_type == "GetCurrentProgramScene":
            return {"sceneName": "Original Scene"}
        if request_type == "GetVideoSettings":
            return {
                "fpsNumerator": 30, "fpsDenominator": 1,
                "baseWidth": 1280, "baseHeight": 720,
                "outputWidth": 1280, "outputHeight": 720,
            }
        if request_type == "GetRecordDirectory":
            return {"recordDirectory": str(self.output_dir / "old")}
        if request_type == "GetProfileList":
            return {"currentProfileName": "Test Profile", "profiles": ["Test Profile"]}
        if request_type == "GetProfileParameter":
            if request_data.get("parameterCategory") == "Output":
                return {"parameterValue": "Advanced"}
            return {"parameterValue": "jim_nvenc"}
        if request_type == "CreateScene":
            return {"sceneUuid": "scene-uuid"}
        if request_type == "CreateInput":
            return {"inputUuid": "input-uuid", "sceneItemId": 42}
        if request_type == "StopRecord":
            raw = self.output_dir / "obs-recording.mp4"
            raw.parent.mkdir(parents=True, exist_ok=True)
            raw.write_bytes(b"fake mp4 data")
            return {"outputPath": str(raw)}
        return {}


class ObsExportManagerTests(unittest.TestCase):
    @staticmethod
    def validate_key(value: object, _label: str) -> str:
        text = str(value or "")
        if not text.replace("_", "").isalnum():
            raise ValueError("invalid key")
        return text

    def test_complete_job_creates_and_restores_temporary_obs_scene(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fake = FakeObsClient(root)
            manager = ObsExportManager(root, root / "exports" / "video", "http://127.0.0.1:8000", lambda: None)
            with patch("obs_export.ObsWebSocketClient", return_value=fake):
                created = manager.create({
                    "eventType": "produce_events",
                    "eventId": "202701011",
                    "port": 4455,
                    "password": "secret",
                }, self.validate_key)
            self.assertEqual(created["state"], "loading")
            self.assertEqual(created["recordEncoder"], "jim_nvenc")
            manager.player_ready({
                "jobId": created["jobId"],
                "audioStartedAtEpochMs": int(time.time() * 1000),
                "audioMimeType": "audio/webm;codecs=opus",
            })
            manager.append_audio_chunk(created["jobId"], 0, b"fake opus audio")
            packaged = root / "exports" / "video" / "produce_events" / "202701011.mp4"
            packaged.parent.mkdir(parents=True, exist_ok=True)
            packaged.write_bytes(b"packaged fake mp4")
            with patch.object(manager, "_wait_for_stable_recording"), patch.object(
                manager, "_package_recording", return_value=packaged,
            ):
                manager._finish_job(created["jobId"])
            completed = manager.get_public(created["jobId"])
            self.assertEqual(completed["state"], "ready")
            self.assertTrue(Path(str(completed["outputPath"])).is_file())
            names = [name for name, _ in fake.calls]
            self.assertIn("StartRecord", names)
            self.assertIn("StopRecord", names)
            self.assertIn("RemoveInput", names)
            self.assertIn("RemoveScene", names)
            self.assertTrue(fake.closed)

    def test_obs_audio_chunks_must_arrive_in_order(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fake = FakeObsClient(root)
            manager = ObsExportManager(root, root / "exports" / "video", "http://127.0.0.1:8000", lambda: None)
            with patch("obs_export.ObsWebSocketClient", return_value=fake):
                created = manager.create({
                    "eventType": "produce_events",
                    "eventId": "202701011",
                    "password": "secret",
                }, self.validate_key)
            with self.assertRaisesRegex(ValueError, "expected 0"):
                manager.append_audio_chunk(created["jobId"], 1, b"late")
            result = manager.append_audio_chunk(created["jobId"], 0, b"first")
            self.assertEqual(result["audioUploadedBytes"], 5)

    def test_global_microphone_blocks_export_before_recording(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fake = FakeObsClient(root, {"mic1": "Headset Microphone"})
            manager = ObsExportManager(root, root / "exports" / "video", "http://127.0.0.1:8000", lambda: None)
            with patch("obs_export.ObsWebSocketClient", return_value=fake):
                with self.assertRaisesRegex(ValueError, "Mic/Aux"):
                    manager.create({
                        "eventType": "produce_events",
                        "eventId": "202701011",
                        "password": "secret",
                    }, self.validate_key)
            self.assertNotIn("StartRecord", [name for name, _ in fake.calls])
            self.assertTrue(fake.closed)


if __name__ == "__main__":
    unittest.main()
