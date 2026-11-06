#!/usr/bin/env python3
"""Focused safety, platform and gate-order tests for the isolated validator."""
import importlib.util
import io
import json
import os
import re
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
        self.assertEqual(calls, ["install", "check", "touch", "browser", "cross-browser"])
        self.assertEqual(receipt["stages"]["browser"]["status"], "passed")
        self.assertEqual(result, "failed")

    def test_old_success_cannot_survive_install_failure(self):
        old = {"stages": {name: {"status": "passed", "exit_code": 0} for name, _, _ in quality.STAGES}}
        result, calls, receipt = self.gates(failed="install", receipt=old)
        self.assertEqual(result, "failed")
        self.assertEqual(calls, ["install"])
        self.assertTrue(all(receipt["stages"][name]["status"] == "skipped"
                            for name in ("check", "touch", "browser", "cross-browser")))

    def test_all_five_gates_are_required_for_pass(self):
        result, calls, receipt = self.gates()
        self.assertEqual(result, "passed")
        self.assertEqual(len(calls), 5)
        self.assertTrue(all(stage["exit_code"] == 0 for stage in receipt["stages"].values()))

    def test_cross_browser_failure_prevents_pass_even_when_legacy_gates_pass(self):
        result, calls, receipt = self.gates(failed="cross-browser")
        self.assertEqual(result, "failed")
        self.assertEqual(calls[-1], "cross-browser")
        self.assertTrue(all(receipt["stages"][stage]["status"] == "passed"
                            for stage in ("install", "check", "touch", "browser")))

    def test_cross_browser_runs_for_evidence_after_legacy_browser_failure(self):
        result, calls, receipt = self.gates(failed="browser")
        self.assertEqual(result, "failed")
        self.assertEqual(receipt["stages"]["cross-browser"]["status"], "passed")

    def test_nested_browser_evidence_is_hashed_without_following_links(self):
        folder = self.root / "test-results" / "search-webkit"
        folder.mkdir(parents=True)
        image = folder / "failed.png"
        image.write_bytes(b"test screenshot fixture")
        (folder / "private-link.json").symlink_to(image)
        evidence = quality.collect_artifacts(self.root)
        self.assertEqual(len(evidence), 1)
        self.assertEqual(evidence[0]["path"], str(image))
        self.assertEqual(evidence[0]["sha256"], quality.digest(image))

    def test_browser_library_override_is_explicit_and_scoped_to_browser_stage(self):
        env = {"PATH": "/bin", "LD_LIBRARY_PATH": "/inherited", "RWN_QA_BROWSER_LIBRARY_PATH": "/selected"}
        for name in ("install", "check", "touch", "browser"):
            selected, _ = quality.stage_environment(name, env)
            self.assertNotIn("LD_LIBRARY_PATH", selected)
            self.assertNotIn("RWN_QA_BROWSER_LIBRARY_PATH", selected)
        self.assertEqual(quality.stage_environment("cross-browser", env)[0]["LD_LIBRARY_PATH"], "/selected")
        self.assertEqual(env["LD_LIBRARY_PATH"], "/inherited")

    def test_browser_library_manifest_tracks_bytes_and_rejects_escaping_links(self):
        folder = self.root / "libs"
        folder.mkdir()
        library = folder / "libtest.so.1"
        library.write_bytes(b"library fixture")
        (folder / "libtest.so").symlink_to(library.name)
        manifest = quality.browser_library_manifest(folder)
        self.assertEqual(len(manifest["files"]), 2)
        library.write_bytes(b"changed library fixture")
        self.assertNotEqual(quality.browser_library_manifest(folder), manifest)
        external = self.root / "outside.so"
        external.write_bytes(b"outside")
        (folder / "escape.so").symlink_to(external)
        with self.assertRaisesRegex(ValueError, "escapes"):
            quality.browser_library_manifest(folder)

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

    def test_preflight_matches_exact_ports_used_by_each_browser_stage(self):
        root = SCRIPT.parents[1]
        package = json.loads((root / "package.json").read_text())
        browser_scripts = [command.split()[1] for command in
                           package["scripts"]["test:browser:qa"].split(" && ")]
        for stage, paths in (("touch", ["scripts/browser-globe-touch-v4.mjs"]),
                             ("browser", browser_scripts)):
            expected = set()
            for path in paths:
                declarations = "\n".join((root / path).read_text().splitlines()[:40])
                expected.update(map(int, re.findall(r"http://127\.0\.0\.1:(\d+)", declarations)))
                expected.update(map(int, re.findall(r"const [A-Z_]*PORT = (\d+);", declarations)))
            self.assertTrue(expected)
            self.assertEqual(set(quality.BROWSER_PORTS[stage]), expected)
        self.assertEqual(quality.BROWSER_PORTS["cross-browser"], (4199,))
        self.assertIn("RWN_QA_PORT=4199", quality.STAGES[-1][1][-1])

    def test_unselected_ephemeral_port_is_never_probed(self):
        probed = []
        probe = mock.MagicMock()
        def bind(address):
            probed.append(address[1])
            if address[1] in {49230, 49242}:
                raise OSError("Unrelated ephemeral connection")
        probe.__enter__.return_value.bind.side_effect = bind
        with mock.patch.object(quality.socket, "socket", return_value=probe):
            quality.ensure_ports_available(quality.BROWSER_PORTS["browser"])
        self.assertEqual(probed, sorted(set(quality.BROWSER_PORTS["browser"])))
        self.assertNotIn(49230, probed)
        self.assertNotIn(49242, probed)

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
        with mock.patch.object(quality.sys, "platform", "linux"), \
             mock.patch.object(quality.os, "sched_getaffinity", return_value=set(range(8)), create=True), \
             mock.patch.object(quality.os, "getpriority", return_value=0):
            policy = quality.stage_resource_policy("browser", mock.Mock(side_effect=AssertionError))
        self.assertEqual(policy["cpus"], list(range(8)))
        self.assertEqual(policy["nice_increment"], 0)
        self.assertEqual(policy["expected_nice"], 0)
        with mock.patch.object(quality.os, "nice") as nice, \
             mock.patch.object(quality.os, "sched_setaffinity", create=True) as affinity:
            quality.child_limits(policy)
        nice.assert_not_called()
        affinity.assert_called_once_with(0, list(range(8)))

    def test_check_policy_uses_two_physical_cores_and_lower_priority(self):
        with mock.patch.object(quality.sys, "platform", "linux"), \
             mock.patch.object(quality.os, "sched_getaffinity", return_value=set(range(8)), create=True), \
             mock.patch.object(quality.os, "getpriority", return_value=0):
            policy = quality.stage_resource_policy("check", lambda cpu: (0, cpu // 2))
        self.assertEqual(policy["cpus"], [0, 2])
        self.assertEqual(policy["nice_increment"], 10)
        self.assertEqual(policy["expected_nice"], 10)

    def test_darwin_records_no_affinity_and_preserves_priority_policy(self):
        for name, increment in (("check", 10), ("browser", 0), ("touch", 0)):
            with self.subTest(stage=name), \
                 mock.patch.object(quality.sys, "platform", "darwin"), \
                 mock.patch.object(quality.os, "getpriority", return_value=3), \
                 mock.patch.object(quality.os, "sched_getaffinity", create=True,
                                   side_effect=AssertionError("Darwin has no affinity API")), \
                 mock.patch.object(quality.os, "sched_setaffinity", create=True) as affinity, \
                 mock.patch.object(quality.os, "nice") as nice:
                topology = mock.Mock(side_effect=AssertionError("Do not read Linux sysfs"))
                policy = quality.stage_resource_policy(name, topology)
                quality.child_limits(policy)
                self.assertEqual(policy["platform"], "darwin")
                self.assertFalse(policy["affinity_supported"])
                self.assertIsNone(policy["cpus"])
                self.assertEqual(policy["cpu_selection"], "os-managed-no-affinity")
                self.assertEqual(policy["expected_nice"], 3 + increment)
                topology.assert_not_called()
                affinity.assert_not_called()
                if increment:
                    nice.assert_called_once_with(increment)
                else:
                    nice.assert_not_called()

    def test_linux_stage_environment_keeps_isolated_home(self):
        original = {"HOME": "/isolated/home", "XDG_CONFIG_HOME": "/isolated/config"}
        with mock.patch.object(quality.sys, "platform", "linux"), \
             mock.patch.object(quality.pwd, "getpwuid") as account:
            for name in ("install", "check", "touch", "browser"):
                env, metadata = quality.stage_environment(name, original)
                self.assertEqual(env, original)
                self.assertIsNot(env, original)
                self.assertEqual(metadata["home_policy"], "isolated")
            account.assert_not_called()

    def test_darwin_uses_native_home_only_for_browser_stages_without_mutating_input(self):
        original = {"HOME": "/isolated/home", "TMPDIR": "/isolated/tmp"}
        with mock.patch.object(quality.sys, "platform", "darwin"), \
             mock.patch.object(quality.pwd, "getpwuid", return_value=mock.Mock(pw_dir=str(self.root))) as account:
            for name in ("node", "chrome", "install", "check"):
                env, metadata = quality.stage_environment(name, original)
                self.assertEqual(env, original)
                self.assertEqual(metadata["home_policy"], "isolated")
            account.assert_not_called()
            for name in ("touch", "browser", "cross-browser"):
                env, metadata = quality.stage_environment(name, original)
                self.assertEqual(env, dict(original, HOME=str(self.root)))
                self.assertEqual(metadata, {"home_policy": "macos-native-home-isolated-browser-profile",
                                            "home": str(self.root)})
                account.assert_called_with(os.getuid())
        self.assertEqual(original["HOME"], "/isolated/home")

    def test_browser_home_compatibility_preserves_scrubbing_and_private_state_paths(self):
        with mock.patch.dict(os.environ, {"HOME": "/untrusted/home", "GH_TOKEN": "secret",
                                         "NPM_TOKEN": "secret", "NODE_OPTIONS": "untrusted"}), \
             mock.patch.object(quality.sys, "platform", "darwin"), \
             mock.patch.object(quality.pwd, "getpwuid", return_value=mock.Mock(pw_dir=str(self.root))):
            original = quality.clean_environment(self.root / "isolated")
            env, _ = quality.stage_environment("browser", original)
        self.assertEqual(env, dict(original, HOME=str(self.root)))
        for key in ("GH_TOKEN", "NPM_TOKEN", "NODE_OPTIONS"):
            self.assertNotIn(key, env)
        for key in ("TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME",
                    "NPM_CONFIG_USERCONFIG", "NPM_CONFIG_GLOBALCONFIG", "NPM_CONFIG_CACHE",
                    "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "CHROME_PATH"):
            self.assertEqual(env[key], original[key])
        self.assertEqual(original["HOME"], str(self.root / "isolated"))

    def test_browser_stage_records_home_policy_and_spawns_with_selected_environment(self):
        original = quality.clean_environment(self.root / "isolated")
        process = mock.Mock()
        process.wait.return_value = 0
        argv = ["node", "scripts/browser-globe-touch-v4.mjs"]
        with mock.patch.object(quality.sys, "platform", "darwin"), \
             mock.patch.object(quality.pwd, "getpwuid", return_value=mock.Mock(pw_dir=str(self.root))), \
             mock.patch.object(quality, "ensure_ports_available"), \
             mock.patch.object(quality, "stop_process"), \
             mock.patch.object(quality.subprocess, "Popen", return_value=process) as spawn:
            result = quality.run_stage("touch", argv, self.root, original, self.root / "stage.log", 420)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["environment"], {"home_policy": "macos-native-home-isolated-browser-profile",
                                                "home": str(self.root)})
        self.assertEqual(spawn.call_args.args[0], argv)
        self.assertEqual(spawn.call_args.kwargs["env"], dict(original, HOME=str(self.root)))
        self.assertTrue(spawn.call_args.kwargs["start_new_session"])
        process.wait.assert_called_once_with(timeout=420)

    def test_invalid_native_home_fails_closed_without_launch(self):
        with mock.patch.object(quality.sys, "platform", "darwin"), \
             mock.patch.object(quality.pwd, "getpwuid", return_value=mock.Mock(pw_dir="relative/home")), \
             mock.patch.object(quality.subprocess, "Popen") as spawn:
            result = quality.run_stage("browser", ["node"], self.root, {}, self.root / "stage.log", 1)
        self.assertEqual(result["status"], "error")
        self.assertIn("native macOS account home", result["detail"])
        self.assertIsNone(result["environment"])
        spawn.assert_not_called()

    def test_platform_chrome_paths_are_explicit_and_environment_cannot_override(self):
        for system, expected in (
            ("linux", "/usr/bin/google-chrome"),
            ("darwin", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ):
            with self.subTest(system=system), mock.patch.object(quality.sys, "platform", system), \
                 mock.patch.dict(os.environ, {"CHROME_PATH": "/untrusted/browser"}):
                self.assertEqual(quality.clean_environment(self.root / system)["CHROME_PATH"], expected)
        with self.assertRaisesRegex(RuntimeError, "Linux and Darwin"):
            quality.chrome_executable("win32")

    def test_explicit_chrome_path_accepts_executable_with_spaces_and_ignores_environment(self):
        browser = self.root / "Google Chrome for Testing"
        browser.write_text("#!/bin/sh\nexit 0\n")
        browser.chmod(0o700)
        with mock.patch.dict(os.environ, {"CHROME_PATH": "/untrusted/browser"}):
            env = quality.clean_environment(self.root / "home", chrome_path=str(browser))
        self.assertEqual(env["CHROME_PATH"], str(browser.resolve()))
        with self.assertRaisesRegex(RuntimeError, "Linux and Darwin"):
            quality.chrome_executable("win32", override=str(browser))

    def test_explicit_chrome_path_rejects_relative_missing_directory_and_nonexecutable(self):
        nonexecutable = self.root / "not-executable"
        nonexecutable.write_text("not executable")
        nonexecutable.chmod(0o600)
        for path in ("relative/chrome", self.root / "missing", self.root, nonexecutable):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "absolute path.*executable"):
                quality.chrome_executable(override=str(path))

    def test_chrome_option_records_actual_runtime_and_reaches_gates(self):
        browser = self.root / "Google Chrome for Testing"
        browser.write_text("#!/bin/sh\nexit 0\n")
        browser.chmod(0o700)
        versions = {"node": "v24.19.0", "chrome": "Google Chrome for Testing 153.0.8010.12"}
        calls = []
        def prerequisite(name, argv, cwd, env, log, timeout):
            calls.append((name, argv))
            Path(log).write_text(versions[name] + "\n")
            return {"status": "passed", "exit_code": 0}
        def export(repo, sha, archive, workspace, env):
            archive.write_bytes(b"test archive")
            workspace.mkdir()
            return {}
        with mock.patch.object(Path, "home", return_value=self.root), \
             mock.patch.object(quality, "resolve_ref", return_value="a" * 40), \
             mock.patch.object(quality, "git_output", return_value="b" * 40), \
             mock.patch.object(quality, "run_stage", side_effect=prerequisite), \
             mock.patch.object(quality, "export_source", side_effect=export), \
             mock.patch.object(quality, "execute_gates", return_value="failed") as gates, \
             mock.patch("sys.stdout", new=io.StringIO()) as output:
            code = quality.main(["--output-root", str(self.root / "runs"), "--chrome-path", str(browser)])
        saved = json.loads(Path(json.loads(output.getvalue())["receipt"]).read_text())
        self.assertEqual(code, 1)
        self.assertEqual(saved["status"], "failed")
        self.assertEqual(calls, [("node", ["node", "--version"]),
                                 ("chrome", [str(browser.resolve()), "--version"])])
        self.assertEqual(saved["runtime"]["chrome"], versions["chrome"])
        self.assertEqual(saved["runtime"]["chrome_path"], str(browser.resolve()))
        self.assertEqual(gates.call_args.args[1]["CHROME_PATH"], str(browser.resolve()))
        self.assertEqual(saved["validator_source_sha256"], quality.digest(SCRIPT))

    def test_invalid_chrome_option_leaves_error_receipt_and_never_launches_prerequisites(self):
        with mock.patch.object(quality, "run_stage") as runner, \
             mock.patch("sys.stdout", new=io.StringIO()) as output:
            code = quality.main(["--output-root", str(self.root / "runs"), "--chrome-path", "relative/chrome"])
        saved = json.loads(Path(json.loads(output.getvalue())["receipt"]).read_text())
        self.assertEqual(code, 2)
        self.assertEqual(saved["status"], "error")
        self.assertIn("--chrome-path", saved["error"])
        self.assertFalse(saved["stages"])
        runner.assert_not_called()

    def test_setup_failure_keeps_platform_and_durable_error_receipt(self):
        with mock.patch.object(quality.sys, "platform", "darwin"), \
             mock.patch.object(quality, "stage_resource_policy", side_effect=RuntimeError("policy unavailable")), \
             mock.patch("sys.stdout", new=io.StringIO()) as output:
            code = quality.main(["--output-root", str(self.root / "runs")])
        result = json.loads(output.getvalue())
        saved = json.loads(Path(result["receipt"]).read_text())
        self.assertEqual(code, 2)
        self.assertEqual(saved["status"], "error")
        self.assertEqual(saved["platform"]["system"], "darwin")
        self.assertEqual(saved["provider"], "macos")
        self.assertIn("policy unavailable", saved["error"])
        self.assertFalse(saved["stages"])

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
        self.assertEqual(env["CHROME_PATH"], quality.chrome_executable())

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
        self.assertEqual(trace.read_text().splitlines(), ["npm audit --audit-level=high", "npm run check"])
        trace.unlink()
        (self.root / "tests").mkdir()
        names = ["ubuntu-quality.test.py", "quality-backend.test.py", "release-tested.test.py"]
        for name in names:
            (self.root / "tests" / name).touch()
        result = subprocess.run(argv, cwd=self.root, env=env, capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(trace.read_text().splitlines(),
                         ["python3 tests/" + name for name in names] + ["npm audit --audit-level=high", "npm run check"])
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
                     "qa-screenshots/old.png", "test-results/trace.zip", "qa-cross-browser/results.json", "playwright-report/index.html", ".vercel/project.json"):
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
                     ".env.example", "qa-screenshots/old.png", "test-results/trace.zip", "qa-cross-browser/results.json", "playwright-report/index.html", ".vercel/project.json"):
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
