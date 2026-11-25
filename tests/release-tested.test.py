#!/usr/bin/env python3
"""Refusal and deployment-boundary tests; all external commands are mocked."""
import datetime as dt
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/release-tested.py"
SPEC = importlib.util.spec_from_file_location("release_tested", SCRIPT)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)

SHA = "a" * 40
TREE = "b" * 40
ARCHIVE_HASH = "c" * 64
VALIDATOR_HASH = "d" * 64
NOW = dt.datetime(2026, 10, 29, 16, 0, tzinfo=dt.timezone.utc)


def receipt(system="linux"):
    return {
        "schema_version": 1, "repository": "itspresdavis/RWN-WEB",
        "platform": {"system": system, "machine": "arm64" if system == "darwin" else "x86_64"},
        "provider": "macos" if system == "darwin" else "ubuntu",
        "sha": SHA, "source_tree": TREE, "git_archive_sha256": ARCHIVE_HASH,
        "validator_source_sha256": VALIDATOR_HASH, "status": "passed",
        "finished_at": (NOW - dt.timedelta(minutes=3)).isoformat(),
        "stages": {name: {"status": "passed", "exit_code": 0,
                          "resources": {"platform": system, "affinity_supported": system == "linux",
                                        "cpus": None if system == "darwin" else [0, 2]}}
                   for name in ("install", "check", "touch", "browser", "cross-browser")},
    }


def archive(entries):
    """Build small archives without touching any production source files."""
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w") as output:
        for name, kind, content in entries:
            entry = tarfile.TarInfo(name)
            entry.type = kind
            if kind == tarfile.REGTYPE:
                body = content.encode()
                entry.size = len(body)
                output.addfile(entry, io.BytesIO(body))
            else:
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    entry.linkname = content
                output.addfile(entry)
    return data.getvalue()


