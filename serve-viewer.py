from __future__ import annotations

import csv
import io
import json
import os
import re
import secrets
import shutil
import subprocess
import time
import webbrowser
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from threading import Lock, Thread, Timer
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

from obs_export import ObsExportManager


HOST = "127.0.0.1"
PORT = int(os.environ.get("SSV_PORT", "8000"))
PROJECT_ROOT = Path(__file__).resolve().parent
ASSET_ROOT = PROJECT_ROOT / "assets"
EXPORT_ROOT = PROJECT_ROOT / "exports"
TRANSLATION_ROOT = PROJECT_ROOT / "translations"
VIDEO_EXPORT_ROOT = EXPORT_ROOT / "video"
VIDEO_EXPORT_WORK_ROOT = VIDEO_EXPORT_ROOT / ".work"
# The real-time renderer is intentionally frozen. Keep the implementation in
# tree for later development, but never start a new recording from a released
# local workshop until background timing/audio are proven stable again.
VIDEO_EXPORT_ENABLED = False
SPEAKER_ROOT = PROJECT_ROOT / "speaker"
SPEAKER_CSV = SPEAKER_ROOT / "speaker.csv"
# LOCAL_MONITOR_BEGIN
MONITOR_ROOT = PROJECT_ROOT / "monitor"
MONITOR_STATE = MONITOR_ROOT / "game-update-state.json"
# LOCAL_MONITOR_END
LEGACY_SPEAKER_CSV = Path(r"D:\ShinyColorsDB-EventViewer-main\speaker\speaker.csv")
BASE_URL = f"http://{HOST}:{PORT}"
APP_URL = f"{BASE_URL}/app.html"
MAX_BODY_SIZE = 128 * 1024 * 1024
MAX_EXTERNAL_CARD_SIZE = 32 * 1024 * 1024
MAX_EXTERNAL_MOVIE_SIZE = 192 * 1024 * 1024
COMMUNITY_CARD_ROOT = "https://cf-static.shinycolors.moe"
DATASITE_API_ROOT = "https://api.shinycolors.moe"
STORY_PATH_URL = "https://raw.githubusercontent.com/biuuu/ShinyColors/gh-pages/story-path.json"
SC_VIEWER_NAME_URL = "https://service.sc-viewer.top/name"
REMOTE_SCENARIO_ROOTS = (
    "https://service.sc-viewer.top/custom/json",
    "https://service.sc-viewer.top/convert/cache/json",
)
METADATA_ROOT = PROJECT_ROOT / "metadata"
SCENARIO_METADATA_CACHE = METADATA_ROOT / "scenario-titles.json"
LIBRARY_GROUP_METADATA_CACHE = METADATA_ROOT / "scenario-library-groups.json"
CARD_IDENTITY_CACHE = METADATA_ROOT / "card-identities.json"
SAFE_KEY = re.compile(r"^[A-Za-z0-9_-]+$")
ALLOWED_ASSET_ROOTS = {"images", "json", "movies", "particles", "sounds", "spine"}
# LOCAL_MONITOR_BEGIN
MAX_MONITOR_ENTRIES = 20000
MONITOR_STATE_VERSION = 6
# The original 0.4 listener established its first baseline after the 2026-08-07
# preload had already landed, so those rows could not be distinguished from the
# older archive.  These ids are the one known baseline gap confirmed against
# that update.  Future updates are detected from the official scenario diff and
# do not need a dated recovery list.
MONITOR_V3_RECOVERY_UPDATES = {
    "2026-08-07T06:00:00+00:00": (
        ("produce_events", "201002001"),
        ("produce_events", "201002002"),
        ("produce_events", "201002003"),
        ("produce_events", "201002004"),
        ("produce_events", "201002011"),
        ("produce_events", "300402701"),
        ("produce_events", "300402702"),
        ("produce_events", "300502501"),
        ("produce_events", "300502502"),
        ("produce_events", "301302801"),
        ("produce_events", "301602701"),
        ("produce_events", "301602702"),
        ("special_communications", "4902008013"),
    ),
}
# LOCAL_MONITOR_END

CHARACTER_ARCHIVE_INFO = {
    "001": ("真乃", "星组组活", ("櫻木真乃", "樱木真乃", "真乃")),
    "002": ("灯织", "星组组活", ("風野灯織", "风野灯织", "灯織", "灯织")),
    "003": ("巡", "星组组活", ("八宮めぐる", "八宫巡", "めぐる", "巡")),
    "004": ("恋钟", "安提卡组活", ("月岡恋鐘", "月冈恋钟", "恋鐘", "恋钟")),
    "005": ("摩美美", "安提卡组活", ("田中摩美々", "田中摩美美", "摩美々", "摩美美")),
    "006": ("咲耶", "安提卡组活", ("白瀬咲耶", "白濑咲耶", "咲耶")),
    "007": ("结华", "安提卡组活", ("三峰結華", "三峰结华", "結華", "结华")),
    "008": ("雾子", "安提卡组活", ("幽谷霧子", "幽谷雾子", "霧子", "雾子")),
    "009": ("果穗", "放课后组活", ("小宮果穂", "小宫果穗", "果穂", "果穗", "カホ")),
    "010": ("智代子", "放课后组活", ("園田智代子", "园田智代子", "智代子", "チヨコ")),
    "011": ("树里", "放课后组活", ("西城樹里", "西城树里", "樹里", "树里", "ジュリ")),
    "012": ("凛世", "放课后组活", ("杜野凛世", "凛世", "リンゼ")),
    "013": ("夏叶", "放课后组活", ("有栖川夏葉", "有栖川夏叶", "夏葉", "夏叶", "ナツハ")),
    "014": ("甘奈", "花组组活", ("大崎甘奈", "甘奈")),
    "015": ("甜花", "花组组活", ("大崎甜花", "甜花")),
    "016": ("千雪", "花组组活", ("桑山千雪", "千雪")),
    "017": ("朝日", "迷光组活", ("芹沢あさひ", "芹泽朝日", "あさひ", "朝日")),
    "018": ("冬优子", "迷光组活", ("黛冬優子", "黛冬优子", "冬優子", "冬优子")),
    "019": ("爱依", "迷光组活", ("和泉愛依", "和泉爱依", "愛依", "爱依")),
    "020": ("透", "水组组活", ("浅倉透", "浅仓透", "透")),
    "021": ("圆香", "水组组活", ("樋口円香", "樋口圆香", "円香", "圆香")),
    "022": ("小糸", "水组组活", ("福丸小糸", "小糸")),
    "023": ("雏菜", "水组组活", ("市川雛菜", "市川雏菜", "雛菜", "雏菜")),
    "024": ("日花", "嘘组组活", ("七草にちか", "七草日花", "にちか", "日花")),
    "025": ("美琴", "嘘组组活", ("緋田美琴", "绯田美琴", "美琴")),
    "026": ("路加", "黑星组活", ("斑鳩ルカ", "斑鸠路加", "ルカ", "路加")),
    "027": ("羽那", "黑星组活", ("鈴木羽那", "铃木羽那", "羽那")),
    "028": ("阳希", "黑星组活", ("郁田はるき", "郁田阳希", "はるき", "阳希")),
    "091": ("叶月", "283Pro剧情", ("七草はづき", "七草叶月", "はづき", "叶月")),
    "801": ("露比", "B小町联动", ("ルビー", "露比")),
    "802": ("加奈", "B小町联动", ("有馬かな", "有马加奈", "かな", "加奈")),
    "803": ("MEM啾", "B小町联动", ("MEMちょ", "MEM啾")),
    "804": ("茜音", "剧团Lalalai联动", ("黒川あかね", "黑川茜", "あかね", "茜音")),
}

LIBRARY_UNIT_LABEL_REPLACEMENTS = {
    "ALSTROEMERIA组活": "花组组活",
    "noctchill组活": "水组组活",
    "SHHis组活": "嘘组组活",
    "CoMETIK组活": "黑星组活",
}


VIDEO_EXPORT_JOBS: dict[str, dict[str, object]] = {}
VIDEO_EXPORT_LOCK = Lock()
SCENARIO_METADATA_LOCK = Lock()
LIBRARY_METADATA_LOCK = Lock()
MONITOR_STATE_LOCK = Lock()
MONITOR_ENRICHMENT_LOCK = Lock()
MONITOR_ENRICHMENT_RUNNING = False
STORY_PATH_INDEX: dict[str, str] | None = None
SCENARIO_GROUP_SUMMARY_CACHE: dict[str, dict[str, str]] = {}


def find_ffmpeg() -> Path | None:
    candidates = [
        os.environ.get("SSV_FFMPEG", ""),
        str(PROJECT_ROOT / "tools" / "ffmpeg.exe"),
        shutil.which("ffmpeg") or "",
        r"C:\Program Files\iFlyDown\resources\app.asar.unpacked\bin\ffmpeg.exe",
        r"C:\Program Files (x86)\Lenovo\LegionZone\2.0.16.4221\SESDK\plugins\SEGameHLController\Recorder\ffmpeg.exe",
    ]
    for value in candidates:
        if not value:
            continue
        path = Path(value).expanduser()
        if path.is_file():
            return path
    return None


OBS_EXPORT_MANAGER = ObsExportManager(
    project_root=PROJECT_ROOT,
    output_root=VIDEO_EXPORT_ROOT,
    base_url=BASE_URL,
    find_ffmpeg=find_ffmpeg,
)


def public_video_export_job(job: dict[str, object]) -> dict[str, object]:
    return {
        key: job.get(key)
        for key in (
            "jobId", "eventType", "eventId", "state", "stage", "progress",
            "uploadedBytes", "createdAt", "updatedAt", "durationMs", "outputUrl",
            "prerollMs", "outputPath", "error", "ffmpeg",
        )
        if job.get(key) not in (None, "")
    }


def get_video_export_job(job_id: object) -> dict[str, object]:
    key = validate_key(job_id, "video export job")
    with VIDEO_EXPORT_LOCK:
        job = VIDEO_EXPORT_JOBS.get(key)
        if not job:
            raise ValueError("Unknown video export job")
        return job


def create_video_export_job(payload: dict[str, object]) -> dict[str, object]:
    if not VIDEO_EXPORT_ENABLED:
        raise ValueError("视频直出功能已暂停研发；普通播放、纠错和 CSV 合成功能不受影响。")
    event_type = validate_key(payload.get("eventType"), "eventType")
    event_id = validate_key(payload.get("eventId"), "eventId")
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        raise ValueError(
            "找不到 FFmpeg。请把 ffmpeg.exe 放进播放器 tools 文件夹，"
            "或通过 SSV_FFMPEG 指定它的位置。"
        )

    job_id = secrets.token_hex(12)
    now = utc_now()
    VIDEO_EXPORT_WORK_ROOT.mkdir(parents=True, exist_ok=True)
    output_dir = VIDEO_EXPORT_ROOT / event_type
    output_dir.mkdir(parents=True, exist_ok=True)
    job: dict[str, object] = {
        "jobId": job_id,
        "eventType": event_type,
        "eventId": event_id,
        "state": "receiving",
        "stage": "等待播放器开始录制",
        "progress": 0,
        "uploadedBytes": 0,
        "nextChunk": 0,
        "createdAt": now,
        "updatedAt": now,
        "inputPath": str(VIDEO_EXPORT_WORK_ROOT / f"{job_id}.webm"),
        "outputPathRaw": str(output_dir / f"{event_id}.mp4"),
        "tempOutputPath": str(VIDEO_EXPORT_WORK_ROOT / f"{job_id}.mp4"),
        "ffmpeg": str(ffmpeg),
    }
    Path(str(job["inputPath"])).write_bytes(b"")
    with VIDEO_EXPORT_LOCK:
        VIDEO_EXPORT_JOBS[job_id] = job
    return public_video_export_job(job)


def append_video_export_chunk(job_id: object, index: int, content: bytes) -> dict[str, object]:
    if not content:
        raise ValueError("Video export chunk is empty")
    job = get_video_export_job(job_id)
    with VIDEO_EXPORT_LOCK:
        if job.get("state") != "receiving":
            raise ValueError("Video export job is no longer receiving data")
        expected = int(job.get("nextChunk") or 0)
        if index != expected:
            raise ValueError(f"Unexpected video export chunk {index}; expected {expected}")
        with Path(str(job["inputPath"])).open("ab") as stream:
            stream.write(content)
        job["nextChunk"] = expected + 1
        job["uploadedBytes"] = int(job.get("uploadedBytes") or 0) + len(content)
        job["stage"] = "正在接收实时渲染画面与声音"
        job["updatedAt"] = utc_now()
        return public_video_export_job(job)


def finish_video_export_job(payload: dict[str, object]) -> dict[str, object]:
    job = get_video_export_job(payload.get("jobId"))
    duration_ms = max(0, int(float(payload.get("durationMs") or 0)))
    preroll_ms = max(0, min(5000, int(float(payload.get("prerollMs") or 0))))
    if duration_ms > 0:
        preroll_ms = min(preroll_ms, max(0, duration_ms - 1))
    with VIDEO_EXPORT_LOCK:
        if job.get("state") != "receiving":
            raise ValueError("Video export job cannot be finalized in its current state")
        if int(job.get("uploadedBytes") or 0) <= 0:
            raise ValueError("Video export did not receive any media data")
        job["state"] = "transcoding"
        job["stage"] = "正在封装 1080p60 MP4"
        job["progress"] = 0
        job["durationMs"] = duration_ms
        job["prerollMs"] = preroll_ms
        job["mimeType"] = str(payload.get("mimeType") or "")[:200]
        job["updatedAt"] = utc_now()
        result = public_video_export_job(job)
    Thread(target=transcode_video_export_job, args=(str(job["jobId"]),), daemon=True).start()
    return result


