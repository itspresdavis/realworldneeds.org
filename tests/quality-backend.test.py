#!/usr/bin/env python3
"""Offline decision tests. Every GitHub/git subprocess is mocked."""
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "quality-backend.py"
SPEC = importlib.util.spec_from_file_location("quality_backend", SOURCE)
backend = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backend)

SHA = "a" * 40
TREE = "b" * 40
ROOT = Path("/trusted/RWN-WEB")
NOW = datetime(2026, 10, 29, 12, tzinfo=timezone.utc)
RUNS = f"repos/{backend.REPOSITORY}/actions/workflows/quality.yml/runs?head_sha={SHA}&per_page=100"
JOBS = f"repos/{backend.REPOSITORY}/actions/runs/200/attempts/1/jobs?per_page=100"
ANNOTATIONS = f"repos/{backend.REPOSITORY}/check-runs/300/annotations?per_page=100"
REQUIRED_JOBS = ("test", "Native browser / offline and globe", "PostgreSQL permission and migration tests",
                 "Cross-browser / chromium", "Cross-browser / firefox", "Cross-browser / webkit")


def run(identity=200, **updates):
    return {"id": identity, "head_sha": SHA, "path": backend.WORKFLOW, "run_attempt": 1, "event": "push",
            "html_url": f"https://github.com/{backend.REPOSITORY}/actions/runs/{identity}",
            "status": "completed", "conclusion": "success", "updated_at": (NOW - timedelta(hours=1)).isoformat(), **updates}


def job(**updates):
    return {"id": 300, "status": "completed", "conclusion": "failure", "steps": [],
            "check_run_url": f"https://api.github.com/repos/{backend.REPOSITORY}/check-runs/300", **updates}


