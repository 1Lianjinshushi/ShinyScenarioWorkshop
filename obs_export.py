from __future__ import annotations

import os
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

from obs_controller import ObsRequestError, ObsWebSocketClient, ObsWebSocketError, probe_obs


class ObsExportManager:
    """Owns temporary OBS scenes and recording jobs for scenario export."""

    def __init__(
        self,
        project_root: Path,
        output_root: Path,
        base_url: str,
        find_ffmpeg: Callable[[], Path | None],
    ) -> None:
        self.project_root = project_root.resolve()
        self.output_root = output_root.resolve()
        self.base_url = str(base_url).rstrip("/")
        self.find_ffmpeg = find_ffmpeg
        self.jobs: dict[str, dict[str, Any]] = {}
        self.lock = threading.RLock()

    def probe(self, payload: dict[str, Any]) -> dict[str, Any]:
        port = self._port(payload.get("port"))
        password = str(payload.get("password") or "")
        result = probe_obs(port=port, password=password)
        result["audioSafe"] = not self._enabled_special_inputs(result.get("specialInputs"))
        result["encoderIsNvenc"] = "nvenc" in str(result.get("recordEncoder") or "").lower()
        return result

    def create(self, payload: dict[str, Any], validate_key: Callable[[object, str], str]) -> dict[str, Any]:
        event_type = validate_key(payload.get("eventType"), "eventType")
        event_id = validate_key(payload.get("eventId"), "eventId")
        port = self._port(payload.get("port"))
        password = str(payload.get("password") or "")
        job_id = uuid.uuid4().hex[:24]
        scene_name = f"SSV Export {job_id[:8]}"
        input_name = f"SSV Browser {job_id[:8]}"
        output_dir = (self.output_root / event_type).resolve()
        output_dir.relative_to(self.output_root)
        output_dir.mkdir(parents=True, exist_ok=True)
        work_dir = (self.output_root / ".work").resolve()
        work_dir.relative_to(self.output_root)
        work_dir.mkdir(parents=True, exist_ok=True)
        audio_path = work_dir / f"{job_id}.obs-audio.webm"
        audio_path.write_bytes(b"")
        player_url = self._player_url(job_id, event_type, event_id)
        client = ObsWebSocketClient(port=port, password=password, timeout=12.0).connect()
        client.password = ""

        now = self._now()
        job: dict[str, Any] = {
            "jobId": job_id,
            "backend": "obs",
            "eventType": event_type,
            "eventId": event_id,
            "state": "preparing",
            "stage": "正在准备 OBS 专用场景",
            "progress": 5,
            "createdAt": now,
            "updatedAt": now,
            "sceneName": scene_name,
            "inputName": input_name,
            "playerUrl": player_url,
            "outputDirectory": str(output_dir),
            "audioWorkPath": str(audio_path),
            "nextAudioChunk": 0,
            "audioUploadedBytes": 0,
            "client": client,
            "recordingStarted": False,
            "cleanupStarted": False,
        }
        with self.lock:
            self.jobs[job_id] = job

        try:
            self._prepare_obs(job)
            self._update(job, state="loading", stage="OBS 正在静音预载剧情、字体与资源", progress=15)
            return self.public(job)
        except Exception as error:
            self._update(job, state="error", stage="OBS 场景准备失败", error=str(error))
            self._cleanup(job, stop_recording=True)
            raise

    def get_public(self, job_id: object) -> dict[str, Any]:
        return self.public(self._job(job_id))

    def append_audio_chunk(self, job_id: object, index: int, content: bytes) -> dict[str, Any]:
        if not content:
            raise ValueError("OBS export audio chunk is empty")
        job = self._job(job_id)
        with self.lock:
            if job.get("state") not in {"loading", "recording", "finalizing"}:
                raise ValueError("OBS export is no longer receiving audio")
            expected = int(job.get("nextAudioChunk") or 0)
            if index != expected:
                raise ValueError(f"Unexpected OBS audio chunk {index}; expected {expected}")
            audio_path = Path(str(job.get("audioWorkPath") or ""))
            audio_path.parent.mkdir(parents=True, exist_ok=True)
            with audio_path.open("ab") as stream:
                stream.write(content)
            job["nextAudioChunk"] = expected + 1
            job["audioUploadedBytes"] = int(job.get("audioUploadedBytes") or 0) + len(content)
            job["updatedAt"] = self._now()
        return self.public(job)

    def player_ready(self, payload: dict[str, Any]) -> dict[str, Any]:
        job = self._job(payload.get("jobId"))
        with self.lock:
            if job.get("state") == "recording":
                return self.public(job)
            if job.get("state") != "loading":
                raise ValueError(f"OBS export cannot start from state {job.get('state')}")
            client = self._client(job)
            self._update(job, stage="资源预载完成，正在启动 OBS 录制", progress=25)
        record = client.request("GetRecordStatus")
        if record.get("outputActive"):
            raise ValueError("OBS is already recording")
        audio_started_at = self._epoch_milliseconds(payload.get("audioStartedAtEpochMs"))
        job["audioStartedAtEpochMs"] = audio_started_at
        job["audioMimeType"] = str(payload.get("audioMimeType") or "audio/webm")[:200]
        job["statsAtStart"] = self._try_get_stats(client)
        record_start_request_at = int(time.time() * 1000)
        client.request("StartRecord")
        record_started_at = (record_start_request_at + int(time.time() * 1000)) // 2
        job["recordingStarted"] = True
        job["recordStartedAtEpochMs"] = record_started_at
        job["audioTrimMs"] = max(0, record_started_at - audio_started_at)
        self._update(
            job,
            state="recording",
            stage="OBS 正在录制画面；播放器正在独立采集剧情混音（不会外放）",
            progress=35,
            startedAt=self._now(),
        )
        return self.public(job)

    def player_finished(self, payload: dict[str, Any]) -> dict[str, Any]:
        job = self._job(payload.get("jobId"))
        with self.lock:
            if job.get("state") in {"finalizing", "ready"}:
                return self.public(job)
            if job.get("state") != "recording":
                raise ValueError(f"OBS export cannot finish from state {job.get('state')}")
            if int(job.get("audioUploadedBytes") or 0) <= 0:
                raise ValueError("播放器没有送回独立剧情音轨，已拒绝生成可能卡音的成片")
            job["audioDurationMs"] = max(0, int(float(payload.get("audioDurationMs") or 0)))
            job["audioChunkCount"] = max(0, int(float(payload.get("audioChunkCount") or 0)))
            self._update(job, state="finalizing", stage="剧情结束，正在停止 OBS 并整理 MP4", progress=82)
        threading.Thread(target=self._finish_job, args=(str(job["jobId"]),), daemon=True).start()
        return self.public(job)

    def player_error(self, payload: dict[str, Any]) -> dict[str, Any]:
        job = self._job(payload.get("jobId"))
        message = str(payload.get("error") or "OBS 浏览器源报告了未知错误")[:2000]
        self._update(job, state="error", stage="OBS 浏览器源播放失败", error=message)
        threading.Thread(target=self._cleanup, args=(job, True), daemon=True).start()
        return self.public(job)

    def cancel(self, payload: dict[str, Any]) -> dict[str, Any]:
        job = self._job(payload.get("jobId"))
        if job.get("state") == "ready":
            return self.public(job)
        self._update(job, state="error", stage="OBS 直出已取消", error="用户取消了 OBS 视频直出")
        threading.Thread(target=self._cleanup, args=(job, True), daemon=True).start()
        return self.public(job)

    def public(self, job: dict[str, Any]) -> dict[str, Any]:
        keys = (
            "jobId", "backend", "eventType", "eventId", "state", "stage", "progress",
            "createdAt", "updatedAt", "startedAt", "durationMs", "outputUrl", "outputPath",
            "rawOutputPath", "recordEncoder", "outputMode", "obsVersion", "profile", "error",
            "audioUploadedBytes", "audioTrimMs", "audioDurationMs", "obsStats", "qualityWarning",
        )
        return {key: job.get(key) for key in keys if job.get(key) not in (None, "")}

    def _prepare_obs(self, job: dict[str, Any]) -> None:
        client = self._client(job)
        version = client.request("GetVersion")
        available = set(version.get("availableRequests") or [])
        required = {
            "GetRecordStatus", "GetStreamStatus", "GetSpecialInputs", "GetCurrentProgramScene",
            "GetVideoSettings", "SetVideoSettings", "GetRecordDirectory", "SetRecordDirectory",
            "CreateScene", "RemoveScene", "CreateInput", "RemoveInput", "SetInputAudioMonitorType",
            "SetCurrentProgramScene", "StartRecord", "StopRecord",
        }
        missing = sorted(required - available)
        if missing:
            raise ValueError(f"OBS WebSocket is missing required requests: {', '.join(missing)}")
        record = client.request("GetRecordStatus")
        if record.get("outputActive"):
            raise ValueError("OBS is already recording; stop the existing recording first")
        stream = client.request("GetStreamStatus")
        if stream.get("outputActive"):
            raise ValueError("OBS is currently streaming; the workshop will not change scenes while streaming")
        special_inputs = client.request("GetSpecialInputs")
        enabled_audio = self._enabled_special_inputs(special_inputs)
        if enabled_audio:
            labels = ", ".join(enabled_audio)
            raise ValueError(
                f"OBS still has global audio devices enabled ({labels}). Disable Desktop Audio and all Mic/Aux devices "
                "in Settings > Audio so Bluetooth quality and the recording track stay clean."
            )

        current_scene = client.request("GetCurrentProgramScene")
        video = client.request("GetVideoSettings")
        record_directory = client.request("GetRecordDirectory")
        profiles = client.request("GetProfileList")
        mode_parameter = client.request("GetProfileParameter", {
            "parameterCategory": "Output",
            "parameterName": "Mode",
        })
        output_mode = str(mode_parameter.get("parameterValue") or mode_parameter.get("defaultParameterValue") or "")
        encoder_category = "AdvOut" if output_mode.lower() == "advanced" else "SimpleOutput"
        encoder_parameter = client.request("GetProfileParameter", {
            "parameterCategory": encoder_category,
            "parameterName": "RecEncoder",
        })
        record_encoder = str(encoder_parameter.get("parameterValue") or encoder_parameter.get("defaultParameterValue") or "")

        job.update({
            "previousSceneName": current_scene.get("sceneName") or current_scene.get("currentProgramSceneName"),
            "previousVideoSettings": video,
            "previousRecordDirectory": record_directory.get("recordDirectory"),
            "obsVersion": version.get("obsVersion"),
            "profile": profiles.get("currentProfileName"),
            "outputMode": output_mode,
            "recordEncoder": record_encoder,
        })

        desired_video = {
            "fpsNumerator": 60,
            "fpsDenominator": 1,
            "baseWidth": 1920,
            "baseHeight": 1080,
            "outputWidth": 1920,
            "outputHeight": 1080,
        }
        if any(int(video.get(key) or 0) != value for key, value in desired_video.items()):
            client.request("SetVideoSettings", desired_video)
            job["videoSettingsChanged"] = True
        client.request("SetRecordDirectory", {"recordDirectory": str(job["outputDirectory"])})
        job["recordDirectoryChanged"] = True
        scene = client.request("CreateScene", {"sceneName": str(job["sceneName"])})
        job["sceneUuid"] = scene.get("sceneUuid")
        created = client.request("CreateInput", {
            "sceneName": str(job["sceneName"]),
            "inputName": str(job["inputName"]),
            "inputKind": "browser_source",
            "inputSettings": {
                "url": str(job["playerUrl"]),
                "width": 1920,
                "height": 1080,
                "fps": 60,
                "reroute_audio": True,
                "shutdown": False,
                "restart_when_active": False,
            },
            "sceneItemEnabled": True,
        })
        job["inputUuid"] = created.get("inputUuid")
        job["sceneItemId"] = created.get("sceneItemId")
        client.request("SetInputAudioMonitorType", {
            "inputName": str(job["inputName"]),
            "monitorType": "OBS_MONITORING_TYPE_NONE",
        })
        client.request("SetInputMute", {
            "inputName": str(job["inputName"]),
            "inputMuted": False,
        })
        client.request("SetCurrentProgramScene", {"sceneName": str(job["sceneName"])})
        job["sceneActivated"] = True

    def _finish_job(self, job_id: str) -> None:
        try:
            job = self._job(job_id)
            client = self._client(job)
            response = client.request("StopRecord")
            job["recordingStarted"] = False
            raw_path = Path(str(response.get("outputPath") or "")).resolve()
            self._wait_for_stable_recording(raw_path)
            job["rawOutputPath"] = str(raw_path)
            self._save_obs_stats(job, self._try_get_stats(client))
            self._update(job, stage="OBS 录制完成，正在封装最终 MP4", progress=90)
            self._cleanup(job, stop_recording=False)
            output_path = self._package_recording(job, raw_path)
            cache_buster = int(time.time() * 1000)
            output_url = (
                f"./exports/video/{job['eventType']}/{job['eventId']}.mp4?v={cache_buster}"
            )
            self._update(
                job,
                state="ready",
                stage="OBS 视频已导出",
                progress=100,
                outputPath=str(output_path),
                outputUrl=output_url,
                durationMs=max(0, int((time.time() - self._parse_epoch(job.get("startedAt"))) * 1000)),
            )
        except Exception as error:
            try:
                job = self._job(job_id)
                self._update(job, state="error", stage="OBS 视频整理失败", error=str(error))
                self._cleanup(job, stop_recording=True)
            except Exception:
                pass

    def _package_recording(self, job: dict[str, Any], raw_path: Path) -> Path:
        destination = (self.output_root / str(job["eventType"]) / f"{job['eventId']}.mp4").resolve()
        destination.relative_to(self.output_root)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if raw_path == destination:
            return destination
        temporary = destination.with_name(f".{destination.stem}.{job['jobId']}.tmp.mp4")
        if temporary.exists():
            temporary.unlink()
        audio_path = Path(str(job.get("audioWorkPath") or ""))
        if not audio_path.is_file() or audio_path.stat().st_size <= 0:
            raise RuntimeError("播放器独立音轨缺失；为避免交付卡音视频，本次导出已停止")
        ffmpeg = self.find_ffmpeg()
        if ffmpeg is None:
            raise RuntimeError("找不到 FFmpeg，无法把独立剧情音轨与 OBS 画面合并")
        audio_trim_seconds = max(0.0, float(job.get("audioTrimMs") or 0) / 1000)
        audio_filter = (
            f"atrim=start={audio_trim_seconds:.6f},asetpts=PTS-STARTPTS,"
            "aresample=48000:async=1:first_pts=0,apad"
        )
        command = [
            str(ffmpeg), "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(raw_path), "-i", str(audio_path),
            "-filter_complex", f"[1:a:0]{audio_filter}[audio]",
            "-map", "0:v:0", "-map", "[audio]", "-c:v", "copy",
            "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart", "-shortest", str(temporary),
        ]
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=creation_flags,
            timeout=240,
        )
        if completed.returncode != 0 or not temporary.is_file() or temporary.stat().st_size <= 0:
            try:
                if temporary.is_file():
                    temporary.unlink()
            except OSError:
                pass
            raise RuntimeError(completed.stderr.strip() or "FFmpeg could not combine OBS video and scenario audio")
        os.replace(temporary, destination)
        try:
            raw_path.unlink()
        except OSError:
            pass
        try:
            audio_path.unlink()
        except OSError:
            pass
        return destination

    def _wait_for_stable_recording(self, raw_path: Path, timeout: float = 30.0) -> None:
        deadline = time.monotonic() + timeout
        previous: tuple[int, int] | None = None
        stable_checks = 0
        while time.monotonic() < deadline:
            try:
                stat = raw_path.stat()
                current = (stat.st_size, stat.st_mtime_ns)
            except OSError:
                current = (0, 0)
            if current[0] > 0 and current == previous:
                stable_checks += 1
                # OBS's fragmented/hybrid MP4 finalizer may continue writing for
                # several seconds after StopRecord has returned. Four seconds
                # of unchanged size/mtime avoids copying the prefix of a file
                # whose final audio packets and index are still being flushed.
                if stable_checks >= 8:
                    return
            else:
                stable_checks = 0
            previous = current
            time.sleep(0.5)
        raise RuntimeError(f"OBS recording did not finish writing within {int(timeout)} seconds: {raw_path}")

    @staticmethod
    def _try_get_stats(client: ObsWebSocketClient) -> dict[str, Any]:
        try:
            return client.request("GetStats")
        except ObsWebSocketError:
            return {}

    def _save_obs_stats(self, job: dict[str, Any], final: dict[str, Any]) -> None:
        initial = job.get("statsAtStart") if isinstance(job.get("statsAtStart"), dict) else {}
        result = {
            "activeFps": final.get("activeFps"),
            "averageFrameRenderTime": final.get("averageFrameRenderTime"),
            "cpuUsage": final.get("cpuUsage"),
            "memoryUsage": final.get("memoryUsage"),
        }
        for key in ("renderSkippedFrames", "renderTotalFrames", "outputSkippedFrames", "outputTotalFrames"):
            result[key] = max(0, int(final.get(key) or 0) - int(initial.get(key) or 0))
        job["obsStats"] = result
        skipped = int(result.get("renderSkippedFrames") or 0) + int(result.get("outputSkippedFrames") or 0)
        if skipped:
            job["qualityWarning"] = f"OBS 本次共报告 {skipped} 个渲染/输出跳帧；建议导出时减少其他 GPU 视频任务"

    def _cleanup(self, job: dict[str, Any], stop_recording: bool = False) -> None:
        if job.get("state") == "error":
            audio_path = Path(str(job.get("audioWorkPath") or ""))
            try:
                if audio_path.is_file():
                    audio_path.unlink()
            except OSError:
                pass
        with self.lock:
            if job.get("cleanupStarted"):
                return
            job["cleanupStarted"] = True
        client = job.get("client")
        if client is None or not callable(getattr(client, "request", None)):
            return
        if stop_recording and job.get("recordingStarted"):
            try:
                status = client.request("GetRecordStatus")
                if status.get("outputActive"):
                    client.request("StopRecord")
            except ObsWebSocketError:
                pass
            job["recordingStarted"] = False
        previous_scene = str(job.get("previousSceneName") or "")
        if previous_scene and job.get("sceneActivated"):
            try:
                client.request("SetCurrentProgramScene", {"sceneName": previous_scene})
            except ObsWebSocketError:
                pass
        if job.get("inputUuid") or job.get("inputName"):
            try:
                client.request("RemoveInput", {"inputName": str(job.get("inputName") or "")})
            except ObsWebSocketError:
                pass
        if job.get("sceneUuid") or job.get("sceneName"):
            try:
                client.request("RemoveScene", {"sceneName": str(job.get("sceneName") or "")})
            except ObsWebSocketError:
                pass
        if job.get("videoSettingsChanged") and isinstance(job.get("previousVideoSettings"), dict):
            try:
                client.request("SetVideoSettings", dict(job["previousVideoSettings"]))
            except ObsWebSocketError:
                pass
        if job.get("recordDirectoryChanged") and job.get("previousRecordDirectory"):
            try:
                client.request("SetRecordDirectory", {
                    "recordDirectory": str(job["previousRecordDirectory"]),
                })
            except ObsWebSocketError:
                pass
        client.close()
        job["client"] = None

    def _player_url(self, job_id: str, event_type: str, event_id: str) -> str:
        query = urlencode({
            "eventType": event_type,
            "eventId": event_id,
            "source": "remote",
            "language": "cn",
            "mode": "obs-export",
            "obsJob": job_id,
            "translationRevision": str(int(time.time() * 1000)),
        })
        return f"{self.base_url}/?{query}"

    def _job(self, job_id: object) -> dict[str, Any]:
        key = str(job_id or "")
        if not key or len(key) > 64 or not key.isalnum():
            raise ValueError("Invalid OBS export job")
        with self.lock:
            job = self.jobs.get(key)
            if not job:
                raise ValueError("Unknown OBS export job")
            return job

    @staticmethod
    def _client(job: dict[str, Any]) -> ObsWebSocketClient:
        client = job.get("client")
        if client is None or not callable(getattr(client, "request", None)):
            raise RuntimeError("OBS connection is no longer available for this export")
        return client  # type: ignore[return-value]

    @staticmethod
    def _enabled_special_inputs(value: object) -> list[str]:
        if not isinstance(value, dict):
            return []
        labels = {
            "desktop1": "Desktop Audio",
            "desktop2": "Desktop Audio 2",
            "mic1": "Mic/Aux",
            "mic2": "Mic/Aux 2",
            "mic3": "Mic/Aux 3",
            "mic4": "Mic/Aux 4",
        }
        return [label for key, label in labels.items() if value.get(key)]

    @staticmethod
    def _port(value: object) -> int:
        try:
            port = int(value or 4455)
        except (TypeError, ValueError) as error:
            raise ValueError("OBS WebSocket port must be a number") from error
        if not 1 <= port <= 65535:
            raise ValueError("OBS WebSocket port must be between 1 and 65535")
        return port

    @staticmethod
    def _epoch_milliseconds(value: object) -> int:
        try:
            result = int(float(value or 0))
        except (TypeError, ValueError) as error:
            raise ValueError("播放器没有提供独立音轨的起始时间") from error
        now = int(time.time() * 1000)
        if result <= 0 or abs(now - result) > 60_000:
            raise ValueError("播放器独立音轨的起始时间无效")
        return result

    def _update(self, job: dict[str, Any], **values: Any) -> None:
        with self.lock:
            job.update(values)
            job["updatedAt"] = self._now()

    @staticmethod
    def _now() -> str:
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds")

    @staticmethod
    def _parse_epoch(value: object) -> float:
        from datetime import datetime
        try:
            return datetime.fromisoformat(str(value)).timestamp()
        except (TypeError, ValueError):
            return time.time()


__all__ = ["ObsExportManager", "ObsRequestError", "ObsWebSocketError"]