def cancel_video_export_job(payload: dict[str, object]) -> dict[str, object]:
    job = get_video_export_job(payload.get("jobId"))
    with VIDEO_EXPORT_LOCK:
        if job.get("state") == "transcoding":
            raise ValueError("MP4 is already being encoded and cannot be cancelled from the player")
        job["state"] = "error"
        job["stage"] = "导出已停止"
        job["error"] = str(payload.get("error") or "播放器停止了视频导出")[:1000]
        job["updatedAt"] = utc_now()
        input_path = Path(str(job.get("inputPath") or ""))
        if input_path.is_file():
            input_path.unlink()
        return public_video_export_job(job)


def transcode_video_export_job(job_id: str) -> None:
    with VIDEO_EXPORT_LOCK:
        job = VIDEO_EXPORT_JOBS.get(job_id)
        if not job:
            return
        snapshot = dict(job)

    input_path = Path(str(snapshot["inputPath"]))
    temp_output = Path(str(snapshot["tempOutputPath"]))
    output_path = Path(str(snapshot["outputPathRaw"]))
    preroll_seconds = max(0.0, float(snapshot.get("prerollMs") or 0) / 1000)
    duration_seconds = max(
        0.001,
        (int(snapshot.get("durationMs") or 0) - int(snapshot.get("prerollMs") or 0)) / 1000,
    )
    video_filter = (
        f"trim=start={preroll_seconds:.6f},setpts=PTS-STARTPTS,"
        "scale=1920:1080:flags=lanczos,setsar=1,fps=60,format=yuv420p"
    )
    audio_filter = f"atrim=start={preroll_seconds:.6f},asetpts=PTS-STARTPTS"
    command = [
        str(snapshot["ffmpeg"]), "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(input_path),
        "-vf", video_filter,
        "-af", audio_filter,
        "-c:v", "libx264", "-preset", "fast", "-profile:v", "high", "-level:v", "4.2",
        "-b:v", "15M", "-maxrate", "18M", "-bufsize", "30M",
        "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709",
        "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart",
        "-progress", "pipe:1", "-nostats", str(temp_output),
    ]
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    recent_output: list[str] = []
    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=creation_flags,
        )
        assert process.stdout is not None
        for raw_line in process.stdout:
            line = raw_line.strip()
            if not line:
                continue
            recent_output.append(line)
            recent_output = recent_output[-20:]
            if line.startswith(("out_time_ms=", "out_time_us=")):
                try:
                    encoded_seconds = int(line.split("=", 1)[1]) / 1_000_000
                    progress = min(99, max(0, round(encoded_seconds / duration_seconds * 100)))
                except ValueError:
                    continue
                with VIDEO_EXPORT_LOCK:
                    current = VIDEO_EXPORT_JOBS.get(job_id)
                    if current:
                        current["progress"] = progress
                        current["updatedAt"] = utc_now()
        return_code = process.wait()
        if return_code != 0 or not temp_output.is_file() or temp_output.stat().st_size <= 0:
            detail = "\n".join(recent_output[-8:]) or f"FFmpeg exited with code {return_code}"
            raise RuntimeError(detail)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        os.replace(temp_output, output_path)
        cache_buster = int(time.time() * 1000)
        output_url = (
            f"./exports/video/{snapshot['eventType']}/{snapshot['eventId']}.mp4?v={cache_buster}"
        )
        with VIDEO_EXPORT_LOCK:
            current = VIDEO_EXPORT_JOBS.get(job_id)
            if current:
                current["state"] = "ready"
                current["stage"] = "视频已导出"
                current["progress"] = 100
                current["outputUrl"] = output_url
                current["outputPath"] = str(output_path)
                current["updatedAt"] = utc_now()
    except Exception as error:
        if temp_output.is_file():
            temp_output.unlink()
        with VIDEO_EXPORT_LOCK:
            current = VIDEO_EXPORT_JOBS.get(job_id)
            if current:
                current["state"] = "error"
                current["stage"] = "MP4 封装失败"
                current["error"] = str(error)[:2000]
                current["updatedAt"] = utc_now()
    finally:
        if input_path.is_file():
            input_path.unlink()


# LOCAL_MONITOR_BEGIN
def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def empty_monitor_state() -> dict[str, object]:
    return {
        "version": MONITOR_STATE_VERSION,
        "initialized": False,
        "initializedAt": "",
        "lastObservedAt": "",
        "assetVersion": "",
        "entries": {},
        "metadata": {},
        "cardResources": {},
        "resourceRequests": {},
        "listenerStatus": {},
        "lastEnrichmentAt": "",
        "enrichmentStatus": {},
    }


def migrate_monitor_state(data: dict[str, object]) -> dict[str, object]:
    try:
        previous_version = int(data.get("version") or 1)
    except (TypeError, ValueError):
        previous_version = 1
    if previous_version < 4:
        entries = data.get("entries") if isinstance(data.get("entries"), dict) else {}
        # v3 treated DataSite metadata/resource enrichment as a page-game
        # update.  This created a false "latest ten cards" log.  DataSite is
        # now enrichment-only, so remove those synthetic timestamps.
        for row in entries.values():
            if not isinstance(row, dict):
                continue
            if (
                str(row.get("updateKind") or "") == "implementation"
                and str(row.get("metadataSource") or "") == "shinycolors.moe"
            ):
                row["unread"] = False
                row["updateDetectedAt"] = ""
                row["updateKind"] = "baseline"
                row["implementationChanges"] = ""

        for detected_at, keys in MONITOR_V3_RECOVERY_UPDATES.items():
            for event_type, event_id in keys:
                row = entries.get(f"{event_type}/{event_id}")
                if not isinstance(row, dict):
                    continue
                row["updateDetectedAt"] = detected_at
                row["updateKind"] = "recovered"
                row["implementationChanges"] = ""
                row["unread"] = False
                if event_id == "301302801":
                    # The scenario JSON was preloaded, while the corresponding
                    # card resource/main data had not yet been implemented.
                    row["staticCardStatus"] = "missing"
                    row["dynamicCardStatus"] = "not-applicable"
                    row["implementationSource"] = "baseline-recovery"
                    row["updateKind"] = "preload"
        data["entries"] = entries
    if previous_version < 5:
        entries = data.get("entries") if isinstance(data.get("entries"), dict) else {}
        # v4 added the derived pageImplementationStatus field after many cards
        # had already received a complete official resource audit. Its first
        # appearance was incorrectly treated as a new implementation event,
        # which moved old baseline/recovered stories into today's update log.
        # Restore only this known synthetic transition; real new scenarios,
        # preloads and actual late implementations keep their original dates.
        for row in entries.values():
            if not isinstance(row, dict):
                continue
            if (
                str(row.get("updateKind") or "") == "implementation"
                and str(row.get("implementationChanges") or "") == "页游实装状态"
            ):
                row["unread"] = False
                row["updateDetectedAt"] = ""
                row["updateKind"] = "baseline"
                row["implementationChanges"] = ""

        # Recovered 2026-08-07 stories have an intentionally fixed discovery
        # date. Reapply it after removing the same synthetic status change so
        # clicking "补全全库名称" can never move that batch to another day.
        for detected_at, keys in MONITOR_V3_RECOVERY_UPDATES.items():
            for event_type, event_id in keys:
                row = entries.get(f"{event_type}/{event_id}")
                if not isinstance(row, dict):
                    continue
                row["updateDetectedAt"] = detected_at
                row["unread"] = False
                row["implementationChanges"] = ""
                if event_id == "301302801":
                    row["updateKind"] = "preload"
                else:
                    row["updateKind"] = "recovered"
        data["entries"] = entries
    if previous_version < 6:
        entries = data.get("entries") if isinstance(data.get("entries"), dict) else {}
        # Metadata and card-resource completion belong to the scenario's
        # original discovery batch.  Earlier versions replaced that date with
        # the completion time and consequently created a second update-log
        # day.  Remove those synthetic implementation-only entries.
        for row in entries.values():
            if not isinstance(row, dict):
                continue
            if str(row.get("updateKind") or "") == "implementation":
                row["unread"] = False
                row["updateDetectedAt"] = ""
                row["updateKind"] = "baseline"
                row["implementationChanges"] = ""

        # Restore the known 2026-08-07 discovery batch.  A formerly preloaded
        # card whose official resource is now present stays on 08/07 but is no
        # longer labelled as preloaded.
        for detected_at, keys in MONITOR_V3_RECOVERY_UPDATES.items():
            for event_type, event_id in keys:
                row = entries.get(f"{event_type}/{event_id}")
                if not isinstance(row, dict):
                    continue
                row["updateDetectedAt"] = detected_at
                row["unread"] = False
                row["implementationChanges"] = ""
                if (
                    event_id == "301302801"
                    and str(row.get("staticCardStatus") or "") != "available"
                ):
                    row["updateKind"] = "preload"
                else:
                    row["updateKind"] = "recovered"
        data["entries"] = entries
    data["version"] = MONITOR_STATE_VERSION
    return data


def read_monitor_state() -> dict[str, object]:
    if not MONITOR_STATE.exists():
        return empty_monitor_state()
    try:
        data = json.loads(MONITOR_STATE.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("entries"), dict):
            raise ValueError("invalid monitor state")
        if not isinstance(data.get("metadata"), dict):
            data["metadata"] = {}
        if not isinstance(data.get("cardResources"), dict):
            data["cardResources"] = {}
        if not isinstance(data.get("resourceRequests"), dict):
            data["resourceRequests"] = {}
        if not isinstance(data.get("listenerStatus"), dict):
            data["listenerStatus"] = {}
        if not isinstance(data.get("enrichmentStatus"), dict):
            data["enrichmentStatus"] = {}
        data["lastEnrichmentAt"] = str(data.get("lastEnrichmentAt") or "")
        return migrate_monitor_state(data)
    except Exception:
        return empty_monitor_state()


def known_scenario_types(event_id: object) -> list[str]:
    safe_id = validate_key(event_id, "eventId")
    result = {
        str(row.get("eventType") or "").strip()
        for row in (read_monitor_state().get("entries") or {}).values()
        if isinstance(row, dict) and str(row.get("eventId") or "").strip() == safe_id
    }
    return sorted(item for item in result if item)


def write_monitor_state(state: dict[str, object]) -> None:
    atomic_write_text(MONITOR_STATE, json.dumps(state, ensure_ascii=False, indent=2) + "\n")


