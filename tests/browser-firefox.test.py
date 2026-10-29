"""Geometry fixtures protect the Firefox failure that overflow-only checks miss."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace
import io
import tempfile

spec = importlib.util.spec_from_file_location("browser_firefox", Path(__file__).resolve().parents[1] / "scripts/browser-firefox.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class FallbackGeometryTests(unittest.TestCase):
    def test_live_desktop_implicit_track_fails_despite_no_overflow(self):
        state = {"width": 1440, "scrollWidth": 1428, "fallbackVisible": True,
                 "sidebar": {"x": 330, "width": 60.07, "bottom": 1704.4},
                 "stage": {"x": 436.13, "y": 130, "width": 661.87},
                 "search": {"width": 4}}
        checks = runner.geometry_checks(state)
        self.assertTrue(checks["no_horizontal_overflow"])
        self.assertFalse(checks["no_overlap"])
        self.assertFalse(checks["search_usable"])
        self.assertFalse(all(checks.values()))

    def test_fixed_desktop_and_narrow_mobile_are_usable(self):
        for viewport, x, width, bottom, stage_y, input_width in (
            (1440, 330, 768, 767.75, 813.82, 668.72),
            (320, 12.8, 282.4, 736.98, 752.98, 197.52),
        ):
            with self.subTest(viewport=viewport):
                state = {"width": viewport, "scrollWidth": viewport - 12, "fallbackVisible": True,
                         "sidebar": {"x": x, "width": width, "bottom": bottom},
                         "stage": {"x": x, "y": stage_y, "width": width},
                         "search": {"width": input_width}}
                self.assertTrue(all(runner.geometry_checks(state).values()))


class CleanupTests(unittest.TestCase):
    def test_evidence_write_and_socket_close_failures_do_not_leak_owned_resources(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            audit = runner.FirefoxAudit(SimpleNamespace(), output)
            audit.session = "owned-session"
            audit.wd = Mock()
            audit.bidi = SimpleNamespace(events=[], close=Mock(side_effect=OSError("socket close failed")))
            audit.driver = SimpleNamespace(pid=12345, wait=Mock(return_value=0))
            audit.log = io.BytesIO()
            audit.profile = output / "private-profile"
            audit.profile.mkdir()
            with patch.object(runner, "atomic_json", side_effect=OSError("disk full")), patch.object(runner.os, "killpg") as kill:
                with self.assertRaisesRegex(RuntimeError, "disk full.*socket close failed"):
                    audit.cleanup()
            audit.wd.assert_called_once_with("DELETE", "")
            audit.bidi.close.assert_called_once()
            kill.assert_called_once_with(12345, runner.signal.SIGTERM)
            audit.driver.wait.assert_called_once_with(timeout=8)
            self.assertTrue(audit.log.closed)
            self.assertFalse(audit.profile.exists())


if __name__ == "__main__":
    unittest.main()
