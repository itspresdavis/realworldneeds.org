#!/usr/bin/env python3
"""Focused safety and gate-order tests for the isolated Ubuntu validator."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/ubuntu-quality.py"
SPEC = importlib.util.spec_from_file_location("ubuntu_quality", SCRIPT)
quality = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(quality)


class QualityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="rwn-quality-unit-")
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def gates(self, failed=None, receipt=None):
        calls = []
        receipt = receipt if receipt is not None else {"stages": {}}
        def runner(name, argv, cwd, env, log, timeout):
            calls.append(name)
            status = "failed" if name == failed else "passed"
            return {"name": name, "status": status, "exit_code": 1 if name == failed else 0}
        with mock.patch("sys.stderr", new=io.StringIO()):
            result = quality.execute_gates(
                self.root, {}, self.root, receipt, lambda: None, runner=runner,
            )
        return result, calls, receipt

    def test_failed_check_skips_all_browser_gates(self):
        result, calls, receipt = self.gates(failed="check")
        self.assertEqual(result, "failed")
        self.assertEqual(calls, ["install", "check"])
        self.assertEqual(receipt["stages"]["touch"]["status"], "skipped")
        self.assertEqual(receipt["stages"]["browser"]["status"], "skipped")

    def test_touch_failure_still_runs_browser_suite_and_cannot_pass(self):
        result, calls, receipt = self.gates(failed="touch")
        self.assertEqual(calls, ["install", "check", "touch", "browser"])
        self.assertEqual(receipt["stages"]["browser"]["status"], "passed")
        self.assertEqual(result, "failed")

    def test_old_success_cannot_survive_install_failure(self):
        old = {"stages": {name: {"status": "passed", "exit_code": 0} for name, _, _ in quality.STAGES}}
        result, calls, receipt = self.gates(failed="install", receipt=old)
        self.assertEqual(result, "failed")
        self.assertEqual(calls, ["install"])
        self.assertTrue(all(receipt["stages"][name]["status"] == "skipped"
                            for name in ("check", "touch", "browser")))

    def test_all_four_gates_are_required_for_pass(self):
        result, calls, receipt = self.gates()
        self.assertEqual(result, "passed")
        self.assertEqual(len(calls), 4)
        self.assertTrue(all(stage["exit_code"] == 0 for stage in receipt["stages"].values()))

    def test_pass_requires_zero_exit_code(self):
        self.assertFalse(quality.stage_passed({"status": "passed", "exit_code": 1}))
        self.assertFalse(quality.stage_passed({"status": "passed"}))
        self.assertFalse(quality.stage_passed({"status": "running", "exit_code": 0}))
        self.assertTrue(quality.stage_passed({"status": "passed", "exit_code": 0}))

    def test_occupied_browser_port_fails_without_launching_process(self):
        with quality.socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            with self.assertRaisesRegex(RuntimeError, "existing processes were preserved"):
                quality.ensure_ports_available([port])
            with mock.patch.dict(quality.BROWSER_PORTS, {"touch": (port,)}), mock.patch.object(quality.subprocess, "Popen") as process:
                result = quality.run_stage("touch", ["node"], self.root, {}, self.root / "port.log", 1)
            process.assert_not_called()
            self.assertEqual(result["status"], "error")
            self.assertIn(str(port), (self.root / "port.log").read_text())
            self.assertGreaterEqual(listener.fileno(), 0)

    def test_build_cpu_selection_skips_hyperthread_siblings(self):
        topology = {0: (0, 0), 1: (0, 0), 2: (0, 1), 3: (0, 1)}
        self.assertEqual(quality.select_build_cpus([3, 1, 2, 0], topology.__getitem__),
                         ([0, 2], "distinct-physical-cores"))
        # Matching core IDs on separate physical packages are different cores.
        self.assertEqual(quality.select_build_cpus([0, 4], lambda cpu: (cpu // 4, 0)),
                         ([0, 4], "distinct-physical-cores"))

    def test_build_cpu_selection_falls_back_only_within_allowed_affinity(self):
        def unavailable(cpu):
            raise OSError("topology unavailable")
        self.assertEqual(quality.select_build_cpus([7, 3, 5], unavailable),
                         ([3, 5], "logical-fallback-topology-unavailable"))
        self.assertEqual(quality.select_build_cpus([5], lambda cpu: (0, 1)),
                         ([5], "distinct-physical-cores"))

    def test_browser_policy_has_full_affinity_without_niceness_penalty(self):
        with mock.patch.object(quality.os, "sched_getaffinity", return_value=set(range(8))), \
             mock.patch.object(quality.os, "getpriority", return_value=0):
            policy = quality.stage_resource_policy("browser", mock.Mock(side_effect=AssertionError))
        self.assertEqual(policy["cpus"], list(range(8)))
        self.assertEqual(policy["nice_increment"], 0)
        self.assertEqual(policy["expected_nice"], 0)
        with mock.patch.object(quality.os, "nice") as nice, \
             mock.patch.object(quality.os, "sched_setaffinity") as affinity:
            quality.child_limits(policy)
        nice.assert_not_called()
        affinity.assert_called_once_with(0, list(range(8)))

    def test_check_policy_uses_two_physical_cores_and_lower_priority(self):
        with mock.patch.object(quality.os, "sched_getaffinity", return_value=set(range(8))), \
             mock.patch.object(quality.os, "getpriority", return_value=0):
            policy = quality.stage_resource_policy("check", lambda cpu: (0, cpu // 2))
        self.assertEqual(policy["cpus"], [0, 2])
        self.assertEqual(policy["nice_increment"], 10)
        self.assertEqual(policy["expected_nice"], 10)

    def test_timeout_fails_and_reaps_process(self):
        start = time.monotonic()
        result = quality.run_stage(
            "timeout", [sys.executable, "-c", "import time; time.sleep(30)"],
            self.root, quality.clean_environment(self.root / "home"),
            self.root / "timeout.log", 0.15,
        )
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["detail"], "timeout")
        self.assertNotEqual(result["exit_code"], 0)
        self.assertLess(time.monotonic() - start, 7)
        self.assertEqual(len(result["log_sha256"]), 64)

    def test_interruption_is_propagated_after_child_cleanup(self):
        fake = mock.Mock()
        fake.pid = 123456
        fake.wait.side_effect = quality.Interrupted(15)
        with mock.patch.object(quality.subprocess, "Popen", return_value=fake), \
             mock.patch.object(quality, "stop_process") as stop:
            with self.assertRaises(quality.Interrupted):
                quality.run_stage("signal", ["node"], self.root, {}, self.root / "signal.log", 1)
        stop.assert_called_with(fake)

    def test_environment_scrubs_tokens_and_uses_ephemeral_home(self):
        with mock.patch.dict(os.environ, {
            "PATH": "/usr/bin:/bin", "GH_TOKEN": "secret",
            "SUPABASE_SERVICE_ROLE_KEY": "private", "NODE_OPTIONS": "--require=bad",
            "NPM_TOKEN": "private", "HOME": "/original", "LANG": "C.UTF-8",
        }, clear=True):
            env = quality.clean_environment(self.root / "home")
        for key in ("GH_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "NODE_OPTIONS", "NPM_TOKEN"):
            self.assertNotIn(key, env)
        self.assertEqual(env["HOME"], str(self.root / "home"))
        self.assertNotEqual(env["NPM_CONFIG_USERCONFIG"], env["NPM_CONFIG_GLOBALCONFIG"])
        self.assertEqual(Path(env["NPM_CONFIG_USERCONFIG"]).read_text(), "")
        self.assertEqual(Path(env["NPM_CONFIG_GLOBALCONFIG"]).read_text(), "")
        self.assertEqual(env["CHROME_PATH"], "/usr/bin/google-chrome")

    def test_short_runtime_tmpdir_is_independent_of_retained_home(self):
        with tempfile.TemporaryDirectory(prefix="rwn-q-", dir="/tmp") as runtime_tmp:
            home = self.root / ("retained-evidence-" * 8) / "home"
            env = quality.clean_environment(home, temp_root=runtime_tmp)
            self.assertEqual(env["HOME"], str(home))
            self.assertEqual(env["TMPDIR"], runtime_tmp)
            self.assertLess(len(runtime_tmp.encode()), 40)
            self.assertEqual(Path(runtime_tmp).stat().st_mode & 0o777, 0o700)

    def test_npm_accepts_scrubbed_environment(self):
        env = quality.clean_environment(self.root / "home")
        result = subprocess.run(["npm", "--version"], env=env, text=True,
                                capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stdout.strip(), r"^\d+\.\d+\.\d+$")

    def test_optional_tooling_checks_are_ordered_and_fail_closed(self):
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        trace = self.root / "trace.log"
        for name in ("npm", "python3"):
            executable = bin_dir / name
            executable.write_text('#!/bin/sh\nprintf "%s %s\\n" "' + name + '" "$*" >> "$TRACE"\n'
                                  'if [ "$*" = "$FAIL_TEST" ]; then exit 7; fi\n')
            executable.chmod(0o700)
        env = dict(os.environ, PATH=str(bin_dir) + ":/usr/bin:/bin", TRACE=str(trace), FAIL_TEST="")
        argv = quality.STAGES[1][1]
        # Older candidates have no tooling tests and still run the original check.
        result = subprocess.run(argv, cwd=self.root, env=env, capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(trace.read_text().splitlines(), ["npm run check"])
        trace.unlink()
        (self.root / "tests").mkdir()
        names = ["ubuntu-quality.test.py", "quality-backend.test.py", "release-tested.test.py"]
        for name in names:
            (self.root / "tests" / name).touch()
        result = subprocess.run(argv, cwd=self.root, env=env, capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(trace.read_text().splitlines(),
                         ["python3 tests/" + name for name in names] + ["npm run check"])
        trace.unlink()
        env["FAIL_TEST"] = "tests/quality-backend.test.py"
        result = subprocess.run(argv, cwd=self.root, env=env, capture_output=True)
        self.assertEqual(result.returncode, 7)
        self.assertEqual(trace.read_text().splitlines(),
                         ["python3 tests/" + name for name in names[:2]])

    def test_ref_rejects_options_and_wrong_repository(self):
        with mock.patch.object(quality, "git_output") as git:
            with self.assertRaises(ValueError):
                quality.resolve_ref(self.root, "--all", {})
            git.assert_not_called()
        with mock.patch.object(quality, "git_output", return_value="https://github.com/other/project.git"):
            with self.assertRaisesRegex(ValueError, "origin"):
                quality.resolve_ref(self.root, "HEAD", {})

    def test_ref_uses_immutable_commit_and_option_terminator(self):
        sha = "a" * 40
        with mock.patch.object(quality, "git_output", side_effect=[
            "https://github.com/iamhuvr/RWN-WEB.git", str(self.root), sha,
        ]) as git:
            self.assertEqual(quality.resolve_ref(self.root, "main", {}), sha)
        self.assertEqual(git.call_args.args[-4:], ("rev-parse", "--verify", "--end-of-options", "main^{commit}"))

    def test_archive_member_rejects_traversal_links_and_generated(self):
        for name in ("../../bad", "/absolute"):
            with self.assertRaises(ValueError):
                quality.allowed_member(tarfile.TarInfo(name))
        link = tarfile.TarInfo("link")
        link.type = tarfile.SYMTYPE
        link.linkname = "/outside"
        with self.assertRaises(ValueError):
            quality.allowed_member(link)
        for name in ("node_modules/pkg/file.js", "dist/index.html", ".env.local",
                     "qa-screenshots/old.png", ".vercel/project.json"):
            self.assertFalse(quality.allowed_member(tarfile.TarInfo(name)))
        self.assertTrue(quality.allowed_member(tarfile.TarInfo("src/app.js")))

    def test_export_filters_tracked_output_and_preserves_archive_provenance(self):
        repo = self.root / "repo"
        repo.mkdir()
        env = quality.clean_environment(self.root / "home")
        def git(*args):
            return subprocess.run(["git", *args], cwd=repo, env=env, check=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
        git("init", "--quiet")
        for name in ("src/app.js", "node_modules/library.js", "dist/index.html", ".env.local",
                     ".env.example", "qa-screenshots/old.png", ".vercel/project.json"):
            path = repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(name + "\n")
        git("add", "-f", ".")
        git("-c", "user.name=Validator Test", "-c", "user.email=validator@example.invalid",
            "-c", "commit.gpgsign=false", "commit", "-qm", "fixture")
        sha = git("rev-parse", "HEAD").decode().strip()
        archive = self.root / "source.tar"
        workspace = self.root / "workspace"
        result = quality.export_source(repo, sha, archive, workspace, env)
        self.assertTrue((workspace / "src/app.js").is_file())
        self.assertTrue((workspace / ".env.example").is_file())
        self.assertFalse((workspace / "node_modules").exists())
        self.assertFalse((workspace / "dist").exists())
        self.assertFalse((workspace / ".env.local").exists())
        self.assertFalse((workspace / "qa-screenshots").exists())
        self.assertFalse((workspace / ".vercel").exists())
        raw = git("archive", "--format=tar", sha)
        self.assertEqual(result["git_archive_sha256"], quality.hashlib.sha256(raw).hexdigest())
        self.assertGreater(result["excluded_archive_members"], 0)

    def test_atomic_receipt_overwrites_stale_success(self):
        path = self.root / "receipt.json"
        quality.atomic_json(path, {"status": "passed", "sha": "old"})
        quality.atomic_json(path, {"status": "running", "sha": "new"})
        self.assertEqual(json.loads(path.read_text()), {"status": "running", "sha": "new"})
        self.assertFalse(path.with_name("receipt.json.tmp").exists())


if __name__ == "__main__":
    unittest.main()