def validate_monitor_row(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError("monitor entry must be an object")
    event_type = validate_key(value.get("eventType"), "eventType")
    event_id = validate_key(value.get("eventId"), "eventId")
    row = {"eventType": event_type, "eventId": event_id}
    for key in (
        "path", "characterId", "characterName", "characterNameJp", "cardType",
        "cardSequence", "storySequence", "cardId", "cardName", "cardRarity", "storyTitle",
        "metadataSource", "scenarioStatus", "metadataStatus", "cardNameStatus",
        "storyTitleStatus", "staticCardStatus", "dynamicCardStatus",
        "pageImplementationStatus", "activityImplementationStatus",
        "staticCardMirrorStatus", "dynamicCardMirrorStatus",
        "staticCardSyncStatus", "dynamicCardSyncStatus", "staticCardPath",
        "dynamicCardPath", "staticCardSaved", "dynamicCardSaved",
        "implementationSource", "updateKind", "implementationChanges",
        "implementationAuditAt",
    ):
        text = str(value.get(key) or "").strip()
        if len(text) > 500:
            raise ValueError(f"monitor field is too long: {key}")
        if text:
            row[key] = text
    row["key"] = f"{event_type}/{event_id}"
    return row


def validate_monitor_card_resource(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError("monitor card resource must be an object")
    card_type = str(value.get("cardType") or "").strip()
    if card_type not in {"Produce", "Support"}:
        raise ValueError("invalid monitor card resource type")
    card_id = validate_key(value.get("cardId"), "cardId")
    row = {"key": f"{card_type}/{card_id}", "cardType": card_type, "cardId": card_id}
    for key in (
        "staticCardStatus", "dynamicCardStatus", "staticCardPath",
        "dynamicCardPath", "staticCardSyncStatus", "dynamicCardSyncStatus",
        "staticCardSaved", "dynamicCardSaved", "implementationSource",
    ):
        text = str(value.get(key) or "").strip()
        if len(text) > 500:
            raise ValueError(f"monitor card resource field is too long: {key}")
        if text:
            row[key] = text
    return row


def monitor_card_library_fields(
    row: dict[str, object],
    cards: dict[str, object] | None = None,
) -> dict[str, object]:
    """Attach the locally known card identity to a lightweight scenario row."""
    event_id = str(row.get("eventId") or "")
    if str(row.get("eventType") or "") != "produce_events" or not re.fullmatch(r"[23]\d{8}", event_id):
        return row
    source = cards
    if source is None:
        cached = read_library_group_metadata().get("cards") or {}
        source = cached if isinstance(cached, dict) else {}
    card = source.get(event_id[:7]) if isinstance(source, dict) else None
    if not isinstance(card, dict):
        return row
    result = dict(row)
    for key in ("cardId", "cardName", "cardType", "characterId", "characterName"):
        value = str(card.get(key) or "").strip()
        if value and not str(result.get(key) or "").strip():
            result[key] = value
    return result


def monitor_resource_fields(
    state: dict[str, object],
    row: dict[str, object],
    official_inventory_complete: bool = False,
) -> dict[str, object]:
    card_type = str(row.get("cardType") or "")
    card_id = str(row.get("cardId") or "")
    if not card_type or not card_id:
        return row
    resource = (state.get("cardResources") or {}).get(f"{card_type}/{card_id}")
    if isinstance(resource, dict):
        status = str(resource.get("staticCardStatus") or "")
        page_status = "available" if status == "available" else "missing" if status == "missing" else "pending"
        return {**row, **resource, "pageImplementationStatus": page_status}
    if not official_inventory_complete:
        return row
    # A 0.6+ listener observation contains the complete official card-resource
    # inventory. A known card id absent from that inventory is a preloaded but
    # not-yet-implemented card, rather than an unknown DataSite state.
    return {
        **row,
        "staticCardStatus": "missing",
        "dynamicCardStatus": "missing" if card_type == "Produce" else "not-applicable",
        "pageImplementationStatus": "missing",
        "implementationSource": "official-game-asset-map",
    }


def monitor_public_state(state: dict[str, object], limit: int = MAX_MONITOR_ENTRIES) -> dict[str, object]:
    entries = list((state.get("entries") or {}).values())
    entries.sort(key=lambda row: (
        1 if row.get("unread") else 0,
        str(row.get("firstSeenAt") or ""),
        str(row.get("key") or ""),
    ), reverse=True)
    unread_count = sum(1 for row in entries if row.get("unread"))
    return {
        "initialized": bool(state.get("initialized")),
        "initializedAt": state.get("initializedAt") or "",
        "lastObservedAt": state.get("lastObservedAt") or "",
        "assetVersion": state.get("assetVersion") or "",
        "totalCount": len(entries),
        "unreadCount": unread_count,
        "items": entries[:limit],
        "listenerStatus": state.get("listenerStatus") or {},
        "lastEnrichmentAt": state.get("lastEnrichmentAt") or "",
        "enrichmentStatus": state.get("enrichmentStatus") or {},
    }


def update_game_monitor_status(payload: dict[str, object]) -> dict[str, object]:
    allowed_stages = {
        "script-started", "webpack-captured", "webpack-missed", "asset-map-found",
        "asset-map-missing", "empty-asset-map", "scan-error", "baseline-sent",
        "local-http-error",
    }
    stage = str(payload.get("stage") or "").strip()
    if stage not in allowed_stages:
        raise ValueError("unsupported listener status")
    status = {
        "stage": stage,
        "message": str(payload.get("message") or "").strip()[:500],
        "scriptVersion": str(payload.get("scriptVersion") or "").strip()[:50],
        "pageUrl": str(payload.get("pageUrl") or "").strip()[:1000],
        "reportedAt": utc_now(),
    }
    details = payload.get("details")
    if isinstance(details, dict):
        status["details"] = {str(key)[:100]: str(value)[:500] for key, value in details.items()}
    with MONITOR_STATE_LOCK:
        state = read_monitor_state()
        state["listenerStatus"] = status
        write_monitor_state(state)
    return monitor_public_state(state)


MONITOR_IMPLEMENTATION_FIELDS = {
    "cardName": "卡名",
    "storyTitle": "单话标题",
    "metadataStatus": "卡片主数据",
    "staticCardStatus": "页游静态卡图",
    "dynamicCardStatus": "页游动态卡图",
}


def monitor_implementation_changes(old: dict[str, object], new: dict[str, object]) -> list[str]:
    changes: list[str] = []
    for key, label in MONITOR_IMPLEMENTATION_FIELDS.items():
        before = str(old.get(key) or "").strip()
        after = str(new.get(key) or "").strip()
        if before == after or not after:
            continue
        if key in {"cardName", "storyTitle"} and before:
            changes.append(f"{label}更新")
        elif after in {"available", "synced"} or key in {"cardName", "storyTitle"}:
            changes.append(label)
    return changes


def merge_monitor_entry(
    old: dict[str, object] | None,
    row: dict[str, object],
    observed_at: str,
    was_initialized: bool,
    official_inventory_complete: bool = False,
) -> tuple[dict[str, object], bool]:
    if old is None:
        result = {
            **row,
            "firstSeenAt": observed_at,
            "lastSeenAt": observed_at,
            "unread": was_initialized,
            "updateDetectedAt": observed_at if was_initialized else "",
            "updateKind": "scenario" if was_initialized else "baseline",
            "implementationChanges": "剧情 JSON" if was_initialized else "",
        }
        return result, was_initialized
    combined = {**old, **row}
    is_card = (
        str(combined.get("eventType") or "") == "produce_events"
        and bool(re.fullmatch(r"[23]\d{8}", str(combined.get("eventId") or "")))
    )
    first_official_audit = (
        was_initialized
        and official_inventory_complete
        and is_card
        and not str(old.get("implementationAuditAt") or "")
        and not str(old.get("updateDetectedAt") or "")
        and str(combined.get("staticCardStatus") or "") in {"available", "missing"}
    )
    if first_official_audit:
        preloaded = str(combined.get("staticCardStatus") or "") == "missing"
        return {
            **combined,
            "firstSeenAt": old.get("firstSeenAt") or observed_at,
            "lastSeenAt": observed_at,
            "implementationAuditAt": observed_at,
            "unread": bool(old.get("unread")) or preloaded,
            "updateDetectedAt": observed_at if preloaded else old.get("updateDetectedAt") or "",
            "updateKind": "preload" if preloaded else old.get("updateKind") or "baseline",
            "implementationChanges": "页游未实装" if preloaded else old.get("implementationChanges") or "",
        }, preloaded
    # Enrichment and resource implementation update the existing row in place.
    # Only discovery of a new scenario JSON creates an update-log date.
    implemented_now = (
        str(old.get("updateKind") or "") == "preload"
        and str(combined.get("staticCardStatus") or "") == "available"
    )
    return {
        **combined,
        "firstSeenAt": old.get("firstSeenAt") or observed_at,
        "lastSeenAt": observed_at,
        "unread": bool(old.get("unread")),
        "updateDetectedAt": old.get("updateDetectedAt") or "",
        "updateKind": "recovered" if implemented_now else old.get("updateKind") or "",
        "implementationChanges": "" if implemented_now else old.get("implementationChanges") or "",
    }, False


def observe_game_updates(payload: dict[str, object]) -> dict[str, object]:
    raw_entries = payload.get("entries")
    raw_metadata = payload.get("metadata") or []
    raw_resources = payload.get("resources") or []
    if not isinstance(raw_entries, list) or not isinstance(raw_metadata, list) or not isinstance(raw_resources, list):
        raise ValueError("entries, metadata and resources must be arrays")
    if any(len(rows) > MAX_MONITOR_ENTRIES for rows in (raw_entries, raw_metadata, raw_resources)):
        raise ValueError("monitor observation is too large")

    observed_at = utc_now()
    with MONITOR_STATE_LOCK:
        state = read_monitor_state()
        was_initialized = bool(state.get("initialized"))
        official_inventory_complete = bool(raw_resources)
        library_metadata = read_library_group_metadata()
        library_cards = library_metadata.get("cards") if isinstance(library_metadata, dict) else {}
        if not isinstance(library_cards, dict):
            library_cards = {}
        entries = state.setdefault("entries", {})
        metadata = state.setdefault("metadata", {})
        card_resources = state.setdefault("cardResources", {})

        for value in raw_resources:
            resource = validate_monitor_card_resource(value)
            old = card_resources.get(resource["key"], {})
            card_resources[resource["key"]] = {**old, **resource, "updatedAt": observed_at}

        for value in raw_metadata:
            row = monitor_card_library_fields(validate_monitor_row(value), library_cards)
            old = metadata.get(row["key"], {})
            metadata[row["key"]] = {**old, **row, "updatedAt": observed_at}

        new_keys: list[str] = []
        changed_keys: list[str] = []
        for value in raw_entries:
            row = monitor_card_library_fields(validate_monitor_row(value), library_cards)
            key = row["key"]
            combined = monitor_resource_fields(
                state, {**row, **metadata.get(key, {})}, official_inventory_complete
            )
            merged, changed = merge_monitor_entry(
                entries.get(key), combined, observed_at, was_initialized, official_inventory_complete
            )
            entries[key] = merged
            if merged.get("updateKind") == "scenario" and merged.get("updateDetectedAt") == observed_at:
                new_keys.append(key)
            elif changed:
                changed_keys.append(key)

        for key, extra in metadata.items():
            if key not in entries:
                continue
            merged, changed = merge_monitor_entry(
                entries[key],
                monitor_resource_fields(state, monitor_card_library_fields(extra, library_cards), official_inventory_complete),
                observed_at,
                was_initialized,
                official_inventory_complete,
            )
            entries[key] = merged
            if changed and key not in changed_keys:
                changed_keys.append(key)

        if not was_initialized:
            state["initialized"] = True
            state["initializedAt"] = observed_at
        state["lastObservedAt"] = observed_at
        state["assetVersion"] = str(payload.get("assetVersion") or "")[:100]
        write_monitor_state(state)
    public = monitor_public_state(state)
    public.update({
        "baselineCreated": not was_initialized,
        "newCount": len(new_keys),
        "newKeys": new_keys,
        "implementationChangeCount": len(changed_keys),
        "implementationChangeKeys": changed_keys,
    })
    maybe_start_monitor_enrichment()
    return public


def acknowledge_game_updates() -> dict[str, object]:
    with MONITOR_STATE_LOCK:
        state = read_monitor_state()
        for row in (state.get("entries") or {}).values():
            row["unread"] = False
        write_monitor_state(state)
    return monitor_public_state(state)
# LOCAL_MONITOR_END


def ensure_speaker_archive() -> None:
    SPEAKER_ROOT.mkdir(parents=True, exist_ok=True)
    if SPEAKER_CSV.exists():
        return
    if LEGACY_SPEAKER_CSV.exists():
        shutil.copyfile(LEGACY_SPEAKER_CSV, SPEAKER_CSV)
        return
    with SPEAKER_CSV.open("w", encoding="utf-8", newline="") as stream:
        csv.writer(stream, lineterminator="\n").writerow(["name", "trans"])


def validate_key(value: object, label: str) -> str:
    text = str(value or "").strip()
    if not SAFE_KEY.fullmatch(text):
        raise ValueError(f"Invalid {label}: {text!r}")
    return text


def validated_asset_path(value: str) -> Path:
    normalized = str(value or "").replace("\\", "/").lstrip("/")
    pure = PurePosixPath(normalized)
    if not pure.parts or pure.parts[0] not in ALLOWED_ASSET_ROOTS:
        raise ValueError("Unsupported asset path")
    if any(part in {"", ".", ".."} for part in pure.parts):
        raise ValueError("Unsafe asset path")
    destination = (ASSET_ROOT / Path(*pure.parts)).resolve()
    destination.relative_to(ASSET_ROOT.resolve())
    return destination


def read_speaker_rows() -> list[dict[str, str]]:
    ensure_speaker_archive()
    with SPEAKER_CSV.open("r", encoding="utf-8-sig", newline="") as stream:
        rows = []
        for row in csv.DictReader(stream):
            name = str(row.get("name") or "").strip()
            trans = str(row.get("trans") or "").strip()
            if name:
                rows.append({"name": name, "trans": trans})
        return rows


def write_speaker_rows(updates: list[dict[str, object]]) -> list[dict[str, str]]:
    existing = read_speaker_rows()
    ordered_names = [row["name"] for row in existing]
    mapping = {row["name"]: row["trans"] for row in existing}
    for row in updates:
        name = str(row.get("name") or "").strip()
        trans = str(row.get("trans") or "").strip()
        if not name or not trans:
            continue
        if name not in mapping:
            ordered_names.append(name)
        mapping[name] = trans

    SPEAKER_ROOT.mkdir(parents=True, exist_ok=True)
    temporary = SPEAKER_CSV.with_suffix(".csv.tmp")
    with temporary.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(["name", "trans"])
        writer.writerows((name, mapping[name]) for name in ordered_names)
    os.replace(temporary, SPEAKER_CSV)
    return [{"name": name, "trans": mapping[name]} for name in ordered_names]


def atomic_write_text(destination: Path, content: str) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f"{destination.name}.tmp")
    temporary.write_text(content, encoding="utf-8", newline="")
    os.replace(temporary, destination)


def atomic_write_bytes(destination: Path, content: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f"{destination.name}.tmp")
    temporary.write_bytes(content)
    os.replace(temporary, destination)


def request_public_json(url: str, max_bytes: int = 24 * 1024 * 1024) -> object:
    request = Request(url, headers={
        "User-Agent": "Mozilla/5.0 ShinyScenarioWorkshop/1.0",
        "Accept": "application/json",
    })
    with urlopen(request, timeout=20) as response:
        content = response.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise ValueError("Public metadata response is too large")
    return json.loads(content.decode("utf-8-sig"))


def empty_library_group_metadata() -> dict[str, object]:
    return {
        "version": 1,
        "generatedAt": "",
        "cards": {},
        "activities": {},
        "errors": [],
    }


def read_library_group_metadata() -> dict[str, object]:
    if not LIBRARY_GROUP_METADATA_CACHE.exists():
        return empty_library_group_metadata()
    try:
        value = json.loads(LIBRARY_GROUP_METADATA_CACHE.read_text(encoding="utf-8-sig"))
        if not isinstance(value, dict):
            raise ValueError("invalid library metadata")
        raw_cards = value.get("cards") if isinstance(value.get("cards"), dict) else {}
        # Older builds guessed the scenario group from a card's position in
        # idolInfo.cardLists.  P-Cup and other cards without scenario commus
        # shift that position, so those labels are not trustworthy.
        value["cards"] = {
            key: metadata for key, metadata in raw_cards.items()
            if isinstance(metadata, dict)
            and str(metadata.get("source") or "") != "shinycolors.moe/idolInfo"
        }
        value["activities"] = value.get("activities") if isinstance(value.get("activities"), dict) else {}
        value["errors"] = value.get("errors") if isinstance(value.get("errors"), list) else []
        value["version"] = 1
        for metadata in value["activities"].values():
            if not isinstance(metadata, dict):
                continue
            for key in ("label", "unitLabel"):
                text = str(metadata.get(key) or "")
                for source, target in LIBRARY_UNIT_LABEL_REPLACEMENTS.items():
                    text = text.replace(source, target)
                metadata[key] = text
        for metadata in value["cards"].values():
            if not isinstance(metadata, dict):
                continue
            character_id = str(metadata.get("characterId") or "")
            character_name = CHARACTER_ARCHIVE_INFO.get(
                character_id, (str(metadata.get("characterName") or ""), "", ())
            )[0]
            if character_name:
                metadata["characterName"] = character_name
                type_label = "P卡" if metadata.get("cardType") == "Produce" else "S卡"
                title = card_display_title(metadata.get("cardName"))
                if title:
                    metadata["label"] = f"{character_name}{type_label}・{title}"
        return value
    except (OSError, json.JSONDecodeError, ValueError):
        return empty_library_group_metadata()


def write_library_group_metadata(value: dict[str, object]) -> None:
    atomic_write_text(
        LIBRARY_GROUP_METADATA_CACHE,
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
    )


def cached_card_names_by_id() -> dict[str, str]:
    """Reuse card identities from the old cache without trusting its group key."""
    result: dict[str, str] = {}
    for path in (CARD_IDENTITY_CACHE, LIBRARY_GROUP_METADATA_CACHE):
        if not path.exists():
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            continue
        cards = value.get("cards") if isinstance(value, dict) else None
        if not isinstance(cards, dict):
            continue
        for key, metadata in cards.items():
            if not isinstance(metadata, dict):
                continue
            card_id = str(metadata.get("cardId") or key or "").strip()
            raw_name = str(metadata.get("rawCardName") or metadata.get("cardName") or "").strip()
            if card_id and raw_name:
                result[card_id] = raw_name
    return result


def card_display_title(value: object) -> str:
    text = str(value or "").strip()
    bracket = re.search(r"【[^】]+】", text)
    return bracket.group(0) if bracket else text


def monitor_library_groups() -> tuple[set[str], dict[str, list[str]]]:
    card_groups: set[str] = set()
    activity_groups: dict[str, list[str]] = {}
    for row in (read_monitor_state().get("entries") or {}).values():
        if not isinstance(row, dict):
            continue
        event_type = str(row.get("eventType") or "")
        event_id = str(row.get("eventId") or "")
        if event_type == "produce_events" and re.fullmatch(r"[23]\d{8}", event_id):
            card_groups.add(event_id[:7])
            continue
        match = re.fullmatch(r"4001(\d{3})(\d{2})", event_id)
        if event_type == "game_event_communications" and match:
            activity_groups.setdefault(match.group(1), []).append(event_id)
    for event_ids in activity_groups.values():
        event_ids.sort(key=lambda value: int(value[-2:]))
    return card_groups, activity_groups


def card_metadata_from_idol_info(
    character_id: str,
    idol_info: object,
    wanted_groups: set[str] | None = None,
    detail_loader: object | None = None,
    known_names_by_card_id: dict[str, str] | None = None,
) -> dict[str, dict[str, str]]:
    cards = idol_info.get("cardLists") if isinstance(idol_info, dict) else None
    if not isinstance(cards, list) or not callable(detail_loader):
        return {}
    result: dict[str, dict[str, str]] = {}
    short_name = CHARACTER_ARCHIVE_INFO.get(character_id, (f"角色{character_id}", "", ()))[0]
    wanted_first_digits = {group[0] for group in wanted_groups or ()}
    for card in cards:
        if not isinstance(card, dict):
            continue
        raw_type = str(card.get("cardType") or "")
        produce = raw_type.startswith("P_")
        support = raw_type.startswith("S_")
        if not produce and not support:
            continue
        first_digit = "2" if produce else "3"
        if wanted_first_digits and first_digit not in wanted_first_digits:
            continue
        card_uuid = str(card.get("cardUuid") or "").strip()
        if not card_uuid:
            continue
        endpoint = "pCardInfo" if produce else "sCardInfo"
        event_field = "cardIdolEvents" if produce else "cardSupportEvents"
        try:
            detail = detail_loader(endpoint, card_uuid)
        except Exception:
            continue
        if not isinstance(detail, dict):
            continue
        raw_events = detail.get(event_field)
        if not isinstance(raw_events, list):
            continue
        card_id = str(detail.get("enzaId") or card.get("enzaId") or "").strip()
        raw_name = str(
            (known_names_by_card_id or {}).get(card_id)
            or detail.get("cardName") or card.get("cardName") or ""
        ).strip()
        title = card_display_title(raw_name)
        if not title:
            continue
        for event in raw_events:
            if not isinstance(event, dict):
                continue
            event_id = str(event.get("eventId") or "").strip()
            if not re.fullmatch(r"[23]\d{8}", event_id) or event_id[1:4] != character_id:
                continue
            group_prefix = event_id[:7]
            if wanted_groups is not None and group_prefix not in wanted_groups:
                continue
            result[group_prefix] = {
                "cardName": title,
                "rawCardName": raw_name,
                "characterId": character_id,
                "characterName": short_name,
                "cardType": "Produce" if produce else "Support",
                "cardId": card_id,
                "cardRarity": raw_type,
                "label": f"{short_name}{'P卡' if produce else 'S卡'}・{title}",
                "source": "shinycolors.moe/card-event-id",
            }
    return result


def build_card_library_metadata(card_groups: set[str]) -> tuple[dict[str, dict[str, str]], list[str]]:
    character_ids = sorted({group[1:4] for group in card_groups})
    result: dict[str, dict[str, str]] = {}
    errors: list[str] = []
    known_names = cached_card_names_by_id()

    def fetch_character(character_id: str) -> tuple[str, object]:
        value = request_public_json(
            f"{DATASITE_API_ROOT}/info/idolInfo?idolId={int(character_id)}"
        )
        return character_id, value

    idol_infos: dict[str, object] = {}
    with ThreadPoolExecutor(max_workers=6, thread_name_prefix="card-library") as executor:
        futures = {executor.submit(fetch_character, value): value for value in character_ids}
        for future in as_completed(futures):
            character_id = futures[future]
            try:
                _, idol_info = future.result()
                idol_infos[character_id] = idol_info
            except Exception as error:
                errors.append(f"角色 {character_id} 卡片资料获取失败：{error}")

    def fetch_card_detail(character_id: str, card: dict[str, object]) -> dict[str, dict[str, str]]:
        produce = str(card.get("cardType") or "").startswith("P_")
        endpoint = "pCardInfo" if produce else "sCardInfo"
        card_uuid = str(card.get("cardUuid") or "").strip()
        detail = request_public_json(
            f"{DATASITE_API_ROOT}/info/{endpoint}?cardId={quote(card_uuid, safe='')}"
        )
        return card_metadata_from_idol_info(
            character_id, {"cardLists": [card]}, card_groups,
            lambda _endpoint, _uuid: detail, known_names,
        )

    card_tasks: list[tuple[str, dict[str, object]]] = []
    for character_id, idol_info in idol_infos.items():
        cards = idol_info.get("cardLists") if isinstance(idol_info, dict) else None
        if not isinstance(cards, list):
            continue
        wanted_digits = {group[0] for group in card_groups if group[1:4] == character_id}
        for card in cards:
            if not isinstance(card, dict) or not str(card.get("cardUuid") or "").strip():
                continue
            raw_type = str(card.get("cardType") or "")
            if (raw_type.startswith("P_") and "2" in wanted_digits) or (
                raw_type.startswith("S_") and "3" in wanted_digits
            ):
                card_tasks.append((character_id, card))

    with ThreadPoolExecutor(max_workers=12, thread_name_prefix="card-detail") as executor:
        futures = {
            executor.submit(fetch_card_detail, character_id, card): (character_id, card)
            for character_id, card in card_tasks
        }
        detail_error_count = 0
        for future in as_completed(futures):
            try:
                result.update(future.result())
            except Exception:
                detail_error_count += 1
        if detail_error_count:
            errors.append(f"{detail_error_count} 张卡的详情接口暂时不可用")
    missing = sorted(card_groups - set(result))
    if missing:
        errors.append(f"仍有 {len(missing)} 张卡尚无资料站卡名：{', '.join(missing[:20])}")
    return result, errors


def build_activity_library_metadata(
    activity_groups: dict[str, list[str]],
) -> tuple[dict[str, dict[str, str]], list[str]]:
    result: dict[str, dict[str, str]] = {}
    errors: list[str] = []

    def scan_group(sequence: str, event_ids: list[str]) -> tuple[str, str]:
        tracks = [
            track
            for event_id in event_ids
            for track in fetch_scenario_tracks("game_event_communications", event_id)
        ]
        return sequence, activity_unit_label(tracks)

    with ThreadPoolExecutor(max_workers=8, thread_name_prefix="activity-library") as executor:
        futures = {
            executor.submit(scan_group, sequence, event_ids): sequence
            for sequence, event_ids in activity_groups.items()
        }
        for future in as_completed(futures):
            sequence = futures[future]
            try:
                _, unit_label = future.result()
                number = str(int(sequence))
                label = f"第{number}次组活{f'-{unit_label}' if unit_label else ''}"
                result[sequence] = {
                    "label": label,
                    "unitLabel": unit_label,
                    "source": "scenario-speaker-scan",
                }
            except Exception as error:
                errors.append(f"第 {int(sequence)} 次活动扫描失败：{error}")
    return result, errors


def rebuild_scenario_library_metadata() -> dict[str, object]:
    card_groups, activity_groups = monitor_library_groups()
    previous = read_library_group_metadata()
    previous_cards = previous.get("cards") if isinstance(previous.get("cards"), dict) else {}
    previous_activities = previous.get("activities") if isinstance(previous.get("activities"), dict) else {}
    missing_card_groups = card_groups - set(previous_cards)
    missing_activity_groups = {
        key: value for key, value in activity_groups.items()
        if key not in previous_activities
    }
    cards, card_errors = build_card_library_metadata(missing_card_groups)
    activities, activity_errors = build_activity_library_metadata(missing_activity_groups)
    # A temporary network failure must not erase names found by an earlier scan.
    merged_cards = dict(previous_cards)
    merged_cards.update(cards)
    merged_activities = dict(previous_activities)
    merged_activities.update(activities)
    title_errors: list[str] = []
    try:
        refresh_scenario_title_metadata()
    except Exception as error:
        title_errors.append(f"逐话标题获取失败：{error}")
    # Card names and individual commu titles do not always arrive together.
    # A card group that is already named must therefore still be queried when
    # one of its known stories has no title.  Query one representative story;
    # the DataSite detail response contains every commu belonging to the card.
    title_cache = read_scenario_metadata_cache()
    monitor_entries = read_monitor_state().get("entries", {})
    if not isinstance(monitor_entries, dict):
        monitor_entries = {}
    card_groups_by_recency = sorted(
        card_groups,
        key=lambda group_prefix: max(
            (
                str(metadata.get("firstDetectedAt") or metadata.get("updateDetectedAt") or "")
                for event_id, metadata in monitor_entries.items()
                if event_id.startswith(group_prefix) and isinstance(metadata, dict)
            ),
            default="",
        ),
        reverse=True,
    )
    missing_title_representatives = [
        next(
            (
                event_id for event_id in sorted(
                    event_id for event_id in monitor_entries
                    if event_id.startswith(group_prefix)
                )
                if not str(
                    (title_cache.get(f"produce_events/{event_id}") or {}).get("storyTitle") or ""
                ).strip()
            ),
            "",
        )
        for group_prefix in card_groups_by_recency
    ]
    missing_title_representatives = [
        event_id for event_id in missing_title_representatives if event_id
    ][:12]
    if missing_title_representatives:
        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="card-story-title") as executor:
            futures = {
                executor.submit(fetch_card_detail_metadata, event_id): event_id
                for event_id in missing_title_representatives
            }
            for future in as_completed(futures):
                event_id = futures[future]
                try:
                    future.result()
                except Exception as error:
                    title_errors.append(f"卡剧情 {event_id} 标题获取失败：{error}")
    value = {
        "version": 1,
        "generatedAt": utc_now(),
        "cards": merged_cards,
        "activities": merged_activities,
        "errors": card_errors + activity_errors + title_errors,
        "stats": {
            "knownCardGroups": len(card_groups),
            "namedCardGroups": len(set(card_groups) & set(merged_cards)),
            "knownActivityGroups": len(activity_groups),
            "namedActivityGroups": len(set(activity_groups) & set(merged_activities)),
        },
    }
    with LIBRARY_METADATA_LOCK:
        write_library_group_metadata(value)
    return value


