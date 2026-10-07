from __future__ import annotations

import importlib.util
import mimetypes
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
USERSCRIPT = ROOT / "scripts" / "ShinyScenarioUpdateMonitor.user.js"
with mock.patch.object(mimetypes.MimeTypes, "read_windows_registry", lambda self: None):
    mimetypes.init(files=[])
sys.path.insert(0, str(ROOT))
SPEC = importlib.util.spec_from_file_location(
    "ssv_server_userscript_delivery", ROOT / "serve-viewer.py"
)
assert SPEC and SPEC.loader
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)


class UserscriptDeliveryTests(unittest.TestCase):
    def test_userscript_source_is_strict_utf8(self) -> None:
        source = USERSCRIPT.read_bytes().decode("utf-8-sig")

        self.assertEqual(source.splitlines()[0], "// ==UserScript==")
        self.assertIn("// @name         Shiny Colors 剧情更新监听器", source)
        self.assertIn("// @version      0.9.2", source)
        self.assertNotIn("targetWindow.Array.prototype.push =", source)
        self.assertNotIn("hookGameApiResponses();", source)
        self.assertNotIn("getCharacterAlbum(Number(", source)

    def test_userscript_static_response_declares_utf8(self) -> None:
        handler = object.__new__(SERVER.ViewerRequestHandler)
        content_type = handler.guess_type(str(USERSCRIPT)).lower()
        media_type, separator, charset = content_type.partition(";")

        self.assertIn(media_type.strip(), {"application/javascript", "text/javascript"})
        self.assertEqual(separator, ";")
        self.assertEqual(charset.strip(), "charset=utf-8")


if __name__ == "__main__":
    unittest.main()
