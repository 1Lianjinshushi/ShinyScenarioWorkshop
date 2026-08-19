from __future__ import annotations

import csv
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
SPEC = importlib.util.spec_from_file_location("ssv_server", ROOT / "serve-viewer.py")
assert SPEC and SPEC.loader
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)


class ScenarioCsvExportTests(unittest.TestCase):
    def test_official_card_resource_is_queued_only_on_playback_request(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            state_path = root / "monitor" / "game-update-state.json"
            state_path.parent.mkdir(parents=True, exist_ok=True)
            state = SERVER.empty_monitor_state()
            state["lastObservedAt"] = SERVER.utc_now()
            state_path.write_text(json.dumps(state), encoding="utf-8")
            with patch.object(SERVER, "PROJECT_ROOT", root), patch.object(
                SERVER, "ASSET_ROOT", root / "assets"
            ), patch.object(SERVER, "MONITOR_ROOT", state_path.parent), patch.object(
                SERVER, "MONITOR_STATE", state_path
            ):
                self.assertEqual(SERVER.pending_official_card_resource_requests()["count"], 0)
                queued = SERVER.request_official_card_resource("support-still", "2040160200")
                self.assertEqual(queued["status"], "pending")
                self.assertTrue(queued["listenerActive"])
                pending = SERVER.pending_official_card_resource_requests()
                self.assertEqual(pending["count"], 1)
                self.assertEqual(pending["items"][0]["cardId"], "2040160200")

                destination = root / "assets" / "images" / "content" / "support_idols" / "card" / "2040160200.jpg"
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(b"\xff\xd8\xff" + (b"x" * 600))
                self.assertEqual(SERVER.pending_official_card_resource_requests()["count"], 0)

    def test_official_game_movie_import_validates_and_saves_media(self) -> None:
        movie = b"\x00\x00\x00\x18ftyp" + (b"\x00" * 1016)
        with tempfile.TemporaryDirectory() as folder, patch.object(
            SERVER, "PROJECT_ROOT", Path(folder)
        ), patch.object(SERVER, "ASSET_ROOT", Path(folder) / "assets"):
            result = SERVER.import_official_card_resource(
                "produce-movie", "1040270990", movie, "application/octet-stream"
            )
            saved = Path(folder) / "assets" / "movies" / "idols" / "card" / "1040270990.mp4"
            self.assertTrue(saved.is_file())
            self.assertEqual(saved.read_bytes(), movie)
            self.assertEqual(result["source"], "official-game-session")
            with self.assertRaisesRegex(ValueError, "signature"):
                SERVER.import_official_card_resource(
                    "produce-movie", "1040270991", b"<html>" + (b"x" * 600), "application/octet-stream"
                )

    def test_recent_datasite_card_can_fill_card_name_before_story_titles(self) -> None:
        with patch.object(SERVER, "request_public_json", return_value={
            "cardName": "【心ノアリカ】桑山千雪",
            "enzaId": "2040160200",
            "cardSupportEvents": [
                {"eventId": 301602701, "eventTitle": None},
                {"eventId": 301602702, "eventTitle": "第2话"},
            ],
        }):
            rows = SERVER.datasite_recent_card_rows({
                "cardType": "S_SSR", "cardUuid": "test-uuid",
                "enzaId": "2040160200", "idolId": 16,
                "cardName": "【心ノアリカ】桑山千雪",
            })
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["cardNameStatus"], "available")
        self.assertEqual(rows[0]["storyTitleStatus"], "pending")
        self.assertNotIn("storyTitle", rows[0])
        self.assertEqual(rows[1]["storyTitle"], "第2话")

    def test_recent_datasite_card_uses_event_name_for_story_titles(self) -> None:
        with patch.object(SERVER, "request_public_json", return_value={
            "cardName": "【ふいにサマーシャワー】田中摩美々",
            "enzaId": "2030050120",
            "cardSupportEvents": [
                {"eventId": 300502501, "eventName": "夏でもひんやり"},
                {"eventId": 300502502, "eventName": "ひんやり超えても夏"},
            ],
        }):
            rows = SERVER.datasite_recent_card_rows({
                "cardType": "S_SR", "cardUuid": "mamimi-s25",
                "enzaId": "2030050120", "idolId": 5,
                "cardName": "【ふいにサマーシャワー】田中摩美々",
            })
        self.assertEqual([row["storyTitle"] for row in rows], [
            "夏でもひんやり", "ひんやり超えても夏",
        ])

    def test_card_library_metadata_uses_exact_event_id_not_list_position(self) -> None:
        cards = [
            {
                "cardType": "P_SSR", "cardUuid": "no-commu-card",
                "cardName": "【不应占用剧情序号】園田智代子", "enzaId": "999",
            },
            {
                "cardType": "P_SSR", "cardUuid": "real-card",
                "cardName": "【Candyならいらない】園田智代子", "enzaId": "1040100140",
            },
        ]
        details = {
            "no-commu-card": {
                "cardName": "【不应占用剧情序号】園田智代子",
                "cardIdolEvents": [],
            },
            "real-card": {
                "cardName": "【Candyならいらない】園田智代子",
                "enzaId": "1040100140",
                "cardIdolEvents": [{"eventId": 201002001, "eventTitle": "夏のチョコアイドル"}],
            },
        }
        result = SERVER.card_metadata_from_idol_info(
            "010", {"cardLists": cards}, {"2010020"},
            lambda _endpoint, card_uuid: details[card_uuid],
        )
        self.assertEqual(result["2010020"]["cardName"], "【Candyならいらない】")
        self.assertEqual(result["2010020"]["label"], "智代子P卡・【Candyならいらない】")
        self.assertEqual(result["2010020"]["cardId"], "1040100140")
        self.assertEqual(result["2010020"]["source"], "shinycolors.moe/card-event-id")

    def test_story_filename_rules(self) -> None:
        self.assertEqual(SERVER.csv_story_prefix("produce_events", "201002001"), "01")
        self.assertEqual(SERVER.csv_story_prefix("produce_events", "201002011"), "TE")
        self.assertEqual(SERVER.csv_story_prefix("game_event_communications", "400109501"), "序章")
        self.assertEqual(SERVER.csv_story_prefix("game_event_communications", "400109502"), "01")
        self.assertEqual(SERVER.csv_story_prefix("game_event_communications", "400109508"), "终章")
        self.assertEqual(SERVER.scenario_csv_filename({
            "eventType": "produce_events",
            "eventId": "201002001",
            "storyTitle": "夏のチョコアイドル",
        }, corrected=True), "【校】01.夏のチョコアイドル.csv")

    def test_tracks_to_csv_preserves_semantic_choice_rows(self) -> None:
        value = SERVER.tracks_to_csv([
            {"id": "201002001001", "speaker": "園田智代子", "text": "一行目\n二行目"},
            {"select": "その意気だ！", "nextLabel": "branch"},
            {"bg": "not-a-dialogue"},
        ])
        rows = list(csv.DictReader(io.StringIO(value)))
        self.assertEqual(rows, [
            {"id": "201002001001", "name": "園田智代子", "text": "一行目\\n二行目", "trans": ""},
            {"id": "select", "name": "", "text": "その意気だ！", "trans": ""},
        ])

    def test_tracks_to_csv_can_emit_sc_viewer_footer_metadata(self) -> None:
        value = SERVER.tracks_to_csv([
            {"id": "2010020010010", "speaker": "智代子", "text": "原文"},
        ], "produce_events", "201002001")
        rows = list(csv.reader(io.StringIO(value)))
        self.assertEqual(rows[-2], ["info", "produce_events/201002001.json", "", ""])
        self.assertEqual(rows[-1], ["译者", "", "", ""])
        repaired = SERVER.ensure_scenario_csv_metadata(
            "id,name,text,trans\n2010020010010,智代子,原文,译文\ninfo,wrong/path.json,,\n译者,测试译者,,\n",
            "produce_events", "201002001",
        )
        repaired_rows = list(csv.reader(io.StringIO(repaired)))
        self.assertEqual(repaired_rows[-2], ["info", "produce_events/201002001.json", "", ""])
        self.assertEqual(repaired_rows[-1], ["译者", "测试译者", "", ""])
        signed = SERVER.ensure_scenario_csv_metadata(
            repaired, "produce_events", "201002001", "煉金術式"
        )
        signed_rows = list(csv.reader(io.StringIO(signed.lstrip("\ufeff"))))
        self.assertEqual(signed_rows[-1], ["译者", "煉金術式", "", ""])

    def test_group_zip_uses_story_titles(self) -> None:
        titles = {"201002001": "夏のチョコアイドル", "201002011": "なんて　アイドル"}
        with patch.object(SERVER, "fetch_scenario_tracks", side_effect=lambda event_type, event_id: [
            {"id": f"{event_id}001", "speaker": "テスト", "text": event_id},
        ]), patch.object(SERVER, "resolve_scenario_metadata", side_effect=lambda event_type, event_id: {
            "eventType": event_type,
            "eventId": event_id,
            "storyTitle": titles[event_id],
            "cardName": "【Candyならいらない】園田智代子",
        }):
            content, filename, count = SERVER.export_scenario_group({
                "eventType": "produce_events",
                "eventIds": ["201002011", "201002001"],
                "translator": "煉金術式",
            })
        self.assertEqual(filename, "智代子P卡・【Candyならいらない】.zip")
        self.assertEqual(count, 2)
        with zipfile.ZipFile(io.BytesIO(content)) as bundle:
            self.assertEqual(bundle.namelist(), ["01.夏のチョコアイドル.csv", "TE.なんて　アイドル.csv"])
            self.assertTrue(bundle.read(bundle.namelist()[0]).startswith(b"\xef\xbb\xbf"))
            first_rows = list(csv.reader(io.StringIO(
                bundle.read(bundle.namelist()[0]).decode("utf-8-sig")
            )))
            self.assertEqual(first_rows[-1], ["译者", "煉金術式", "", ""])

    def test_activity_unit_inference_ignores_non_idol_speakers(self) -> None:
        self.assertEqual(SERVER.activity_unit_label([
            {"speaker": "真乃", "text": "a"},
            {"speaker": "灯織", "text": "b"},
            {"speaker": "プロデューサー", "text": "c"},
        ]), "星组组活")
        self.assertEqual(SERVER.activity_unit_label([
            {"speaker": "真乃", "text": "a"},
            {"speaker": "恋鐘", "text": "b"},
        ]), "跨组组活")
        self.assertEqual(SERVER.activity_unit_label([
            {"speaker": "カホ＆ジュリ", "text": "a"},
            {"speaker": "チヨコ＆リンゼ＆ナツハ", "text": "b"},
        ]), "放课后组活")

    def test_activity_summary_uses_scanned_unit_membership(self) -> None:
        SERVER.SCENARIO_GROUP_SUMMARY_CACHE.clear()
        speakers = {"400109401": "真乃", "400109402": "灯織"}
        with patch.object(SERVER, "fetch_scenario_tracks", side_effect=lambda event_type, event_id: [
            {"speaker": speakers[event_id], "text": "test"},
        ]), patch.object(SERVER, "resolve_scenario_metadata", side_effect=lambda event_type, event_id: {
            "eventType": event_type, "eventId": event_id, "storyTitle": "test",
        }):
            summary = SERVER.scenario_group_summary({
                "eventType": "game_event_communications",
                "eventIds": ["400109401", "400109402"],
            })
        self.assertEqual(summary["label"], "第94次组活-星组组活")
        self.assertEqual(summary["archiveName"], "第94次组活-星组组活.zip")

    def test_special_zip_uses_holiday_and_character_part_names(self) -> None:
        with patch.object(SERVER, "fetch_scenario_tracks", side_effect=lambda event_type, event_id: [
            {"id": f"{event_id}001", "speaker": "智代子", "text": "ハロウィンのお菓子だよ"},
        ]), patch.object(SERVER, "resolve_scenario_metadata", side_effect=lambda event_type, event_id: {
            "eventType": event_type,
            "eventId": event_id,
            "storyTitle": "",
        }):
            content, filename, count = SERVER.export_scenario_group({
                "eventType": "special_communications",
                "eventIds": ["490250002", "490250001"],
                "updateDetectedAt": "2026-10-20T10:00:00+00:00",
            })
        self.assertEqual(filename, "2026年万圣节剧情.zip")
        self.assertEqual(count, 2)
        with zipfile.ZipFile(io.BytesIO(content)) as bundle:
            self.assertEqual(bundle.namelist(), ["智代子01.csv", "智代子02.csv"])

    def test_update_log_timestamp_survives_acknowledge(self) -> None:
        with tempfile.TemporaryDirectory() as folder, patch.object(
            SERVER, "MONITOR_STATE", Path(folder) / "state.json"
        ):
            baseline = SERVER.observe_game_updates({
                "entries": [{"eventType": "produce_events", "eventId": "201002001"}],
                "metadata": [],
                "assetVersion": "1",
            })
            self.assertTrue(baseline["baselineCreated"])
            self.assertEqual(baseline["unreadCount"], 0)
            update = SERVER.observe_game_updates({
                "entries": [
                    {"eventType": "produce_events", "eventId": "201002001"},
                    {"eventType": "produce_events", "eventId": "201002002"},
                ],
                "metadata": [],
                "assetVersion": "2",
            })
            new_row = next(row for row in update["items"] if row["eventId"] == "201002002")
            self.assertTrue(new_row["unread"])
            self.assertTrue(new_row["updateDetectedAt"])
            acknowledged = SERVER.acknowledge_game_updates()
            saved_row = next(row for row in acknowledged["items"] if row["eventId"] == "201002002")
            self.assertFalse(saved_row["unread"])
            self.assertEqual(saved_row["updateDetectedAt"], new_row["updateDetectedAt"])

    def test_v3_monitor_log_migration_removes_datasite_latest_cards_and_recovers_update(self) -> None:
        with tempfile.TemporaryDirectory() as folder, patch.object(
            SERVER, "MONITOR_STATE", Path(folder) / "state.json"
        ):
            state = SERVER.empty_monitor_state()
            state["version"] = 3
            state["initialized"] = True
            state["entries"] = {
                "produce_events/201102101": {
                    "key": "produce_events/201102101", "eventType": "produce_events", "eventId": "201102101",
                    "metadataSource": "shinycolors.moe", "updateKind": "implementation",
                    "updateDetectedAt": "2026-08-11T03:40:34+00:00", "unread": True,
                },
                "produce_events/301302801": {
                    "key": "produce_events/301302801", "eventType": "produce_events", "eventId": "301302801",
                    "updateKind": "baseline", "updateDetectedAt": "", "unread": False,
                },
                "special_communications/4902008013": {
                    "key": "special_communications/4902008013", "eventType": "special_communications", "eventId": "4902008013",
                    "updateKind": "baseline", "updateDetectedAt": "", "unread": False,
                },
            }
            SERVER.MONITOR_STATE.write_text(json.dumps(state), encoding="utf-8")
            migrated = SERVER.read_monitor_state()
        self.assertEqual(migrated["version"], 6)
        self.assertFalse(migrated["entries"]["produce_events/201102101"]["updateDetectedAt"])
        self.assertEqual(
            migrated["entries"]["produce_events/301302801"]["updateKind"], "preload"
        )
        self.assertEqual(
            migrated["entries"]["produce_events/301302801"]["staticCardStatus"], "missing"
        )
        self.assertEqual(
            migrated["entries"]["special_communications/4902008013"]["updateDetectedAt"],
            "2026-08-07T06:00:00+00:00",
        )

    def test_datasite_enrichment_does_not_create_update_log_entry(self) -> None:
        with tempfile.TemporaryDirectory() as folder, patch.object(
            SERVER, "MONITOR_STATE", Path(folder) / "state.json"
        ):
            state = SERVER.empty_monitor_state()
            state["initialized"] = True
            state["entries"] = {
                "produce_events/300502501": {
                    "key": "produce_events/300502501", "eventType": "produce_events", "eventId": "300502501",
                    "firstSeenAt": "2026-08-01T00:00:00+00:00", "lastSeenAt": "2026-08-01T00:00:00+00:00",
                    "updateKind": "baseline", "updateDetectedAt": "", "unread": False,
                },
            }
            SERVER.write_monitor_state(state)
            SERVER.apply_monitor_datasite_enrichment([{
                "eventType": "produce_events", "eventId": "300502501",
                "cardName": "【ふいにサマーシャワー】田中摩美々",
                "metadataSource": "shinycolors.moe",
            }], {"state": "complete"})
            saved = SERVER.read_monitor_state()["entries"]["produce_events/300502501"]
        self.assertEqual(saved["cardName"], "【ふいにサマーシャワー】田中摩美々")
        self.assertFalse(saved["unread"])
        self.assertFalse(saved["updateDetectedAt"])
        self.assertEqual(saved["updateKind"], "baseline")

    def test_v4_page_status_false_updates_are_removed_without_moving_recovered_batch(self) -> None:
        state = SERVER.empty_monitor_state()
        state["version"] = 4
        state["entries"] = {
            "produce_events/300301002": {
                "key": "produce_events/300301002", "eventType": "produce_events", "eventId": "300301002",
                "updateKind": "implementation", "implementationChanges": "页游实装状态",
                "updateDetectedAt": "2026-08-13T14:24:16+00:00", "unread": True,
            },
            "produce_events/300502501": {
                "key": "produce_events/300502501", "eventType": "produce_events", "eventId": "300502501",
                "updateKind": "implementation", "implementationChanges": "页游实装状态",
                "updateDetectedAt": "2026-08-13T14:24:16+00:00", "unread": True,
            },
        }
        migrated = SERVER.migrate_monitor_state(state)
        old = migrated["entries"]["produce_events/300301002"]
        recovered = migrated["entries"]["produce_events/300502501"]
        self.assertEqual(migrated["version"], 6)
        self.assertFalse(old["updateDetectedAt"])
        self.assertFalse(old["unread"])
        self.assertEqual(old["updateKind"], "baseline")
        self.assertEqual(recovered["updateDetectedAt"], "2026-08-07T06:00:00+00:00")
        self.assertEqual(recovered["updateKind"], "recovered")
        self.assertFalse(recovered["unread"])

    def test_derived_page_status_does_not_create_an_implementation_update(self) -> None:
        old = {
            "eventType": "produce_events", "eventId": "300502501",
            "updateKind": "recovered", "updateDetectedAt": "2026-08-07T06:00:00+00:00",
            "unread": False, "staticCardStatus": "available",
        }
        merged, changed = SERVER.merge_monitor_entry(
            old, {**old, "pageImplementationStatus": "available"},
            "2026-08-13T14:24:16+00:00", True, True,
        )
        self.assertFalse(changed)
        self.assertEqual(merged["updateDetectedAt"], "2026-08-07T06:00:00+00:00")
        self.assertEqual(merged["updateKind"], "recovered")

    def test_late_card_implementation_updates_the_original_entry_in_place(self) -> None:
        with tempfile.TemporaryDirectory() as folder, patch.object(
            SERVER, "MONITOR_STATE", Path(folder) / "state.json"
        ):
            SERVER.observe_game_updates({
                "entries": [{
                    "eventType": "produce_events", "eventId": "300502501",
                    "scenarioStatus": "available", "metadataStatus": "pending",
                    "staticCardStatus": "pending",
                }],
                "metadata": [],
                "resources": [{
                    "cardType": "Support", "cardId": "3005025",
                    "staticCardStatus": "available",
                    "staticCardPath": "images/content/support_idols/card/3005025.jpg",
                    "staticCardSyncStatus": "synced",
                    "staticCardSaved": "assets/images/content/support_idols/card/3005025.jpg",
                    "dynamicCardStatus": "not-applicable",
                }],
                "assetVersion": "1",
            })
            update = SERVER.observe_game_updates({
                "entries": [{
                    "eventType": "produce_events", "eventId": "300502501",
                    "scenarioStatus": "available", "metadataStatus": "available",
                    "cardType": "Support", "cardId": "3005025", "cardName": "【测试卡】田中摩美美",
                    "storyTitle": "测试剧情",
                }],
                "metadata": [],
                "resources": [],
                "assetVersion": "2",
            })
            row = next(item for item in update["items"] if item["eventId"] == "300502501")
            self.assertFalse(row["unread"])
            self.assertEqual(row["updateKind"], "baseline")
            self.assertFalse(row["updateDetectedAt"])
            self.assertFalse(row["implementationChanges"])
            self.assertEqual(row["staticCardSyncStatus"], "synced")

    def test_preloaded_card_completion_keeps_its_original_log_date(self) -> None:
        old = {
            "eventType": "produce_events", "eventId": "301302801",
            "updateKind": "preload", "updateDetectedAt": "2026-08-07T06:00:00+00:00",
            "implementationChanges": "页游未实装", "unread": False,
            "staticCardStatus": "missing",
        }
        merged, changed = SERVER.merge_monitor_entry(
            old, {**old, "staticCardStatus": "available", "pageImplementationStatus": "available"},
            "2026-08-16T05:06:12+00:00", True, True,
        )
        self.assertFalse(changed)
        self.assertFalse(merged["unread"])
        self.assertEqual(merged["updateDetectedAt"], "2026-08-07T06:00:00+00:00")
        self.assertEqual(merged["updateKind"], "recovered")
        self.assertFalse(merged["implementationChanges"])
        self.assertEqual(merged["staticCardStatus"], "available")

    def test_v5_resource_only_update_migrates_back_to_original_batch(self) -> None:
        state = SERVER.empty_monitor_state()
        state["version"] = 5
        state["entries"] = {
            "produce_events/301302801": {
                "eventType": "produce_events", "eventId": "301302801",
                "updateKind": "implementation",
                "implementationChanges": "页游静态卡图",
                "updateDetectedAt": "2026-08-16T05:06:12+00:00",
                "unread": True, "staticCardStatus": "available",
            },
        }
        migrated = SERVER.migrate_monitor_state(state)
        row = migrated["entries"]["produce_events/301302801"]
        self.assertEqual(migrated["version"], 6)
        self.assertEqual(row["updateDetectedAt"], "2026-08-07T06:00:00+00:00")
        self.assertEqual(row["updateKind"], "recovered")
        self.assertFalse(row["implementationChanges"])
        self.assertFalse(row["unread"])

    def test_preloaded_baseline_card_is_promoted_after_official_resource_audit(self) -> None:
        with tempfile.TemporaryDirectory() as folder, patch.object(
            SERVER, "MONITOR_STATE", Path(folder) / "state.json"
        ):
            SERVER.observe_game_updates({
                "entries": [{
                    "eventType": "produce_events", "eventId": "301302801",
                    "cardType": "Support", "cardId": "2040130150",
                }],
                "metadata": [],
                "resources": [],
                "assetVersion": "preload",
            })
            audited = SERVER.observe_game_updates({
                "entries": [{
                    "eventType": "produce_events", "eventId": "301302801",
                    "cardType": "Support", "cardId": "2040130150",
                }],
                "metadata": [],
                # Any official resource row proves that this observation came
                # from the complete 0.6+ asset inventory. The tested card is
                # intentionally absent and must therefore be marked preloaded.
                "resources": [{
                    "cardType": "Support", "cardId": "2040130140",
                    "staticCardStatus": "available",
                    "staticCardPath": "images/content/support_idols/card/2040130140.jpg",
                    "dynamicCardStatus": "not-applicable",
                }],
                "assetVersion": "preload-audited",
            })
            row = next(item for item in audited["items"] if item["eventId"] == "301302801")
            self.assertTrue(row["unread"])
            self.assertEqual(row["updateKind"], "preload")
            self.assertEqual(row["staticCardStatus"], "missing")
            self.assertEqual(row["implementationChanges"], "页游未实装")
            self.assertTrue(row["implementationAuditAt"])
            self.assertTrue(row["updateDetectedAt"])


if __name__ == "__main__":
    unittest.main()