def persist_card_library_metadata(
    event_id: str,
    raw_card_name: object,
    card_id: object = "",
    source: str = "scenario-event-metadata",
) -> None:
    if not re.fullmatch(r"[23]\d{8}", event_id):
        return
    title = card_display_title(raw_card_name)
    if not title:
        return
    group_prefix = event_id[:7]
    character_id = event_id[1:4]
    short_name = CHARACTER_ARCHIVE_INFO.get(character_id, (f"角色{character_id}", "", ()))[0]
    type_label = "P卡" if event_id.startswith("2") else "S卡"
    with LIBRARY_METADATA_LOCK:
        value = read_library_group_metadata()
        cards = value.setdefault("cards", {})
        if not isinstance(cards, dict):
            cards = value["cards"] = {}
        cards[group_prefix] = {
            "cardName": title,
            "rawCardName": str(raw_card_name or "").strip(),
            "characterId": character_id,
            "characterName": short_name,
            "cardType": "Produce" if event_id.startswith("2") else "Support",
            "cardId": str(card_id or "").strip(),
            "label": f"{short_name}{type_label}・{title}",
            "source": source,
        }
        value["generatedAt"] = utc_now()
        write_library_group_metadata(value)
        safe_card_id = str(card_id or "").strip()
        if safe_card_id:
            identities: dict[str, object] = {"version": 1, "cards": {}}
            if CARD_IDENTITY_CACHE.exists():
                try:
                    loaded = json.loads(CARD_IDENTITY_CACHE.read_text(encoding="utf-8-sig"))
                    if isinstance(loaded, dict):
                        identities = loaded
                except (OSError, json.JSONDecodeError):
                    pass
            identity_cards = identities.get("cards")
            if not isinstance(identity_cards, dict):
                identity_cards = identities["cards"] = {}
            identity_cards[safe_card_id] = {
                "cardId": safe_card_id,
                "rawCardName": str(raw_card_name or "").strip(),
            }
            atomic_write_text(
                CARD_IDENTITY_CACHE,
                json.dumps(identities, ensure_ascii=False, indent=2) + "\n",
            )