class Decisions(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.evidence_path = Path(self.temporary.name) / "allowance.json"
        self.calls = []
        self.responses = {
            "user": {"login": "iamhuvr"},
            RUNS: {"total_count": 1, "workflow_runs": [run()]},
            JOBS: {"total_count": 1, "jobs": [job()]},
            ANNOTATIONS: [{"message": backend.BILLING_MARKER + ". Please check Billing & plans."}],
        }
        self.mock = patch.object(backend.subprocess, "run", side_effect=self.subprocess)
        self.mock.start()
        self.addCleanup(self.mock.stop)

    def subprocess(self, args, **kwargs):
        self.calls.append(args)
        self.assertEqual(args[:4], ["gh", "api", "--hostname", "github.com"])
        self.assertNotIn("shell", kwargs)
        value = self.responses[args[4]]
        if isinstance(value, Exception):
            raise value
        if isinstance(value, subprocess.CompletedProcess):
            return value
        return subprocess.CompletedProcess(args, 0, json.dumps(value), "")

    def decide(self, provider="auto"):
        return backend.select_backend(provider, SHA, ROOT, self.evidence_path, NOW)

    def no_runs(self):
        self.responses[RUNS] = {"total_count": 0, "workflow_runs": []}

    def evidence(self, **updates):
        payload = {
            "schema_version": 1, "owner": backend.OWNER, "repository": backend.REPOSITORY,
            "authenticated_login": backend.OWNER, "source": "github-billing-dashboard",
            "url": "https://github.com/settings/billing/usage", "exhausted": True,
            "observed_at": (NOW - timedelta(hours=1)).isoformat(),
            "valid_until": "2026-11-01T00:00:00Z", **updates,
        }
        self.evidence_path.write_text(json.dumps(payload))

    def failed(self):
        self.responses[RUNS]["workflow_runs"] = [run(conclusion="failure")]

    def successful_jobs(self, identity=200, attempt=1):
        jobs = [job(id=400 + index, name=name, run_id=identity, run_attempt=attempt, head_sha=SHA,
                    conclusion="success", steps=[{"name": "Verify", "status": "completed", "conclusion": "success"}])
                for index, name in enumerate(REQUIRED_JOBS)]
        endpoint = f"repos/{backend.REPOSITORY}/actions/runs/{identity}/attempts/{attempt}/jobs?per_page=100"
        self.responses[endpoint] = {"total_count": len(jobs), "jobs": jobs}
        return self.responses[endpoint]

    def test_exact_success_uses_github(self):
        self.successful_jobs()
        result = self.decide()
        self.assertEqual((result["status"], result["provider"]), ("passed", "github"))
        self.assertEqual(len(self.calls), 3)
        self.assertEqual([item["name"] for item in result["github_required_jobs"]], list(REQUIRED_JOBS))

    def test_dispatch_success_is_exact_source_evidence(self):
        self.responses[RUNS]["workflow_runs"] = [run(event="workflow_dispatch")]
        self.successful_jobs()
        self.assertEqual(self.decide()["status"], "passed")

    def test_historical_five_job_success_cannot_certify_current_contract(self):
        payload = self.successful_jobs()
        payload["jobs"].pop(1)
        payload["total_count"] -= 1
        self.evidence()
        for provider in ("auto", "github"):
            with self.assertRaisesRegex(backend.BackendError, "required jobs"):
                self.decide(provider)
        self.assertTrue(all(item[4] != ANNOTATIONS for item in self.calls))

    def test_each_required_job_must_pass_on_the_selected_source_and_attempt(self):
        for index in range(len(REQUIRED_JOBS)):
            for updates in ({"conclusion": "failure"}, {"conclusion": "timed_out"}, {"conclusion": "skipped"},
                            {"status": "in_progress"}, {"head_sha": "c" * 40}, {"run_id": 100},
                            {"run_attempt": 2}, {"run_attempt": True}, {"run_id": 200.0}, {"id": None}):
                with self.subTest(name=REQUIRED_JOBS[index], updates=updates):
                    self.successful_jobs()["jobs"][index].update(updates)
                    with self.assertRaises(backend.BackendError):
                        self.decide()

    def test_duplicate_unknown_and_partial_required_job_lists_fail_closed(self):
        for variation in ("duplicate name", "duplicate id", "unknown name", "partial", "empty"):
            with self.subTest(variation=variation):
                payload = self.successful_jobs()
                if variation == "duplicate name": payload["jobs"][1]["name"] = payload["jobs"][0]["name"]
                if variation == "duplicate id": payload["jobs"][1]["id"] = payload["jobs"][0]["id"]
                if variation == "unknown name": payload["jobs"][1]["name"] = "Optional browser work"
                if variation == "partial": payload["total_count"] += 1
                if variation == "empty": payload.update(total_count=0, jobs=[])
                with self.assertRaises(backend.BackendError):
                    self.decide()

    def test_success_queries_the_selected_attempt_and_rejects_older_job_metadata(self):
        self.responses[RUNS]["workflow_runs"] = [run(run_attempt=2)]
        payload = self.successful_jobs(attempt=2)
        self.assertEqual(self.decide()["status"], "passed")
        self.assertIn("/attempts/2/jobs?", self.calls[-1][4])
        payload["jobs"][1]["run_attempt"] = 1
        with self.assertRaises(backend.BackendError):
            self.decide()

    def test_optional_job_attempt_field_uses_trusted_attempt_endpoint(self):
        payload = self.successful_jobs()
        for item in payload["jobs"]: item.pop("run_attempt")
        self.assertEqual(self.decide()["status"], "passed")

    def test_job_api_order_does_not_change_required_gate_identity(self):
        payload = self.successful_jobs()
        payload["jobs"].reverse()
        result = self.decide()
        self.assertEqual([item["name"] for item in result["github_required_jobs"]], list(REQUIRED_JOBS))

    def test_pr_success_alone_remains_pending_even_with_allowance_evidence(self):
        self.responses[RUNS]["workflow_runs"] = [run(event="pull_request")]
        self.evidence()
        for provider in ("auto", "github"):
            result = self.decide(provider)
            self.assertEqual(result["status"], "pending")
            self.assertIn("merge-checkout", result["reason"])
        self.assertTrue(all(item[4] != JOBS for item in self.calls))

    def test_pr_success_can_use_older_exact_source_success(self):
        for event in ("push", "workflow_dispatch"):
            self.responses[RUNS] = {"total_count": 2, "workflow_runs": [
                run(100, event=event), run(event="pull_request", updated_at=NOW.isoformat()),
            ]}
            self.successful_jobs(identity=100)
            result = self.decide()
            self.assertEqual(result["status"], "passed")
            self.assertEqual(result["github_run_id"], 100)
            self.assertEqual(result["github_event"], event)

    def test_pr_success_does_not_hide_real_failure_or_pending(self):
        for state, conclusion, expected in (
            ("completed", "failure", "failed"), ("queued", None, "pending"),
            ("completed", "cancelled", "failed"),
        ):
            self.responses[RUNS] = {"total_count": 3, "workflow_runs": [
                run(100, updated_at=(NOW - timedelta(hours=2)).isoformat()),
                run(status=state, conclusion=conclusion),
                run(300, event="pull_request", updated_at=NOW.isoformat()),
            ]}
            self.responses[JOBS]["jobs"][0]["steps"] = [{"conclusion": "failure"}]
            self.assertEqual(self.decide()["status"], expected)

    def test_failed_pr_does_not_yield_to_older_exact_success(self):
        self.responses[RUNS] = {"total_count": 2, "workflow_runs": [
            run(100), run(event="pull_request", conclusion="failure", updated_at=NOW.isoformat()),
        ]}
        self.responses[JOBS]["jobs"][0]["steps"] = [{"conclusion": "failure"}]
        self.assertEqual(self.decide()["status"], "failed")

    def test_pr_success_does_not_hide_unknown_status_or_event(self):
        for updates in ({"status": "mystery"}, {"event": "pull_request_target"}, {"event": None}):
            self.responses[RUNS] = {"total_count": 2, "workflow_runs": [
                run(**updates), run(300, event="pull_request", updated_at=NOW.isoformat()),
            ]}
            with self.assertRaises(backend.BackendError):
                self.decide()

    def test_unstarted_billing_blocked_pr_can_authorize_exact_local_validation(self):
        self.responses[RUNS]["workflow_runs"] = [run(event="pull_request", conclusion="failure")]
        result = self.decide()
        self.assertEqual((result["status"], result["provider"]), ("selected", "ubuntu"))
        self.assertEqual(result["source"], "github-billing-block")

    def test_latest_failure_wins_over_old_success(self):
        self.responses[RUNS] = {"total_count": 2, "workflow_runs": [run(100), run(conclusion="failure")]}
        self.responses[JOBS]["jobs"][0]["steps"] = [{"number": 1, "conclusion": "failure"}]
        self.assertEqual(self.decide()["status"], "failed")

    def test_new_failed_attempt_on_older_run_supersedes_previous_success(self):
        older_rerun = run(100, conclusion="failure", run_attempt=2, updated_at=NOW.isoformat())
        self.responses[RUNS] = {"total_count": 2, "workflow_runs": [run(), older_rerun]}
        endpoint = f"repos/{backend.REPOSITORY}/actions/runs/100/attempts/2/jobs?per_page=100"
        self.responses[endpoint] = {"total_count": 1, "jobs": [job(steps=[{"conclusion": "failure"}])]}
        self.assertEqual(self.decide()["status"], "failed")

    def test_pending_does_not_fall_back_even_with_evidence(self):
        for state in ("queued", "in_progress", "waiting", "requested", "pending"):
            self.responses[RUNS]["workflow_runs"] = [run(status=state, conclusion=None)]
            self.evidence()
            self.assertEqual(self.decide()["status"], "pending")
        self.assertTrue(all(item[4] != JOBS for item in self.calls))

    def test_billing_failure_without_steps_selects_ubuntu(self):
        self.failed()
        result = self.decide()
        self.assertEqual((result["provider"], result["source"]), ("ubuntu", "github-billing-block"))

    def test_old_billing_block_requires_current_allowance_evidence(self):
        self.failed()
        self.responses[RUNS]["workflow_runs"][0]["updated_at"] = "2026-10-20T00:00:00Z"
        with self.assertRaises(backend.BackendError):
            self.decide()
        self.evidence()
        self.assertEqual(self.decide()["allowance_evidence"]["exhausted"], True)

    def test_old_october_billing_block_cannot_authorize_november_backup(self):
        self.failed()
        self.responses[RUNS]["workflow_runs"][0]["updated_at"] = "2026-10-31T23:30:00Z"
        self.evidence()
        november = datetime(2026, 11, 1, 0, 30, tzinfo=timezone.utc)
        with self.assertRaises(backend.BackendError):
            backend.select_backend("auto", SHA, ROOT, self.evidence_path, november)
        self.assertFalse(backend.recent_billing_run(self.responses[RUNS]["workflow_runs"][0], november))

    def test_missing_or_future_billing_timestamp_requires_evidence(self):
        self.failed()
        for observed in (None, "invalid", (NOW + timedelta(minutes=1)).isoformat()):
            self.responses[RUNS]["workflow_runs"][0]["updated_at"] = observed
            with self.assertRaises(backend.BackendError):
                self.decide()

    def test_started_steps_block_fallback_even_with_billing_text(self):
        self.failed()
        self.responses[JOBS]["jobs"][0]["steps"] = [{"number": 1, "conclusion": "failure"}]
        self.assertEqual(self.decide()["status"], "failed")
        self.assertTrue(all(item[4] != ANNOTATIONS for item in self.calls))

    def test_no_steps_without_billing_text_is_failure(self):
        self.failed()
        self.responses[ANNOTATIONS] = [{"message": "Tests failed."}]
        self.assertEqual(self.decide()["status"], "failed")

    def test_nonbilling_conclusions_never_fall_back(self):
        for conclusion in ("cancelled", "timed_out", "neutral", "skipped", "action_required", None):
            self.responses[RUNS]["workflow_runs"] = [run(conclusion=conclusion)]
            self.assertEqual(self.decide()["status"], "failed")
        self.assertTrue(all(item[4] != JOBS for item in self.calls))

    def test_github_provider_never_falls_back(self):
        self.failed()
        self.assertEqual(self.decide("github")["status"], "failed")
        self.assertEqual(len(self.calls), 2)

    def test_explicit_ubuntu_does_not_probe_github(self):
        result = self.decide("ubuntu")
        self.assertEqual(result["source"], "explicit-machine-verification")
        self.assertEqual(self.calls, [])

    def test_no_run_with_fresh_evidence_selects_backup(self):
        self.no_runs()
        self.evidence()
        result = self.decide()
        self.assertEqual(result["source"], "verified-allowance-evidence")
        self.assertEqual(result["allowance_evidence"]["exhausted"], True)

    def test_no_run_github_remains_pending(self):
        self.no_runs()
        self.assertEqual(self.decide("github")["status"], "pending")

    def test_no_run_without_evidence_fails_closed(self):
        self.no_runs()
        with self.assertRaises(backend.BackendError):
            self.decide()

    def test_expired_future_wrong_owner_and_unverified_evidence_rejected(self):
        self.no_runs()
        bad_values = [
            {"valid_until": NOW.isoformat()},
            {"observed_at": (NOW + timedelta(minutes=1)).isoformat()},
            {"owner": "other"},
            {"repository": "other/RWN-WEB"},
            {"authenticated_login": "other"},
            {"source": "guess"},
            {"exhausted": False},
            {"url": "https://github.com/settings/billing.evil"},
            {"valid_until": (NOW + timedelta(days=8)).isoformat()},
            {"observed_at": "2026-10-29T00:00:00"},
        ]
        for values in bad_values:
            with self.subTest(values=values):
                self.evidence(**values)
                with self.assertRaises(backend.BackendError):
                    self.decide()

    def test_identity_failure_never_uses_evidence(self):
        self.no_runs()
        self.evidence()
        self.responses["user"] = {"login": "someone-else"}
        with self.assertRaises(backend.BackendError):
            self.decide()
        self.assertEqual(len(self.calls), 1)

    def test_api_error_never_uses_evidence(self):
        self.no_runs()
        self.evidence()
        self.responses[RUNS] = subprocess.CompletedProcess([], 1, "", "private token must not leak")
        with self.assertRaises(backend.BackendError) as caught:
            self.decide()
        self.assertNotIn("private token", str(caught.exception))

    def test_timeout_fails_closed(self):
        self.responses[RUNS] = subprocess.TimeoutExpired("gh", 45)
        with self.assertRaises(backend.BackendError):
            self.decide()

    def test_partial_wrong_sha_and_wrong_workflow_results_rejected(self):
        for payload in (
            {"total_count": 101, "workflow_runs": [run()]},
            {"total_count": 1, "workflow_runs": [run(head_sha="c" * 40)]},
            {"total_count": 1, "workflow_runs": [run(path=".github/workflows/other.yml")]},
            {"workflow_runs": []},
        ):
            self.responses[RUNS] = payload
            with self.assertRaises(backend.BackendError):
                self.decide()

    def test_empty_or_partial_job_list_fails_closed(self):
        self.failed()
        for payload in ({"total_count": 0, "jobs": []}, {"total_count": 2, "jobs": [job()]}):
            self.responses[JOBS] = payload
            with self.assertRaises(backend.BackendError):
                self.decide()

    def test_untrusted_check_url_rejected_without_request(self):
        self.failed()
        self.responses[JOBS]["jobs"][0]["check_run_url"] = "https://evil.example/private"
        with self.assertRaises(backend.BackendError):
            self.decide()
        self.assertEqual(len(self.calls), 3)


class WorkflowContract(unittest.TestCase):
    def test_native_split_preserves_every_existing_script_and_deadline(self):
        root = SOURCE.parents[1]
        workflow = (root / backend.WORKFLOW).read_text()
        jobs = dict(re.findall(r"(?ms)^  ([a-z-]+):\n(.*?)(?=^  [a-z-]+:\n|\Z)", workflow.split("jobs:\n", 1)[1]))
        self.assertEqual(set(jobs), {"test", "native-offline-globe", "postgres-permissions", "cross-browser"})
        combined = []
        for key in ("test", "native-offline-globe"):
            body = jobs[key]
            self.assertRegex(body, r"(?m)^    timeout-minutes: 24$")
            self.assertIn("run: npm ci", body)
            self.assertIn("node-version: 24", body)
            self.assertNotIn("continue-on-error", body)
            self.assertNotRegex(body, r"(?m)^    needs:")
            combined += [match for match in re.findall(r"(?m)^          (node scripts/browser-[a-z0-9-]+\.mjs)$", body)
                         if "browser-globe-touch-v4" not in match]
        full = json.loads((root / "package.json").read_text())["scripts"]["test:browser:qa"].split(" && ")
        self.assertEqual(combined, full, "CI shards must preserve the complete fallback workload exactly once and in order")
        self.assertEqual(len(combined), len(set(combined)))
        self.assertIn("run: npm run check", jobs["test"])
        self.assertIn("node scripts/browser-globe-touch-v4.mjs", jobs["test"])
        self.assertIn("run: npm run build", jobs["native-offline-globe"])
        self.assertIn("name: Native browser / offline and globe", jobs["native-offline-globe"])
        self.assertIn("name: rwn-visual-qa", jobs["test"])
        self.assertIn("name: rwn-native-offline-globe-qa", jobs["native-offline-globe"])
        for action in re.findall(r"(?m)^        uses: (\S+)", workflow):
            self.assertRegex(action, r"@[0-9a-f]{40}$")
        self.assertEqual(tuple(backend.REQUIRED_JOBS), REQUIRED_JOBS)


class LocalBoundaries(unittest.TestCase):
    def setUp(self):
        platform = patch.object(backend.sys, "platform", "linux")
        platform.start()
        self.addCleanup(platform.stop)

    def test_darwin_cannot_silently_replace_configured_ubuntu_fallback(self):
        with patch.object(backend.sys, "platform", "darwin"), \
             patch.object(backend.subprocess, "run") as command:
            with self.assertRaisesRegex(backend.BackendError, "Ubuntu fallback requires Linux"):
                backend.run_ubuntu(ROOT, SHA, None)
            command.assert_not_called()

    def test_origin_and_branch_reachability_are_required(self):
        good = [str(ROOT), "git@github.com:iamhuvr/RWN-WEB.git", SHA, "refs/heads/main", TREE]
        with patch.object(backend.subprocess, "run", side_effect=[
            subprocess.CompletedProcess([], 0, value, "") for value in good
        ]) as mocked:
            self.assertEqual(backend.trusted_commit("HEAD", ROOT), (ROOT, SHA, TREE))
            self.assertEqual(mocked.call_args_list[2].args[0][-1], "HEAD^{commit}")
        for values in (
            [str(ROOT), "git@github.com:someone-else/RWN-WEB.git"],
            [str(ROOT), "git@github.com:iamhuvr/RWN-WEB.git", SHA, ""],
        ):
            with patch.object(backend.subprocess, "run", side_effect=[
                subprocess.CompletedProcess([], 0, value, "") for value in values
            ]):
                with self.assertRaises(backend.BackendError):
                    backend.trusted_commit("refs/pull/1/head", ROOT)

    def test_local_pass_requires_matching_sha_and_durable_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            receipt = Path(temporary) / "receipt.json"
            receipt.write_text("{}")
            result = {"status": "passed", "sha": SHA, "receipt": str(receipt)}
            with patch.object(backend.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(result))):
                self.assertEqual(backend.run_ubuntu(ROOT, SHA, None)["status"], "passed")
            result["sha"] = "c" * 40
            with patch.object(backend.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(result))):
                with self.assertRaises(backend.BackendError):
                    backend.run_ubuntu(ROOT, SHA, None)
            result["sha"] = SHA
            receipt.unlink()
            with patch.object(backend.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(result))):
                with self.assertRaises(backend.BackendError):
                    backend.run_ubuntu(ROOT, SHA, None)

    def test_local_nonzero_cannot_be_reported_as_passed(self):
        with tempfile.TemporaryDirectory() as temporary:
            receipt = Path(temporary) / "receipt.json"
            receipt.write_text("{}")
            result = {"status": "passed", "sha": SHA, "receipt": str(receipt)}
            with patch.object(backend.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, json.dumps(result))):
                self.assertEqual(backend.run_ubuntu(ROOT, SHA, None)["status"], "failed")

    def test_output_is_atomic_json(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "result.json"
            backend.atomic_json(destination, {"status": "passed", "sha": SHA})
            self.assertEqual(json.loads(destination.read_text())["sha"], SHA)
            self.assertEqual(list(Path(temporary).iterdir()), [destination])


if __name__ == "__main__":
    unittest.main(verbosity=2)