class ReceiptTests(unittest.TestCase):
    def verify(self, value):
        return release.verify_receipt(value, SHA, TREE, ARCHIVE_HASH,
                                      VALIDATOR_HASH, now=NOW)

    def test_accepts_complete_matching_recent_receipt(self):
        self.assertTrue(self.verify(receipt()))

    def test_macos_receipt_keeps_platform_and_all_source_requirements(self):
        value = receipt("darwin")
        self.assertTrue(self.verify(value))
        self.assertEqual(release.receipt_provider(value), "macos")
        for field in ("sha", "source_tree", "git_archive_sha256", "validator_source_sha256"):
            wrong = receipt("darwin")
            wrong[field] = "mismatch"
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.verify(wrong)

    def test_missing_unknown_or_mislabeled_platform_is_rejected(self):
        for execution, provider in (
            (None, "ubuntu"), ({"system": "win32", "machine": "x86"}, "ubuntu"),
            ({"system": "darwin", "machine": "arm64"}, "ubuntu"),
            ({"system": "linux", "machine": "x86_64"}, "macos"),
            ({"system": "linux"}, "ubuntu"),
        ):
            value = receipt()
            value.update(platform=execution, provider=provider)
            with self.subTest(execution=execution), self.assertRaises(ValueError):
                self.verify(value)

    def test_mixed_platform_or_fabricated_affinity_cannot_pass(self):
        for system, resources in (
            ("darwin", {"platform": "linux", "affinity_supported": True, "cpus": [0, 2]}),
            ("darwin", {"platform": "darwin", "affinity_supported": False, "cpus": [0, 2]}),
            ("linux", {"platform": "linux", "affinity_supported": False, "cpus": None}),
            ("linux", {"platform": "linux", "affinity_supported": True, "cpus": []}),
        ):
            value = receipt(system)
            value["stages"]["browser"]["resources"] = resources
            with self.subTest(system=system, resources=resources), self.assertRaises(ValueError):
                self.verify(value)

    def test_refuses_missing_each_required_stage(self):
        for stage in ("install", "check", "touch", "browser", "cross-browser"):
            with self.subTest(stage=stage):
                value = receipt()
                del value["stages"][stage]
                with self.assertRaises(ValueError):
                    self.verify(value)

    def test_refuses_no_stages_or_unexpected_stage(self):
        values = [receipt(), receipt(), receipt()]
        del values[0]["stages"]
        values[1]["stages"] = {}
        values[2]["stages"]["extra"] = {"status": "passed", "exit_code": 0}
        for value in values:
            with self.subTest(stages=value.get("stages")):
                with self.assertRaises(ValueError):
                    self.verify(value)

    def test_refuses_failed_skipped_or_nonzero_stage(self):
        failures = [{"status": "failed", "exit_code": 1},
                    {"status": "skipped", "exit_code": 0},
                    {"status": "passed", "exit_code": 1},
                    {"status": "passed"}, {"exit_code": 0}]
        for name in ("install", "check", "touch", "browser", "cross-browser"):
            for failed in failures:
                with self.subTest(stage=name, result=failed):
                    value = receipt()
                    value["stages"][name] = failed
                    with self.assertRaises(ValueError):
                        self.verify(value)

    def test_refuses_failed_top_level_status(self):
        for status in ("failed", "running", "skipped", None):
            with self.subTest(status=status):
                value = receipt()
                value["status"] = status
                with self.assertRaises(ValueError):
                    self.verify(value)

    def test_refuses_wrong_or_missing_identity_and_hashes(self):
        for field, wrong in {
            "schema_version": 2, "repository": "iamhuvr/another-repo",
            "sha": "e" * 40, "source_tree": "f" * 40,
            "git_archive_sha256": "0" * 64,
            "validator_source_sha256": "1" * 64,
        }.items():
            for missing in (False, True):
                with self.subTest(field=field, missing=missing):
                    value = receipt()
                    if missing:
                        del value[field]
                    else:
                        value[field] = wrong
                    with self.assertRaises(ValueError):
                        self.verify(value)

    def test_refuses_future_receipt(self):
        value = receipt()
        value["finished_at"] = (NOW + dt.timedelta(seconds=1)).isoformat()
        with self.assertRaises(ValueError):
            self.verify(value)

    def test_refuses_receipt_older_than_twenty_four_hours(self):
        value = receipt()
        value["finished_at"] = (NOW - dt.timedelta(days=1, seconds=1)).isoformat()
        with self.assertRaises(ValueError):
            self.verify(value)

    def test_accepts_age_boundary_and_equivalent_timezone(self):
        for finished in (NOW, NOW-dt.timedelta(days=1),
                         NOW.astimezone(dt.timezone(dt.timedelta(hours=-4)))):
            with self.subTest(finished=finished):
                value = receipt()
                value["finished_at"] = finished.isoformat()
                self.assertTrue(self.verify(value))

    def test_refuses_naive_or_invalid_timestamp(self):
        for timestamp in ("2026-10-29T15:59:00", "not-a-timestamp"):
            with self.subTest(timestamp=timestamp):
                value = receipt()
                value["finished_at"] = timestamp
                with self.assertRaises(ValueError):
                    self.verify(value)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="rwn-release-export-")
        self.addCleanup(self.temp.cleanup)
        self.destination = Path(self.temp.name) / "source"
        self.destination.mkdir()

    def test_exports_original_source_bytes_and_example_environment(self):
        release.export_source(archive([
            ("src", tarfile.DIRTYPE, ""),
            ("src/main.js", tarfile.REGTYPE, "export const tested = true;\n"),
            (".env.example", tarfile.REGTYPE, "PUBLIC_URL=\n"),
        ]), self.destination)
        self.assertEqual((self.destination / "src/main.js").read_bytes(),
                         b"export const tested = true;\n")
        self.assertTrue((self.destination / ".env.example").is_file())

    def test_refuses_traversal_or_absolute_archive_paths(self):
        for name in ("../outside", "src/../../outside", "/tmp/rwn-unsafe",
                     "src/../outside"):
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    release.export_source(archive([(name, tarfile.REGTYPE, "bad")]),
                                          self.destination)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_refuses_symlinks_hardlinks_and_special_files(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE,
                     tarfile.CHRTYPE, tarfile.BLKTYPE):
            with self.subTest(kind=kind):
                with self.assertRaises(ValueError):
                    release.export_source(archive([("unsafe", kind, "../outside")]),
                                          self.destination)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_refuses_tracked_environment_files_in_any_directory(self):
        for name in (".env", ".env.local", ".env.production", "src/.env",
                     "src/.env.staging", ".env.example.local"):
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    release.export_source(archive([(name, tarfile.REGTYPE, "secret")]),
                                          self.destination)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_validates_whole_archive_before_extracting_any_source(self):
        data = archive([("safe.txt", tarfile.REGTYPE, "safe"),
                        (".env.local", tarfile.REGTYPE, "secret")])
        with self.assertRaises(ValueError):
            release.export_source(data, self.destination)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_omits_generated_output_dependencies_and_local_vercel_link(self):
        entries = [(name, tarfile.REGTYPE, "omit") for name in (
            "node_modules/package/index.js", "dist/index.html",
            ".vercel/project.json", "qa-screenshots/private.png")]
        entries.append(("package.json", tarfile.REGTYPE, "{}"))
        release.export_source(archive(entries), self.destination)
        self.assertEqual([item.name for item in self.destination.iterdir()], ["package.json"])


class ProjectTests(unittest.TestCase):
    def test_accepts_only_rwn_project_in_anlos(self):
        release.verify_project({"id": "prj_504G7M2lhnU5NlmfSAEyY4UdA4DX", "name": "rwn-web",
                                "owner": {"slug": "anlos"}})

    def test_refuses_wrong_project_id_name_or_team(self):
        good = {"id": "prj_504G7M2lhnU5NlmfSAEyY4UdA4DX", "name": "rwn-web", "owner": {"slug": "anlos"}}
        cases = [{}, {**good, "id": "prj_another"}, {**good, "name": "other"},
                 {**good, "owner": {"slug": "another-team"}}, {**good, "owner": {}}]
        for project in cases:
            with self.subTest(project=project):
                with self.assertRaises(ValueError):
                    release.verify_project(project)


class DeploymentBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="rwn-release-boundary-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        self.validator = b"# trusted test validator\n"
        (self.root / "scripts/ubuntu-quality.py").write_bytes(self.validator)
        self.data = archive([("package.json", tarfile.REGTYPE, "{}")])
        self.receipt = receipt()
        self.receipt.update({
            "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "git_archive_sha256": hashlib.sha256(self.data).hexdigest(),
            "validator_source_sha256": hashlib.sha256(self.validator).hexdigest(),
        })
        self.receipt_path = self.root / "passed.json"
        self.project = {"id": "prj_504G7M2lhnU5NlmfSAEyY4UdA4DX", "name": "rwn-web", "owner": {"slug": "anlos"}}
        self.commands = []

    def fake_git(self, *args):
        if args[:2] == ("remote", "get-url"):
            return b"git@github.com:itspresdavis/RWN-WEB.git\n"
        if args[0] == "archive":
            return self.data
        if args[-1] == SHA + "^{tree}":
            return TREE.encode()
        return SHA.encode()

    def fake_deploy(self, argv, **kwargs):
        if '--provider' in argv:
            self.assertEqual(argv[argv.index('--provider')+1], 'github')
            Path(argv[argv.index('--output')+1]).write_text(json.dumps({"status":"passed","sha":SHA,"provider":"github"}))
            return subprocess.CompletedProcess(argv, 0)
        self.commands.append(argv)
        if "stdout" in kwargs:
            kwargs["stdout"].write(b'{"url":"mocked.invalid"}')
        return subprocess.CompletedProcess(argv, 0)

    def execute(self, *flags):
        self.receipt_path.write_text(json.dumps(self.receipt))
        with mock.patch.object(release, "ROOT", self.root), \
             mock.patch.object(release, "git", side_effect=self.fake_git), \
             mock.patch.object(release, "run", return_value=subprocess.CompletedProcess(
                 [], 0, stdout=json.dumps(self.project).encode())), \
             mock.patch.object(release.subprocess, "run", side_effect=self.fake_deploy), \
             mock.patch.object(release.pathlib.Path, "home", return_value=self.root), \
             mock.patch.object(sys, "argv", [str(SCRIPT), "--receipt", str(self.receipt_path), *flags]), \
             mock.patch("sys.stdout", new=io.StringIO()), \
             mock.patch("sys.stderr", new=io.StringIO()):
            return release.main()

    def test_preview_deploy_uses_verified_archive_and_exact_project(self):
        self.assertEqual(self.execute(), 0)
        self.assertEqual(len(self.commands), 1)
        argv = self.commands[0]
        self.assertEqual(argv[:2], ["vercel", "deploy"])
        self.assertEqual(argv[argv.index("--scope")+1], "anlos")
        self.assertEqual(argv[argv.index("--project")+1], "prj_504G7M2lhnU5NlmfSAEyY4UdA4DX")
        self.assertIn("rwnTestedSha=" + SHA, argv)
        self.assertNotIn("--prod", argv)
        self.assertNotIn("promote", argv)
        self.assertEqual((Path(argv[2]) / "package.json").read_text(), "{}")

    def test_historical_macos_receipt_cannot_replace_native_github_qualification(self):
        darwin = receipt("darwin")
        darwin.update({key: self.receipt[key] for key in (
            "finished_at", "git_archive_sha256", "validator_source_sha256")})
        self.receipt = darwin
        self.assertEqual(self.execute("--dry-run"), 0)
        self.assertIn("rwnQualityProvider=github", self.commands[0])
        self.assertNotIn("rwnQualityProvider=ubuntu", self.commands[0])

    def test_production_stage_always_skips_domain_assignment(self):
        self.assertEqual(self.execute("--target", "production-stage"), 0)
        argv = self.commands[0]
        self.assertIn("--prod", argv)
        self.assertIn("--skip-domain", argv)
        self.assertNotIn("promote", argv)
        self.assertEqual(len(self.commands), 1)

    def test_dry_run_passes_cli_dry_flag(self):
        self.assertEqual(self.execute("--dry-run"), 0)
        self.assertIn("--dry", self.commands[0])
        self.assertNotIn("--verify", self.commands[0])

    def test_bad_receipt_never_runs_deployment(self):
        self.receipt["stages"]["browser"]["exit_code"] = 1
        with self.assertRaises(ValueError):
            self.execute()
        self.assertEqual(self.commands, [])

    def test_wrong_vercel_project_never_runs_deployment(self):
        self.project["id"] = "prj_another"
        with self.assertRaises(ValueError):
            self.execute()
        self.assertEqual(self.commands, [])


if __name__ == "__main__":
    unittest.main()