def persist_activity_library_metadata(event_id: str, label: str) -> None:
    match = re.fullmatch(r"4001(\d{3})\d{2}", event_id)
    if not match or not label:
        return
    sequence = match.group(1)
    unit_label = label.split("-", 1)[1] if "-" in label else ""
    with LIBRARY_METADATA_LOCK:
        value = read_library_group_metadata()
        activities = value.setdefault("activities", {})
        if not isinstance(activities, dict):
            activities = value["activities"] = {}
        activities[sequence] = {
            "label": label,
            "unitLabel": unit_label,
            "source": "scenario-speaker-scan",
        }
        value["generatedAt"] = utc_now()
        write_library_group_metadata(value)


def read_scenario_metadata_cache() -> dict[str, dict[str, str]]:
    if not SCENARIO_METADATA_CACHE.exists():
        return {}
    try:
        value = json.loads(SCENARIO_METADATA_CACHE.read_text(encoding="utf-8-sig"))
        entries = value.get("entries") if isinstance(value, dict) else None
        return entries if isinstance(entries, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def public_scenario_library_labels(value: dict[str, object] | None = None) -> dict[str, object]:
    """Attach locally known per-story titles to the lightweight library labels."""
    source = value if isinstance(value, dict) else read_library_group_metadata()
    result = dict(source)
    stories: dict[str, dict[str, str]] = {}
    for key, metadata in read_scenario_metadata_cache().items():
        if not isinstance(metadata, dict):
            continue
        title = str(metadata.get("storyTitle") or "").strip()
        if not title:
            continue
        stories[str(key)] = {
            "storyTitle": title,
            "source": str(metadata.get("source") or "local-title-cache").strip(),
        }

    # Very new resources may already have an official title in the listener
    # state before the persistent title cache has been updated.
    for key, metadata in (read_monitor_state().get("entries") or {}).items():
        if not isinstance(metadata, dict) or key in stories:
            continue
        title = str(metadata.get("storyTitle") or "").strip()
        if title:
            stories[str(key)] = {"storyTitle": title, "source": "official-game-api"}

    result["stories"] = stories
    stats = dict(result.get("stats") or {})
    stats["namedStories"] = len(stories)
    result["stats"] = stats
    return result


def store_scenario_metadata(rows: list[dict[str, object]]) -> None:
    cleaned: list[dict[str, str]] = []
    for value in rows:
        if not isinstance(value, dict):
            continue
        event_type = str(value.get("eventType") or "").strip()
        event_id = str(value.get("eventId") or "").strip()
        if not SAFE_KEY.fullmatch(event_type) or not SAFE_KEY.fullmatch(event_id):
            continue
        row = {"eventType": event_type, "eventId": event_id}
        for key in ("storyTitle", "cardName", "cardId", "source"):
            text = str(value.get(key) or "").strip()
            if text:
                row[key] = text[:500]
        if row.get("storyTitle"):
            cleaned.append(row)
    if not cleaned:
        return
    with SCENARIO_METADATA_LOCK:
        entries = read_scenario_metadata_cache()
        for row in cleaned:
            entries[f"{row['eventType']}/{row['eventId']}"] = row
        atomic_write_text(
            SCENARIO_METADATA_CACHE,
            json.dumps({"version": 1, "entries": entries}, ensure_ascii=False, indent=2) + "\n",
        )


def refresh_scenario_title_metadata() -> int:
    """Merge SC-VIEWER's public catalogue titles into the local title cache."""
    payload = request_public_json(SC_VIEWER_NAME_URL, max_bytes=16 * 1024 * 1024)
    stack: list[object] = [payload]
    rows: list[dict[str, str]] = []
    seen: set[str] = set()
    while stack:
        value = stack.pop()
        if isinstance(value, list):
            stack.extend(value)
            continue
        if not isinstance(value, dict):
            continue
        path = str(value.get("jsonPath") or "").strip().lstrip("/")
        title = str(value.get("title") or "").strip()
        match = re.fullmatch(r"([^/]+)/([^/]+)\.json", path)
        if match and title:
            event_type, event_id = match.groups()
            key = f"{event_type}/{event_id}"
            if key not in seen and SAFE_KEY.fullmatch(event_type) and SAFE_KEY.fullmatch(event_id):
                seen.add(key)
                rows.append({
                    "eventType": event_type,
                    "eventId": event_id,
                    "storyTitle": title,
                    "source": "sc-viewer.top/name",
                })
        stack.extend(value.values())
    store_scenario_metadata(rows)
    return len(rows)


def monitor_scenario_metadata(event_type: str, event_id: str) -> dict[str, str] | None:
    # Keep this lookup independent from the optional listener code so portable
    # builds can omit the monitor section without breaking CSV naming.
    monitor_state = PROJECT_ROOT / "monitor" / "game-update-state.json"
    if not monitor_state.exists():
        return None
    try:
        state = json.loads(monitor_state.read_text(encoding="utf-8-sig"))
        row = (state.get("entries") or {}).get(f"{event_type}/{event_id}")
        if isinstance(row, dict) and str(row.get("storyTitle") or "").strip():
            return {
                "eventType": event_type,
                "eventId": event_id,
                "storyTitle": str(row.get("storyTitle") or "").strip(),
                "cardName": str(row.get("cardName") or "").strip(),
                "cardId": str(row.get("cardId") or "").strip(),
                "source": "official-game-api",
            }
    except (OSError, json.JSONDecodeError):
        pass
    return None


def fetch_card_detail_metadata(event_id: str) -> list[dict[str, str]]:
    match = re.fullmatch(r"([23])(\d{3})(\d{3})(\d{2})", event_id)
    if not match:
        return []
    card_kind, character_id, card_sequence, _ = match.groups()
    produce = card_kind == "2"
    idol_info = request_public_json(
        f"{DATASITE_API_ROOT}/info/idolInfo?idolId={int(character_id)}"
    )
    cards = idol_info.get("cardLists") if isinstance(idol_info, dict) else None
    if not isinstance(cards, list):
        return []
    prefix = "P_" if produce else "S_"
    excluded = {"P_R"} if produce else {"S_N", "S_R"}
    candidates = [
        card for card in cards
        if isinstance(card, dict)
        and str(card.get("cardType") or "").startswith(prefix)
        and str(card.get("cardType") or "") not in excluded
        and str(card.get("cardUuid") or "")
    ]
    candidates.sort(key=lambda card: (
        str(card.get("releaseDate") or ""), int(card.get("cardIndex") or 0)
    ))
    wanted_index = max(0, int(card_sequence) - 1)
    candidate_positions = {id(card): index for index, card in enumerate(candidates)}
    candidates.sort(key=lambda card: (
        abs(candidate_positions.get(id(card), 9999) - wanted_index),
        -int(card.get("cardIndex") or 0),
    ))

    endpoint = "pCardInfo" if produce else "sCardInfo"
    event_field = "cardIdolEvents" if produce else "cardSupportEvents"

    def fetch_one(card: dict[str, object]) -> tuple[dict[str, object], object]:
        uuid = quote(str(card.get("cardUuid") or ""), safe="")
        detail = request_public_json(f"{DATASITE_API_ROOT}/info/{endpoint}?cardId={uuid}")
        return card, detail

    found: list[dict[str, str]] = []
    executor = ThreadPoolExecutor(max_workers=6, thread_name_prefix="scenario-metadata")
    futures = [executor.submit(fetch_one, card) for card in candidates]
    try:
        for future in as_completed(futures):
            try:
                card, detail = future.result()
            except Exception:
                continue
            if not isinstance(detail, dict):
                continue
            events = detail.get(event_field)
            if not isinstance(events, list):
                continue
            card_name = str(detail.get("cardName") or card.get("cardName") or "").strip()
            card_id = str(detail.get("enzaId") or card.get("enzaId") or "").strip()
            rows = []
            for item in events:
                if not isinstance(item, dict):
                    continue
                item_id = str(item.get("eventId") or "").strip()
                # DataSite currently exposes card commu titles as eventName.
                # Older cached payloads and a few API variants used eventTitle,
                # so accept both without weakening the exact event-id match.
                title = str(item.get("eventTitle") or item.get("eventName") or "").strip()
                if not item_id or not title:
                    continue
                rows.append({
                    "eventType": "produce_events",
                    "eventId": item_id,
                    "storyTitle": title,
                    "cardName": card_name,
                    "cardId": card_id,
                    "source": "shinycolors.moe",
                })
            if rows:
                store_scenario_metadata(rows)
            if any(row["eventId"] == event_id for row in rows):
                found = rows
                break
    finally:
        for future in futures:
            future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
    return found


def datasite_recent_card_rows(card: dict[str, object]) -> list[dict[str, str]]:
    card_type = str(card.get("cardType") or "")
    produce = card_type.startswith("P_")
    if not produce and not card_type.startswith("S_"):
        return []
    card_uuid = str(card.get("cardUuid") or "").strip()
    card_id = str(card.get("enzaId") or "").strip()
    if not card_uuid or not card_id:
        return []
    endpoint = "pCardInfo" if produce else "sCardInfo"
    event_field = "cardIdolEvents" if produce else "cardSupportEvents"
    detail = request_public_json(
        f"{DATASITE_API_ROOT}/info/{endpoint}?cardId={quote(card_uuid, safe='')}"
    )
    if not isinstance(detail, dict):
        return []
    raw_events = detail.get(event_field)
    if not isinstance(raw_events, list):
        return []
    raw_card_name = str(detail.get("cardName") or card.get("cardName") or "").strip()
    character_id = str(card.get("idolId") or "").zfill(3)
    character_name = CHARACTER_ARCHIVE_INFO.get(character_id, (f"角色{character_id}", "", ()))[0]
    rows: list[dict[str, str]] = []
    for item in raw_events:
        if not isinstance(item, dict):
            continue
        event_id = str(item.get("eventId") or "").strip()
        story_title = str(item.get("eventTitle") or item.get("eventName") or "").strip()
        if not re.fullmatch(r"[23]\d{8}", event_id):
            continue
        row = {
            "eventType": "produce_events",
            "eventId": event_id,
            "characterId": character_id,
            "characterName": character_name,
            "cardType": "Produce" if produce else "Support",
            "cardId": card_id,
            "cardName": raw_card_name,
            "cardRarity": card_type,
            "metadataStatus": "available" if raw_card_name and story_title else "partial",
            "cardNameStatus": "available" if raw_card_name else "pending",
            "storyTitleStatus": "available" if story_title else "pending",
            "metadataSource": "shinycolors.moe",
            "implementationSource": "shinycolors.moe",
        }
        if story_title:
            row["storyTitle"] = story_title
        rows.append(row)
    return rows


def local_card_resource_path(kind: str, card_id: str) -> str:
    return {
        "produce-still": f"images/content/idols/card/{card_id}.jpg",
        "support-still": f"images/content/support_idols/card/{card_id}.jpg",
        "produce-movie": f"movies/idols/card/{card_id}.mp4",
        "produce-costume-movie": f"movies/idols/card_costume/{card_id}.mp4",
    }[kind]


def sync_datasite_card_resources(card_type: str, card_id: str) -> dict[str, str]:
    produce = card_type == "Produce"
    static_kind = "produce-still" if produce else "support-still"
    result = {
        "staticCardPath": local_card_resource_path(static_kind, card_id),
        "dynamicCardPath": local_card_resource_path("produce-movie", card_id) if produce else "",
        "staticCardMirrorStatus": "missing",
        "dynamicCardMirrorStatus": "pending" if produce else "not-applicable",
        "staticCardSyncStatus": "failed",
        "dynamicCardSyncStatus": "pending" if produce else "not-applicable",
    }

    def sync_one(kind: str, mirror_key: str, sync_key: str, saved_key: str) -> None:
        destination = validated_asset_path(local_card_resource_path(kind, card_id))
        if destination.is_file() and destination.stat().st_size >= 512:
            result[mirror_key] = "available"
            result[sync_key] = "synced"
            result[saved_key] = str(destination.relative_to(PROJECT_ROOT)).replace("\\", "/")
            return
        try:
            saved = fetch_community_card_resource(kind, card_id)
            result[mirror_key] = "available"
            result[sync_key] = "synced"
            result[saved_key] = str(saved.get("saved") or "")
        except Exception:
            result[mirror_key] = "missing"
            result[sync_key] = "failed"

    sync_one(static_kind, "staticCardMirrorStatus", "staticCardSyncStatus", "staticCardSaved")
    if produce:
        sync_one("produce-movie", "dynamicCardMirrorStatus", "dynamicCardSyncStatus", "dynamicCardSaved")
    return result


def apply_monitor_datasite_enrichment(rows: list[dict[str, str]], status: dict[str, object]) -> None:
    observed_at = utc_now()
    with MONITOR_STATE_LOCK:
        state = read_monitor_state()
        entries = state.setdefault("entries", {})
        metadata = state.setdefault("metadata", {})
        for value in rows:
            row = validate_monitor_row(value)
            key = row["key"]
            old_metadata = metadata.get(key, {})
            if old_metadata.get("metadataSource") == "official-game-api":
                row["metadataSource"] = "official-game-api"
            metadata[key] = monitor_resource_fields(
                state, {**old_metadata, **row, "updatedAt": observed_at}
            )
            if key not in entries:
                continue
            # DataSite only enriches identities, titles and mirror resources.
            # It must never decide that a scenario is a new page-game update.
            # Preserve the official scenario/preload timestamp and unread state
            # while allowing exact event metadata to fill the existing row.
            tracking = {
                name: entries[key].get(name)
                for name in (
                    "firstSeenAt", "lastSeenAt", "unread", "updateDetectedAt",
                    "updateKind", "implementationChanges", "implementationAuditAt",
                )
                if name in entries[key]
            }
            entries[key] = {**entries[key], **metadata[key], **tracking}
        state["lastEnrichmentAt"] = observed_at
        state["enrichmentStatus"] = status
        write_monitor_state(state)


def monitor_datasite_enrichment_worker() -> None:
    global MONITOR_ENRICHMENT_RUNNING
    try:
        recent = request_public_json(f"{DATASITE_API_ROOT}/info/recentUpdate")
        cards = [card for card in recent if isinstance(card, dict)] if isinstance(recent, list) else []
        rows: list[dict[str, str]] = []
        errors: list[str] = []

        def fetch_one(card: dict[str, object]) -> list[dict[str, str]]:
            # The periodic monitor is metadata-only. Card images and movies can
            # be hundreds of megabytes and are requested separately when a
            # scenario that actually uses them is opened in the workshop.
            return datasite_recent_card_rows(card)

        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="monitor-datasite") as executor:
            futures = [executor.submit(fetch_one, card) for card in cards]
            for future in as_completed(futures):
                try:
                    rows.extend(future.result())
                except Exception as error:
                    errors.append(str(error)[:300])
        if rows:
            store_scenario_metadata([{**row, "source": "shinycolors.moe"} for row in rows])
            for row in rows:
                persist_card_library_metadata(
                    row.get("eventId", ""), row.get("cardName", ""),
                    row.get("cardId", ""), "shinycolors.moe/card-event-id",
                )
        apply_monitor_datasite_enrichment(rows, {
            "state": "complete",
            "checkedCards": len(cards),
            "updatedStories": len(rows),
            "errors": errors[:10],
            "reportedAt": utc_now(),
        })
    except Exception as error:
        apply_monitor_datasite_enrichment([], {
            "state": "error",
            "message": str(error)[:500],
            "reportedAt": utc_now(),
        })
    finally:
        with MONITOR_ENRICHMENT_LOCK:
            MONITOR_ENRICHMENT_RUNNING = False


