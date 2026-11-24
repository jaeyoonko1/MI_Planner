"""Regression checks for the published project-flow artifact."""

from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.build_flow_site import build_site


ROOT = Path(__file__).resolve().parents[1]


class BuildFlowSiteTests(unittest.TestCase):
    def test_publishes_only_flow_with_commit_metadata(self) -> None:
        with TemporaryDirectory() as directory:
            output = Path(directory) / "public"
            build_site(
                ROOT / "project_flow.html", output,
                sha="ab12cd34ef56",
                subject="[P4-04] 현황판 + <테스트>",
                repo="jaeyoonko1/MI_Planner",
                deployed_at=datetime(2026, 11, 24, 1, 0, tzinfo=timezone.utc),
            )
            self.assertEqual(
                sorted(p.name for p in output.iterdir()),
                ["index.html", "process_flow.html", "project_flow.html"],
            )
            html = (output / "index.html").read_text(encoding="utf-8")
            self.assertIn("const FLOW = {", html)
            self.assertIn("2026-11-24 10:00 KST", html)
            self.assertIn("[P4-04] 현황판 + &lt;테스트&gt;", html)
            self.assertIn("https://github.com/jaeyoonko1/MI_Planner/commit/ab12cd34ef56", html)
            self.assertNotIn("<테스트>", html)

    def test_rejects_unexpected_template(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "broken.html"
            source.write_text("<html></html>", encoding="utf-8")
            with self.assertRaises(ValueError):
                build_site(source, root / "public", sha="", subject="", repo="",
                           deployed_at=datetime.now(timezone.utc))

    def test_untrusted_commit_metadata_is_escaped(self) -> None:
        with TemporaryDirectory() as directory:
            output = Path(directory) / "public"
            build_site(ROOT / "project_flow.html", output,
                       sha='abc"><script>alert(1)</script>',
                       subject='"/><script>alert(2)</script>', repo="bad/repo/name",
                       deployed_at=datetime.now(timezone.utc))
            html = (output / "index.html").read_text(encoding="utf-8")
            self.assertNotIn("alert(1)", html)
            self.assertIn("&lt;script&gt;alert(2)&lt;/script&gt;", html)


if __name__ == "__main__":
    unittest.main()
