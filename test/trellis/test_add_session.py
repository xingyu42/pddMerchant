"""Regression checks for the workspace recorder. Run with Python unittest."""

import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".trellis/scripts"))
import add_session as recorder
from common.developer import init_developer


class RecorderTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.addCleanup(os.chdir, Path.cwd())
        os.chdir(tmp.name)
        self.root = Path.cwd()
        self.git("init", "-q")
        (self.root / ".trellis").mkdir()
        self.log = io.StringIO()
        with contextlib.redirect_stdout(self.log):
            init_developer("tester", self.root)
        workspace = self.root / ".trellis/workspace/tester"
        self.journal = workspace / "journal-1.md"
        self.index = workspace / "index.md"

    def git(self, *args):
        subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                        "-c", "commit.gpgSign=false", *args], check=True, capture_output=True)

    def record(self, title="Demo", summary="summary", **kwargs):
        with contextlib.redirect_stdout(self.log), contextlib.redirect_stderr(self.log):
            return recorder.add_session(title=title, summary=summary, commit="-",
                                        auto_commit=False, **kwargs)

    def files(self):
        return self.journal.read_bytes(), self.index.read_bytes()

    def test_pending_v2_generation_is_resumed_after_upgrade(self):
        topic = ".trellis/research/demo.md"
        path = self.root / topic
        path.parent.mkdir()
        path.write_text("topic", encoding="utf-8")
        # Frozen v2 wire format, independent of the current marker generator.
        payload = dict(developer="tester", title="Demo",
                       summary=f"summary Topics: [{topic}]({topic})", package="", branch="",
                       commits=[], changes=[], extra="", tests=[], next_steps=[], idempotency_key="")
        for generation in range(2):
            self.assertEqual(self.record(topic_paths=[topic]), 0, self.log.getvalue())
            if generation:
                payload["generation"] = generation
            digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]
            journal = self.journal.read_text(encoding="utf-8")
            pos = journal.rindex("<!-- trellis-session:")
            self.journal.write_text(journal[:pos] + f"<!-- trellis-session: v=2 fp={digest} -->"
                                    + journal[journal.index(" -->", pos) + 4:], encoding="utf-8")
            if not generation:
                self.git("add", ".trellis/workspace")
                self.git("commit", "-qm", "first generation")
        before = self.files()
        self.assertEqual(self.record(topic_paths=[topic]), 0, self.log.getvalue())
        self.assertEqual(self.files(), before)
        self.git("add", ".trellis/workspace")
        self.git("commit", "-qm", "second generation")
        self.assertEqual(self.record(topic_paths=[topic]), 0, self.log.getvalue())
        self.assertIn("## Session 3:", self.journal.read_text(encoding="utf-8"))
        self.assertIn("v=3", self.journal.read_text(encoding="utf-8"))
        before = self.files()
        self.assertEqual(self.record(topic_paths=[topic]), 0, self.log.getvalue())
        self.assertEqual(self.files(), before)

    def test_legacy_literal_pipe_row_is_reused_and_conflicts_still_fail(self):
        title = "UI | CLI"
        self.assertEqual(self.record(title), 0)
        text = self.index.read_text(encoding="utf-8")
        self.assertIn(r"UI \| CLI", text)
        self.index.write_text(text.replace(r"UI \| CLI", title), encoding="utf-8")
        before = self.files()
        self.assertEqual(self.record(title), 0, self.log.getvalue())
        self.assertEqual(self.files(), before)
        legacy_text = self.index.read_text(encoding="utf-8")
        self.index.write_text(legacy_text.replace("**Total Sessions**: 1", "**Total Sessions**: 0"),
                              encoding="utf-8")
        self.assertEqual(self.record(title), 0, self.log.getvalue())
        self.assertEqual(self.files(), before)
        self.index.write_text(text.replace(r"UI \| CLI", "Other | CLI"), encoding="utf-8")
        before = self.files()
        self.assertEqual(self.record(title), 1)
        self.assertEqual(self.files(), before)

    def test_fenced_examples_do_not_affect_retry_or_next_number(self):
        summary = "Example:\n````markdown\n## Session 1: demo\n```\n## Session 999: demo\n````"
        self.assertEqual(self.record(summary=summary), 0)
        before = self.files()
        self.assertEqual(self.record(summary=summary), 0, self.log.getvalue())
        self.assertEqual(self.files(), before)
        self.git("add", ".trellis/workspace")
        self.git("commit", "-qm", "document journal headings")
        self.assertEqual(self.record("Next"), 0, self.log.getvalue())
        self.assertIn("| 2 |", self.index.read_text(encoding="utf-8"))

    def test_real_duplicate_still_blocks_writes(self):
        self.assertEqual(self.record(), 0)
        with self.journal.open("a", encoding="utf-8") as journal:
            journal.write("\n## Session 1: historical entry\n\n**Date**: 2025-01-01\n")
        before = self.files()
        self.assertEqual(self.record("Next"), 1)
        self.assertEqual(self.files(), before)