def maybe_start_monitor_enrichment(force: bool = False) -> bool:
    global MONITOR_ENRICHMENT_RUNNING
    # Unit tests replace the state path with a temporary file; never start a
    # real network poll against that isolated state.
    if MONITOR_STATE.parent.resolve() != MONITOR_ROOT.resolve():
        return False
    state = read_monitor_state()
    last_text = str(state.get("lastEnrichmentAt") or "")
    try:
        last_time = datetime.fromisoformat(last_text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        last_time = 0
    if not force and time.time() - last_time < 10 * 60:
        return False
    with MONITOR_ENRICHMENT_LOCK:
        if MONITOR_ENRICHMENT_RUNNING:
            return False
        MONITOR_ENRICHMENT_RUNNING = True
    Thread(target=monitor_datasite_enrichment_worker, daemon=True).start()
    return True


def story_path_index() -> dict[str, str]:
    global STORY_PATH_INDEX
    if STORY_PATH_INDEX is not None:
        return STORY_PATH_INDEX
    index: dict[str, str] = {}
    try:
        rows = request_public_json(STORY_PATH_URL, max_bytes=48 * 1024 * 1024)
        if isinstance(rows, list):
            for value in rows:
                if not isinstance(value, list) or len(value) < 2:
                    continue
                source, csv_path = str(value[0] or ""), str(value[1] or "")
                match = re.fullmatch(r"([^/]+)/([^/]+)\.json", source.lstrip("/"))
                if match and csv_path:
                    index[f"{match.group(1)}/{match.group(2)}"] = csv_path
    except Exception:
        index = {}
    STORY_PATH_INDEX = index
    return index


def title_from_story_path(event_type: str, event_id: str) -> str:
    csv_path = story_path_index().get(f"{event_type}/{event_id}", "")
    stem = PurePosixPath(csv_path).stem.strip()
    if not stem:
        return ""
    if event_type == "game_event_communications":
        stem = re.sub(
            r"^(?:序章|終章|终章|オープニング|エンディング|第\s*[0-9一二三四五六]+\s*[話话])\s*[-_.：:]?\s*",
            "", stem,
        ).strip()
    elif event_type == "produce_events":
        stem = re.sub(r"^(?:TE|True\s*End|\d{1,2})\s*[.．、_-]\s*", "", stem, flags=re.I).strip()
    if not stem or stem == event_id or stem.lower().startswith(("produce_events_", "game_event_communications_")):
        return ""
    return stem


def resolve_scenario_metadata(event_type: object, event_id: object) -> dict[str, str]:
    safe_type = validate_key(event_type, "eventType")
    safe_id = validate_key(event_id, "eventId")
    key = f"{safe_type}/{safe_id}"
    cached = read_scenario_metadata_cache().get(key)
    if isinstance(cached, dict) and str(cached.get("storyTitle") or "").strip():
        if safe_type == "produce_events":
            persist_card_library_metadata(
                safe_id, cached.get("cardName"), cached.get("cardId", "")
            )
        return {str(name): str(value) for name, value in cached.items()}

    monitored = monitor_scenario_metadata(safe_type, safe_id)
    if monitored:
        store_scenario_metadata([monitored])
        if safe_type == "produce_events":
            persist_card_library_metadata(
                safe_id, monitored.get("cardName"), monitored.get("cardId", "")
            )
        return monitored

    if safe_type == "produce_events" and re.fullmatch(r"[23]\d{8}", safe_id):
        try:
            rows = fetch_card_detail_metadata(safe_id)
            hit = next((row for row in rows if row.get("eventId") == safe_id), None)
            if hit:
                persist_card_library_metadata(
                    safe_id, hit.get("cardName"), hit.get("cardId", ""),
                    "shinycolors.moe/card-event-id",
                )
                return hit
        except Exception:
            pass

    title = title_from_story_path(safe_type, safe_id)
    if title:
        row = {
            "eventType": safe_type,
            "eventId": safe_id,
            "storyTitle": title,
            "source": "biuuu/ShinyColors story-path",
        }
        store_scenario_metadata([row])
        return row
    return {"eventType": safe_type, "eventId": safe_id, "storyTitle": "", "source": "fallback"}


def csv_story_prefix(event_type: str, event_id: str) -> str:
    sequence = event_id[-2:] if len(event_id) >= 2 else event_id
    if event_type == "produce_events" and re.fullmatch(r"[23]\d{8}", event_id):
        return "TE" if sequence == "11" else sequence
    if event_type == "game_event_communications" and re.fullmatch(r"4001\d{5}", event_id):
        if sequence == "01":
            return "序章"
        if sequence == "08":
            return "终章"
        if sequence.isdigit() and 2 <= int(sequence) <= 7:
            return f"{int(sequence) - 1:02d}"
    match = re.fullmatch(r"1\d{3}(\d{3})(\d{2,3})", event_id) if event_type == "produce_events" else None
    if match:
        mode, story = match.groups()
        main_sequences = {
            "000": {"01", "02"},
            "001": {"01", "02", "03", "04", "05", "11"},
            "002": {"01", "02", "11"},
            "003": {"01", "02", "03", "04", "05", "09"},
            "004": {"01", "02", "03", "04", "05", "06"},
            "005": {"01", "02", "03", "04", "05", "06"},
        }
        if story in main_sequences.get(mode, set()):
            return "TE" if story == "11" else story
    return ""


def safe_filename_part(value: object, fallback: str) -> str:
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "＿", str(value or "").strip())
    text = text.rstrip(" .")
    return text[:160] or fallback


def scenario_csv_filename(metadata: dict[str, str], corrected: bool = False) -> str:
    event_type = str(metadata.get("eventType") or "")
    event_id = str(metadata.get("eventId") or "")
    prefix = csv_story_prefix(event_type, event_id)
    title = safe_filename_part(metadata.get("storyTitle"), event_id)
    correction = "【校】" if corrected else ""
    numbered = f"{safe_filename_part(prefix, event_id)}." if prefix else ""
    return f"{correction}{numbered}{title}.csv"


def fetch_scenario_tracks(event_type: str, event_id: str) -> list[object]:
    errors = []
    for root in REMOTE_SCENARIO_ROOTS:
        try:
            value = request_public_json(f"{root}/{event_type}/{event_id}.json", max_bytes=16 * 1024 * 1024)
            if not isinstance(value, list) or not value:
                raise ValueError("scenario JSON is not a non-empty array")
            return value
        except Exception as error:
            errors.append(f"{root}: {error}")
    raise ValueError("剧情抓取失败：" + " | ".join(errors))


def normalize_translator_name(value: object) -> str:
    translator = str(value or "").strip()
    if len(translator) > 80:
        raise ValueError("translator must be 80 characters or fewer")
    return translator


def ensure_scenario_csv_metadata(
    content: str, event_type: str, event_id: str, translator: str = ""
) -> str:
    """Add/update the two footer rows used by the legacy translation tools.

    SC-VIEWER resolves the original scenario JSON from the ``info`` row rather
    than from the dialogue IDs.  Keep the translator row as a separate footer
    so files can still be imported into the original page-game translation
    workflow.
    """
    has_bom = content.startswith("\ufeff")
    source = content.lstrip("\ufeff")
    rows = list(csv.reader(io.StringIO(source, newline="")))
    if not rows or not {"id", "name", "text", "trans"}.issubset(
        {str(cell).strip().lower() for cell in rows[0]}
    ):
        raise ValueError("CSV header id,name,text,trans was not found")
    header = [str(cell).strip().lower() for cell in rows[0]]
    indexes = {key: header.index(key) for key in ("id", "name", "text", "trans")}
    json_path = f"{event_type}/{event_id}.json"
    info_row = next(
        (row for row in rows[1:] if len(row) > indexes["id"] and str(row[indexes["id"]]).strip().lower() == "info"),
        None,
    )
    if info_row is None:
        info_row = []
        rows.append(info_row)
    while len(info_row) < len(header):
        info_row.append("")
    info_row[indexes["id"]] = "info"
    info_row[indexes["name"]] = json_path
    translator_row = next(
        (row for row in rows[1:] if len(row) > indexes["id"] and str(row[indexes["id"]]).strip() == "译者"),
        None,
    )
    if translator_row is None:
        translator_row = [""] * len(header)
        translator_row[indexes["id"]] = "译者"
        rows.append(translator_row)
    normalized_translator = normalize_translator_name(translator)
    if normalized_translator:
        translator_row[indexes["name"]] = normalized_translator
    output = io.StringIO(newline="")
    csv.writer(output, lineterminator="\n").writerows(rows)
    return ("\ufeff" if has_bom else "") + output.getvalue()


def tracks_to_csv(
    tracks: list[object], event_type: str = "", event_id: str = "", translator: str = ""
) -> str:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["id", "name", "text", "trans"])
    for track in tracks:
        if not isinstance(track, dict):
            continue
        field = "text" if isinstance(track.get("text"), str) else "select" if isinstance(track.get("select"), str) else ""
        if not field:
            continue
        identifier = "select" if field == "select" else str(track.get("id") or "0000000000000")
        speaker = "" if field == "select" else str(track.get("speaker") or "")
        source = str(track.get(field) or "").replace("\\n", "\n").replace("\r\n", "\n").replace("\r", "\n")
        writer.writerow([identifier, speaker, source.replace("\n", "\\n"), ""])
    if event_type and event_id:
        writer.writerow(["info", f"{event_type}/{event_id}.json", "", ""])
        writer.writerow(["译者", normalize_translator_name(translator), "", ""])
    return output.getvalue()


def scenario_group_signature(event_type: str, event_id: str) -> str:
    if event_type == "special_communications":
        match = re.fullmatch(r"4902(\d{3})(\d{3})", event_id)
        if match:
            return f"4902{match.group(1)}"
        match = re.fullmatch(r"490(\d{2})0(\d{3})", event_id)
        if match:
            return f"490{match.group(1)}"
    return event_id[:-2] if len(event_id) > 2 else event_id


def character_id_from_speaker(value: object) -> str:
    speaker = str(value or "").strip()
    if not speaker:
        return ""
    for character_id, (_, _, aliases) in CHARACTER_ARCHIVE_INFO.items():
        if any(speaker == alias or (len(alias) >= 2 and alias in speaker) for alias in aliases):
            return character_id
    return ""


def character_ids_from_tracks(tracks: list[object]) -> set[str]:
    return {
        character_id
        for track in tracks
        if isinstance(track, dict)
        for character_id in [character_id_from_speaker(track.get("speaker"))]
        if character_id
    }


def activity_unit_label(tracks: list[object]) -> str:
    unit_labels = {
        CHARACTER_ARCHIVE_INFO[character_id][1]
        for character_id in character_ids_from_tracks(tracks)
        if character_id in CHARACTER_ARCHIVE_INFO
        and CHARACTER_ARCHIVE_INFO[character_id][1].endswith("组活")
    }
    if len(unit_labels) == 1:
        return next(iter(unit_labels))
    if len(unit_labels) > 1:
        return "跨组组活"
    return ""


def special_occasion_label(tracks: list[object]) -> str:
    corpus = "\n".join(
        str(track.get("text") or track.get("select") or "")
        for track in tracks if isinstance(track, dict)
    )
    checks = (
        ("白色情人节", r"ホワイト\s*デー|白色情人节"),
        ("万圣节", r"ハロウィン|トリック[・･ ]?オア[・･ ]?トリート|万圣节"),
        ("圣诞节", r"クリスマス|サンタクロース|サンタ|圣诞"),
        ("情人节", r"バレンタイン|情人节"),
    )
    for label, pattern in checks:
        if re.search(pattern, corpus, flags=re.I):
            return label
    return "特殊剧情"


def detected_year(payload: dict[str, object]) -> str:
    value = str(payload.get("updateDetectedAt") or "").strip()
    match = re.match(r"^(20\d{2})-", value)
    return match.group(1) if match else ""


def group_archive_stem(
    event_type: str,
    event_ids: list[str],
    tracks_by_id: dict[str, list[object]],
    metadata_by_id: dict[str, dict[str, str]],
    payload: dict[str, object],
) -> str:
    first_id = event_ids[0]
    all_tracks = [track for event_id in event_ids for track in tracks_by_id[event_id]]
    if event_type == "game_event_communications":
        match = re.match(r"^4001(\d{3})", first_id)
        number = str(int(match.group(1))) if match else first_id
        unit = activity_unit_label(all_tracks)
        return f"第{number}次组活{f'-{unit}' if unit else ''}"
    if event_type == "produce_events" and re.fullmatch(r"[23]\d{8}", first_id):
        character_id = first_id[1:4]
        short_name = CHARACTER_ARCHIVE_INFO.get(character_id, (f"角色{character_id}", "", ()))[0]
        card_type = "P卡" if first_id.startswith("2") else "S卡"
        card_name = next((
            str(metadata.get("cardName") or "").strip()
            for metadata in metadata_by_id.values()
            if str(metadata.get("cardName") or "").strip()
        ), "")
        bracket = re.search(r"【[^】]+】", card_name)
        title = bracket.group(0) if bracket else card_name
        return f"{short_name}{card_type}{f'・{title}' if title else ''}"
    if event_type == "special_communications":
        occasion = special_occasion_label(all_tracks)
        if not occasion.endswith("剧情"):
            occasion += "剧情"
        year = detected_year(payload)
        return f"{year}年{occasion}" if year else occasion
    return f"{scenario_group_signature(event_type, first_id)}__"


def export_scenario_group(payload: dict[str, object]) -> tuple[bytes, str, int]:
    event_type = validate_key(payload.get("eventType"), "eventType")
    raw_ids = payload.get("eventIds")
    if not isinstance(raw_ids, list):
        raise ValueError("eventIds must be an array")
    event_ids = list(dict.fromkeys(validate_key(value, "eventId") for value in raw_ids))
    translator = normalize_translator_name(payload.get("translator"))
    if not event_ids or len(event_ids) > 160:
        raise ValueError("整组导出必须包含 1 到 160 个剧情编号")
    signatures = {scenario_group_signature(event_type, value) for value in event_ids}
    if len(signatures) != 1:
        raise ValueError("整组导出的剧情编号必须属于同一张卡或同一次活动")

    ordered_ids = sorted(event_ids, key=(
        (lambda value: (0, int(value)))
        if event_type == "special_communications"
        else (lambda value: (0, int(value[-2:])) if value[-2:].isdigit() else (1, value))
    ))
    tracks_by_id = {event_id: fetch_scenario_tracks(event_type, event_id) for event_id in ordered_ids}
    metadata_by_id = {event_id: resolve_scenario_metadata(event_type, event_id) for event_id in ordered_ids}
    archive = io.BytesIO()
    used_names: set[str] = set()
    special_character_counts: dict[str, int] = {}
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for event_id in ordered_ids:
            tracks = tracks_by_id[event_id]
            metadata = metadata_by_id[event_id]
            if event_type == "special_communications":
                character_ids = character_ids_from_tracks(tracks)
                character_id = sorted(character_ids)[0] if character_ids else ""
                short_name = CHARACTER_ARCHIVE_INFO.get(character_id, (event_id, "", ()))[0]
                special_character_counts[short_name] = special_character_counts.get(short_name, 0) + 1
                filename = f"{safe_filename_part(short_name, event_id)}{special_character_counts[short_name]:02d}.csv"
            else:
                filename = scenario_csv_filename(metadata)
            if filename in used_names:
                filename = f"{event_id}.{filename}"
            used_names.add(filename)
            bundle.writestr(
                filename,
                tracks_to_csv(tracks, event_type, event_id, translator).encode("utf-8-sig"),
            )
    archive_stem = group_archive_stem(event_type, ordered_ids, tracks_by_id, metadata_by_id, payload)
    return archive.getvalue(), f"{safe_filename_part(archive_stem, 'scenario-group')}.zip", len(event_ids)


def scenario_group_summary(payload: dict[str, object]) -> dict[str, str]:
    event_type = validate_key(payload.get("eventType"), "eventType")
    raw_ids = payload.get("eventIds")
    if not isinstance(raw_ids, list):
        raise ValueError("eventIds must be an array")
    event_ids = list(dict.fromkeys(validate_key(value, "eventId") for value in raw_ids))
    if not event_ids or len(event_ids) > 160:
        raise ValueError("整组识别必须包含 1 到 160 个剧情编号")
    signatures = {scenario_group_signature(event_type, value) for value in event_ids}
    if len(signatures) != 1:
        raise ValueError("整组识别的剧情编号必须属于同一张卡、同一次活动或同批特殊剧情")
    ordered_ids = sorted(event_ids, key=(
        (lambda value: (0, int(value)))
        if event_type == "special_communications"
        else (lambda value: (0, int(value[-2:])) if value[-2:].isdigit() else (1, value))
    ))
    cache_key = f"{event_type}/{detected_year(payload)}/{'|'.join(ordered_ids)}"
    cached = SCENARIO_GROUP_SUMMARY_CACHE.get(cache_key)
    if cached:
        return cached
    tracks_by_id = {event_id: fetch_scenario_tracks(event_type, event_id) for event_id in ordered_ids}
    metadata_by_id = {event_id: resolve_scenario_metadata(event_type, event_id) for event_id in ordered_ids}
    label = group_archive_stem(event_type, ordered_ids, tracks_by_id, metadata_by_id, payload)
    result = {"label": label, "archiveName": f"{safe_filename_part(label, 'scenario-group')}.zip"}
    SCENARIO_GROUP_SUMMARY_CACHE[cache_key] = result
    if event_type == "game_event_communications":
        persist_activity_library_metadata(ordered_ids[0], label)
    elif event_type == "produce_events":
        card_name = next((
            str(metadata.get("cardName") or "").strip()
            for metadata in metadata_by_id.values()
            if str(metadata.get("cardName") or "").strip()
        ), "")
        card_id = next((
            str(metadata.get("cardId") or "").strip()
            for metadata in metadata_by_id.values()
            if str(metadata.get("cardId") or "").strip()
        ), "")
        persist_card_library_metadata(ordered_ids[0], card_name, card_id)
    return result


def official_card_resource_definition(kind: str, raw_id: object) -> tuple[str, str, int]:
    card_id = validate_key(raw_id, "card id")
    definitions = {
        "produce-still": (f"images/content/idols/card/{card_id}.jpg", "image/", MAX_EXTERNAL_CARD_SIZE),
        "support-still": (f"images/content/support_idols/card/{card_id}.jpg", "image/", MAX_EXTERNAL_CARD_SIZE),
        "produce-movie": (f"movies/idols/card/{card_id}.mp4", "video/", MAX_EXTERNAL_MOVIE_SIZE),
        "produce-costume-movie": (f"movies/idols/card_costume/{card_id}.mp4", "video/", MAX_EXTERNAL_MOVIE_SIZE),
    }
    if kind not in definitions:
        raise ValueError(f"Unsupported card resource: {kind!r}")
    return definitions[kind]


def monitor_listener_active(state: dict[str, object], within_seconds: int = 20 * 60) -> bool:
    value = str(state.get("lastObservedAt") or "")
    try:
        observed = datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return False
    return time.time() - observed <= within_seconds


def request_official_card_resource(kind: str, raw_id: object) -> dict[str, object]:
    card_id = validate_key(raw_id, "card id")
    relative, _, _ = official_card_resource_definition(kind, card_id)
    destination = validated_asset_path(relative)
    if destination.is_file() and destination.stat().st_size >= 512:
        return {"status": "ready", "saved": f"assets/{relative}", "listenerActive": True}
    requested_at = utc_now()
    with MONITOR_STATE_LOCK:
        state = read_monitor_state()
        requests = state.setdefault("resourceRequests", {})
        key = f"{kind}/{card_id}"
        requests[key] = {
            "key": key,
            "kind": kind,
            "cardId": card_id,
            "path": relative,
            "status": "pending",
            "requestedAt": requested_at,
        }
        active = monitor_listener_active(state)
        write_monitor_state(state)
    return {"status": "pending", "kind": kind, "cardId": card_id, "listenerActive": active}


def pending_official_card_resource_requests() -> dict[str, object]:
    changed = False
    with MONITOR_STATE_LOCK:
        state = read_monitor_state()
        requests = state.setdefault("resourceRequests", {})
        pending: list[dict[str, str]] = []
        for key, value in list(requests.items()):
            if not isinstance(value, dict) or str(value.get("status") or "") != "pending":
                continue
            relative = str(value.get("path") or "")
            try:
                destination = validated_asset_path(relative)
            except ValueError:
                requests.pop(key, None)
                changed = True
                continue
            if destination.is_file() and destination.stat().st_size >= 512:
                value["status"] = "ready"
                value["completedAt"] = utc_now()
                changed = True
                continue
            pending.append({
                "kind": str(value.get("kind") or ""),
                "cardId": str(value.get("cardId") or ""),
                "path": relative,
            })
        if changed:
            write_monitor_state(state)
    return {"items": pending, "count": len(pending)}


def complete_official_card_resource_request(kind: str, raw_id: object, saved: object) -> None:
    card_id = validate_key(raw_id, "card id")
    key = f"{kind}/{card_id}"
    with MONITOR_STATE_LOCK:
        state = read_monitor_state()
        requests = state.setdefault("resourceRequests", {})
        value = requests.get(key)
        if isinstance(value, dict):
            value["status"] = "ready"
            value["saved"] = str(saved or "")
            value["completedAt"] = utc_now()
            write_monitor_state(state)


def fetch_community_card_resource(kind: str, raw_id: object) -> dict[str, object]:
    card_id = validate_key(raw_id, "card id")
    relative, expected_type, max_size = official_card_resource_definition(kind, card_id)
    remote_url = f"{COMMUNITY_CARD_ROOT}/{relative}"
    destination = validated_asset_path(relative)
    if destination.is_file() and 512 <= destination.stat().st_size <= max_size:
        return {
            "saved": str(destination.relative_to(PROJECT_ROOT)).replace("\\", "/"),
            "bytes": destination.stat().st_size,
            "source": remote_url,
            "cached": True,
        }
    request = Request(remote_url, headers={
        "User-Agent": "Mozilla/5.0 ShinyScenarioWorkshop/1.0",
        "Referer": "https://shinycolors.moe/",
    })
    with urlopen(request, timeout=45) as response:
        content_type = str(response.headers.get("Content-Type") or "").lower()
        if content_type and not content_type.startswith(expected_type):
            raise ValueError(f"Unexpected community card content type: {content_type}")
        content = response.read(max_size + 1)
    if len(content) < 512 or len(content) > max_size:
        raise ValueError("Community card resource size is invalid")
    atomic_write_bytes(destination, content)
    return {
        "saved": str(destination.relative_to(PROJECT_ROOT)).replace("\\", "/"),
        "bytes": len(content),
        "source": remote_url,
    }


def import_official_card_resource(
    kind: str,
    raw_id: object,
    content: bytes,
    content_type: str = "",
) -> dict[str, object]:
    """Persist a card resource fetched inside the authenticated game page.

    The userscript resolves the current asset-map hash/encrypted URL in page
    context, downloads the resource with the game's own session, then sends
    only the resulting media bytes to this local endpoint.
    """
    card_id = validate_key(raw_id, "card id")
    relative, expected_type, max_size = official_card_resource_definition(kind, card_id)
    normalized_type = str(content_type or "").split(";", 1)[0].strip().lower()
    if normalized_type and normalized_type != "application/octet-stream" and not normalized_type.startswith(expected_type):
        raise ValueError(f"Unexpected official card content type: {normalized_type}")
    if len(content) < 512 or len(content) > min(max_size, MAX_BODY_SIZE):
        raise ValueError("Official card resource size is invalid")
    if expected_type == "image/":
        is_image = (
            content.startswith(b"\xff\xd8\xff")
            or content.startswith(b"\x89PNG\r\n\x1a\n")
            or (content.startswith(b"RIFF") and content[8:12] == b"WEBP")
        )
        if not is_image:
            raise ValueError("Official card image signature is invalid")
    elif len(content) < 12 or content[4:8] != b"ftyp":
        raise ValueError("Official card movie signature is invalid")
    destination = validated_asset_path(relative)
    atomic_write_bytes(destination, content)
    return {
        "saved": str(destination.relative_to(PROJECT_ROOT)).replace("\\", "/"),
        "bytes": len(content),
        "source": "official-game-session",
        "kind": kind,
        "cardId": card_id,
    }


class ViewerRequestHandler(SimpleHTTPRequestHandler):
    server_version = "ShinyScenarioViewer/1.0"

    def end_headers(self) -> None:
        request_path = urlparse(self.path).path.lower()
        if request_path.endswith((".html", ".js", ".css", ".csv")):
            self.send_header("Cache-Control", "no-store")
        if request_path.endswith(".mp4"):
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self._send_json({
                "speakers": read_speaker_rows(),
                "speakerArchive": str(SPEAKER_CSV),
                "legacySpeakerArchive": str(LEGACY_SPEAKER_CSV),
            })
            return
        if parsed.path == "/api/scenario-metadata":
            try:
                query = parse_qs(parsed.query)
                self._send_json(resolve_scenario_metadata(
                    (query.get("eventType") or [""])[0],
                    (query.get("eventId") or [""])[0],
                ))
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
            return
        if parsed.path == "/api/video-export/status":
            try:
                query = parse_qs(parsed.query)
                job = get_video_export_job((query.get("job") or [""])[0])
                self._send_json(public_video_export_job(job))
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
            return
        if parsed.path == "/api/obs-export/status":
            try:
                query = parse_qs(parsed.query)
                self._send_json(OBS_EXPORT_MANAGER.get_public((query.get("job") or [""])[0]))
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
            return
        # LOCAL_MONITOR_BEGIN
        if parsed.path == "/api/game-update-monitor":
            self._send_json(monitor_public_state(read_monitor_state()))
            return
        if parsed.path == "/api/scenario-library-labels":
            self._send_json(public_scenario_library_labels())
            return
        if parsed.path == "/api/official-card-resource-requests":
            self._send_json(pending_official_card_resource_requests())
            return
        if parsed.path == "/api/scenario-types":
            try:
                query = parse_qs(parsed.query)
                event_id = (query.get("eventId") or [""])[0]
                self._send_json({"eventId": event_id, "eventTypes": known_scenario_types(event_id)})
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
            return
        # LOCAL_MONITOR_END
        if parsed.path.lower().endswith(".mp4") and self.headers.get("Range"):
            self._send_media_range(parsed.path, self.headers["Range"])
            return
        super().do_GET()

    def _send_media_range(self, request_path: str, range_header: str) -> None:
        media_path = Path(self.translate_path(request_path)).resolve()
        try:
            media_path.relative_to(PROJECT_ROOT.resolve())
        except ValueError:
            self.send_error(403, "Media path is outside the project")
            return
        if not media_path.is_file():
            self.send_error(404, "Media file not found")
            return

        size = media_path.stat().st_size
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", str(range_header or "").strip())
        if not match or size <= 0:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return

        start_text, end_text = match.groups()
        if start_text:
            start = int(start_text)
            end = int(end_text) if end_text else size - 1
        elif end_text:
            suffix_length = int(end_text)
            start = max(0, size - suffix_length)
            end = size - 1
        else:
            start, end = 0, size - 1
        end = min(end, size - 1)
        if start < 0 or start >= size or end < start:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return

        length = end - start + 1
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(str(media_path)))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.send_header("Last-Modified", self.date_time_string(media_path.stat().st_mtime))
        self.end_headers()
        with media_path.open("rb") as stream:
            stream.seek(start)
            remaining = length
            while remaining > 0:
                chunk = stream.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/speakers":
                payload = self._read_json()
                entries = payload.get("entries")
                if not isinstance(entries, list):
                    raise ValueError("entries must be an array")
                self._send_json({"speakers": write_speaker_rows(entries)})
                return

            if parsed.path == "/api/video-export/create":
                self._send_json(create_video_export_job(self._read_json()), status=201)
                return

            if parsed.path == "/api/video-export/chunk":
                query = parse_qs(parsed.query)
                job_id = (query.get("job") or [""])[0]
                index_text = (query.get("index") or [""])[0]
                if not index_text.isdigit():
                    raise ValueError("Video export chunk index must be a non-negative integer")
                self._send_json(append_video_export_chunk(job_id, int(index_text), self._read_body()))
                return

            if parsed.path == "/api/video-export/finish":
                self._send_json(finish_video_export_job(self._read_json()), status=202)
                return

            if parsed.path == "/api/video-export/cancel":
                self._send_json(cancel_video_export_job(self._read_json()))
                return

            if parsed.path == "/api/obs/probe":
                self._send_json(OBS_EXPORT_MANAGER.probe(self._read_json()))
                return

            if parsed.path == "/api/obs-export/create":
                if not VIDEO_EXPORT_ENABLED:
                    raise ValueError("视频直出功能已暂停研发；当前版本不会启动 OBS 录制任务。")
                self._send_json(
                    OBS_EXPORT_MANAGER.create(self._read_json(), validate_key),
                    status=201,
                )
                return

            if parsed.path == "/api/obs-export/player-ready":
                self._send_json(OBS_EXPORT_MANAGER.player_ready(self._read_json()))
                return

            if parsed.path == "/api/obs-export/audio-chunk":
                query = parse_qs(parsed.query)
                job_id = (query.get("job") or [""])[0]
                index_text = (query.get("index") or [""])[0]
                if not index_text.isdigit():
                    raise ValueError("OBS audio chunk index must be a non-negative integer")
                self._send_json(
                    OBS_EXPORT_MANAGER.append_audio_chunk(job_id, int(index_text), self._read_body())
                )
                return

            if parsed.path == "/api/obs-export/player-finished":
                self._send_json(OBS_EXPORT_MANAGER.player_finished(self._read_json()), status=202)
                return

            if parsed.path == "/api/obs-export/player-error":
                self._send_json(OBS_EXPORT_MANAGER.player_error(self._read_json()))
                return

            if parsed.path == "/api/obs-export/cancel":
                self._send_json(OBS_EXPORT_MANAGER.cancel(self._read_json()))
                return

            # LOCAL_MONITOR_BEGIN
            if parsed.path == "/api/game-update-observation":
                self._send_json(observe_game_updates(self._read_json()))
                return

            if parsed.path == "/api/game-update-status":
                self._send_json(update_game_monitor_status(self._read_json()))
                return

            if parsed.path == "/api/game-update-acknowledge":
                self._read_body()
                self._send_json(acknowledge_game_updates())
                return

            if parsed.path == "/api/request-official-card-resource":
                query = parse_qs(parsed.query)
                kind = (query.get("kind") or [""])[0]
                card_id = (query.get("id") or [""])[0]
                self._read_body()
                self._send_json(request_official_card_resource(kind, card_id))
                return

            if parsed.path == "/api/rebuild-scenario-library-labels":
                self._read_body()
                self._send_json(public_scenario_library_labels(rebuild_scenario_library_metadata()))
                return
            # LOCAL_MONITOR_END

            if parsed.path == "/api/export-scenario-group":
                content, filename, count = export_scenario_group(self._read_json())
                self._send_bytes(
                    content,
                    "application/zip",
                    headers={
                        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
                        "X-Scenario-Count": str(count),
                    },
                )
                return

            if parsed.path == "/api/scenario-group-summary":
                self._send_json(scenario_group_summary(self._read_json()))
                return

            if parsed.path == "/api/fetch-card-resource":
                query = parse_qs(parsed.query)
                kind = (query.get("kind") or [""])[0]
                card_id = (query.get("id") or [""])[0]
                self._send_json(fetch_community_card_resource(kind, card_id))
                return

            if parsed.path == "/api/import-official-card-resource":
                query = parse_qs(parsed.query)
                kind = (query.get("kind") or [""])[0]
                card_id = (query.get("id") or [""])[0]
                result = import_official_card_resource(
                    kind,
                    card_id,
                    self._read_body(),
                    self.headers.get("Content-Type") or "",
                )
                complete_official_card_resource_request(kind, card_id, result.get("saved"))
                self._send_json(result)
                return

            if parsed.path == "/api/cache-resource":
                query = parse_qs(parsed.query)
                relative = (query.get("path") or [""])[0]
                destination = validated_asset_path(relative)
                content = self._read_body()
                atomic_write_bytes(destination, content)
                self._send_json({
                    "saved": str(destination.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                    "bytes": len(content),
                })
                return

            if parsed.path == "/api/save-export":
                payload = self._read_json()
                kind = str(payload.get("kind") or "").strip().lower()
                if kind not in {"japanese", "translated"}:
                    raise ValueError("kind must be japanese or translated")
                event_type = validate_key(payload.get("eventType"), "eventType")
                event_id = validate_key(payload.get("eventId"), "eventId")
                content = payload.get("content")
                if not isinstance(content, str):
                    tracks = payload.get("tracks")
                    if not isinstance(tracks, list):
                        raise ValueError("content or tracks is required")
                    content = json.dumps(tracks, ensure_ascii=False, indent=2) + "\n"
                destination = EXPORT_ROOT / kind / event_type / f"{event_id}.json"
                atomic_write_text(destination, content)
                self._send_json({
                    "saved": str(destination.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                    "bytes": len(content.encode("utf-8")),
                })
                return

            if parsed.path == "/api/save-translation":
                payload = self._read_json()
                event_type = validate_key(payload.get("eventType"), "eventType")
                event_id = validate_key(payload.get("eventId"), "eventId")
                content = payload.get("content")
                if not isinstance(content, str):
                    raise ValueError("content must be a string")
                content = ensure_scenario_csv_metadata(
                    content, event_type, event_id, normalize_translator_name(payload.get("translator"))
                )
                destination = TRANSLATION_ROOT / event_type / f"{event_id}.csv"
                atomic_write_text(destination, content)
                self._send_json({
                    "saved": str(destination.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                    "bytes": len(content.encode("utf-8")),
                })
                return

            self.send_error(404, "Unknown API route")
        except (ValueError, json.JSONDecodeError) as error:
            self._send_json({"error": str(error)}, status=400)
        except Exception as error:
            self._send_json({"error": str(error)}, status=500)

    def _read_body(self) -> bytes:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise ValueError("Content-Length is required")
        length = int(raw_length)
        if length < 0 or length > MAX_BODY_SIZE:
            raise ValueError("Request body is too large")
        return self.rfile.read(length)

    def _read_json(self) -> dict[str, object]:
        body = self._read_body()
        payload = json.loads(body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("JSON body must be an object")
        return payload

    def _send_json(self, payload: object, status: int = 200) -> None:
        body = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(
        self,
        body: bytes,
        content_type: str,
        status: int = 200,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)


def viewer_is_already_running() -> bool:
    try:
        with urlopen(f"{BASE_URL}/app.html", timeout=1.5) as response:
            page = response.read(128 * 1024)
        return b"Shiny Scenario Workshop" in page
    except Exception:
        return False


def main() -> int:
    ensure_speaker_archive()
    handler = partial(ViewerRequestHandler, directory=str(PROJECT_ROOT))
    try:
        server = ThreadingHTTPServer((HOST, PORT), handler)
        server.daemon_threads = True
    except OSError as error:
        if viewer_is_already_running():
            webbrowser.open(APP_URL)
            print("Shiny Scenario Workshop is already running. Opened it in your browser.")
            return 0
        print(f"Could not start Shiny Scenario Workshop on port {PORT}: {error}")
        return 1

    print(f"Shiny Scenario Workshop: {APP_URL}")
    print("Press Ctrl+C to stop the local app.")
    if os.environ.get("SSV_NO_BROWSER") != "1":
        Timer(0.4, lambda: webbrowser.open(APP_URL)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShiny Scenario Workshop stopped.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
