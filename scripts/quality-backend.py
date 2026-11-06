#!/usr/bin/env python3
"""Choose GitHub Quality first; use Ubuntu only with explicit backup evidence.

This command reads GitHub state only. It never pushes, dispatches a workflow,
writes a GitHub check, or deploys. Its stdout is one JSON result.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

REPOSITORY = "iamhuvr/RWN-WEB"
OWNER = "iamhuvr"
WORKFLOW = ".github/workflows/quality.yml"
EXACT_SOURCE_EVENTS = {"push", "workflow_dispatch"}
KNOWN_EVENTS = EXACT_SOURCE_EVENTS | {"pull_request"}
BILLING_MARKER = (
    "the job was not started because recent account payments have failed or "
    "your spending limit needs to be increased"
)


class BackendError(Exception):
    pass


def command(args, cwd, timeout=45):
    try:
        result = subprocess.run(args, cwd=cwd, text=True, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise BackendError(f"{args[0]} could not complete ({type(exc).__name__}).") from exc
    if result.returncode:
        # Do not forward arbitrary command output, which could include credentials.
        raise BackendError(f"{args[0]} command failed (exit {result.returncode}).")
    return result.stdout.strip()


def api(path, cwd):
    raw = command(["gh", "api", "--hostname", "github.com", path], cwd)
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise BackendError("GitHub returned invalid JSON.") from exc


def trusted_commit(ref, cwd):
    root = Path(command(["git", "rev-parse", "--show-toplevel"], cwd)).resolve()
    remote = command(["git", "remote", "get-url", "origin"], root)
    allowed = {
        f"git@github.com:{REPOSITORY}.git",
        f"git@github.com:{REPOSITORY}",
        f"https://github.com/{REPOSITORY}.git",
        f"https://github.com/{REPOSITORY}",
        f"ssh://git@github.com/{REPOSITORY}.git",
        f"ssh://git@github.com/{REPOSITORY}",
    }
    if remote.casefold() not in {item.casefold() for item in allowed}:
        raise BackendError(f"Origin must be the trusted repository {REPOSITORY}.")
    sha = command(["git", "rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}"], root)
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise BackendError("The selected ref did not resolve to a full commit SHA.")
    branches = command(
        ["git", "for-each-ref", "--format=%(refname)", f"--contains={sha}",
         "refs/heads/", "refs/remotes/origin/"], root
    ).splitlines()
    if not branches:
        raise BackendError("Commit must be reachable from a local branch or origin branch; arbitrary pull refs are not accepted.")
    tree = command(["git", "rev-parse", f"{sha}^{{tree}}"], root)
    return root, sha, tree


def parse_time(value):
    if not isinstance(value, str):
        raise BackendError("Allowance evidence has a missing or invalid timestamp.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise BackendError("Allowance evidence has an invalid timestamp.") from exc
    if parsed.tzinfo is None:
        raise BackendError("Allowance evidence timestamps must include a timezone.")
    return parsed.astimezone(timezone.utc)


def allowance_evidence(path, now):
    try:
        evidence = json.loads(Path(path).expanduser().read_text())
    except (OSError, ValueError) as exc:
        raise BackendError("No usable verified allowance evidence. Check GitHub Billing and record a fresh observation.") from exc
    expected = {
        "schema_version": 1,
        "owner": OWNER,
        "repository": REPOSITORY,
        "authenticated_login": OWNER,
        "source": "github-billing-dashboard",
        "exhausted": True,
    }
    if not isinstance(evidence, dict) or any(evidence.get(key) != value for key, value in expected.items()):
        raise BackendError("Allowance evidence does not identify this repository, signed-in owner, and exhausted allowance.")
    url = evidence.get("url", "")
    if not isinstance(url, str) or not (url == "https://github.com/settings/billing" or url.startswith("https://github.com/settings/billing/")):
        raise BackendError("Allowance evidence must reference the GitHub billing dashboard.")
    observed = parse_time(evidence.get("observed_at"))
    valid_until = parse_time(evidence.get("valid_until"))
    if not (observed <= now < valid_until):
        raise BackendError("Allowance evidence is expired or its observation is in the future.")
    if valid_until - observed > timedelta(days=7):
        raise BackendError("Allowance evidence may cover at most seven days; refresh it at the billing reset.")
    return {
        "path": str(Path(path).expanduser().resolve()),
        "source": evidence["source"],
        "url": url,
        "observed_at": evidence["observed_at"],
        "valid_until": evidence["valid_until"],
        "exhausted": True,
    }


def latest_run(sha, root):
    payload = api(f"repos/{REPOSITORY}/actions/workflows/quality.yml/runs?head_sha={sha}&per_page=100", root)
    if not isinstance(payload, dict) or not isinstance(payload.get("workflow_runs"), list):
        raise BackendError("GitHub did not return a valid workflow run list.")
    runs = payload["workflow_runs"]
    if type(payload.get("total_count")) is not int or payload["total_count"] != len(runs):
        raise BackendError("GitHub run results are incomplete; refusing to select from a partial history.")
    if any(not isinstance(run, dict) or run.get("head_sha") != sha or run.get("path") != WORKFLOW for run in runs):
        raise BackendError("GitHub workflow results did not match the exact requested commit and workflow.")
    if any(type(run.get("id")) is not int or run["id"] < 1 or type(run.get("run_attempt")) is not int or run["run_attempt"] < 1 for run in runs):
        raise BackendError("GitHub returned a workflow run without its identity.")
    if any(not isinstance(run.get("event"), str) or run["event"] not in KNOWN_EVENTS for run in runs):
        raise BackendError("GitHub returned an unknown workflow event; the tested checkout cannot be established.")
    # A rerun keeps its original run ID. A PR success tests the synthetic merge
    # checkout, not head_sha, so it is not exact-source release evidence. Skip
    # only those successes; pending, failed, and unknown results still govern.
    ordered = sorted(runs, key=lambda run: (parse_time(run.get("updated_at")), run["id"], run["run_attempt"]), reverse=True)
    for run in ordered:
        if run["event"] == "pull_request" and run.get("status") == "completed" and run.get("conclusion") == "success":
            continue
        return run
    # Retain the newest PR success to explain why exact-source proof is pending.
    return ordered[0] if ordered else None


def billing_blocked(run, root):
    attempt = run["run_attempt"]
    payload = api(f"repos/{REPOSITORY}/actions/runs/{run['id']}/attempts/{attempt}/jobs?per_page=100", root)
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise BackendError("GitHub did not return a valid job list.")
    jobs = payload["jobs"]
    if not jobs or payload.get("total_count") != len(jobs):
        raise BackendError("GitHub job results are empty or incomplete.")
    # A started test, skipped step, or unrelated job failure is never a quota bypass.
    for job in jobs:
        if not isinstance(job, dict) or job.get("status") != "completed" or job.get("conclusion") != "failure" or job.get("steps") != []:
            return False
        check_url = job.get("check_run_url", "")
        match = re.fullmatch(r"https://api\.github\.com/repos/iamhuvr/RWN-WEB/check-runs/([0-9]+)", check_url) if isinstance(check_url, str) else None
        if not match:
            raise BackendError("GitHub job has no trusted check-run URL.")
        annotations = api(f"repos/{REPOSITORY}/check-runs/{match.group(1)}/annotations?per_page=100", root)
        if not isinstance(annotations, list) or len(annotations) >= 100:
            raise BackendError("GitHub check annotations are invalid or incomplete.")
        if not any(isinstance(item, dict) and BILLING_MARKER in " ".join(str(item.get("message", "")).lower().split()) for item in annotations):
            return False
    return True


def recent_billing_run(run, now):
    try:
        observed = parse_time(run.get("updated_at"))
    except BackendError:
        return False
    return (
        (observed.year, observed.month) == (now.year, now.month)
        and timedelta(0) <= now - observed <= timedelta(hours=24)
    )


def select_backend(provider, sha, root, evidence_path, now):
    if provider == "ubuntu":
        return {"status": "selected", "provider": "ubuntu", "source": "explicit-machine-verification",
                "reason": "Ubuntu testing was explicitly requested; GitHub availability was not inferred."}
    identity = api("user", root)
    if not isinstance(identity, dict) or not isinstance(identity.get("login"), str) or identity["login"].casefold() != OWNER:
        raise BackendError(f"GitHub CLI must be authenticated as {OWNER}.")
    run = latest_run(sha, root)
    if run is None:
        if provider == "github":
            return {"status": "pending", "provider": "github", "source": "github-actions",
                    "reason": "No Quality run exists for this commit. Dispatch Quality on the branch containing this exact commit."}
        evidence = allowance_evidence(evidence_path, now)
        return {"status": "selected", "provider": "ubuntu", "source": "verified-allowance-evidence",
                "reason": "No exact-commit Quality run exists and a fresh signed-in dashboard observation confirms exhausted allowance.",
                "allowance_evidence": evidence}
    expected_url = f"https://github.com/{REPOSITORY}/actions/runs/{run['id']}"
    if run.get("html_url") != expected_url:
        raise BackendError("GitHub returned an unexpected workflow URL.")
    common = {"provider": "github", "source": "github-actions", "github_url": expected_url,
              "github_run_id": run["id"], "github_run_attempt": run["run_attempt"], "github_event": run["event"]}
    if run.get("status") in {"queued", "in_progress", "waiting", "requested", "pending"}:
        return {**common, "status": "pending", "reason": "The latest applicable Quality run is still pending; Ubuntu fallback is not selected."}
    if run.get("status") != "completed":
        raise BackendError("GitHub returned an unknown workflow state.")
    conclusion = run.get("conclusion")
    if conclusion == "success":
        if run["event"] not in EXACT_SOURCE_EVENTS:
            return {**common, "status": "pending",
                    "reason": "Only pull-request merge-checkout successes are available; they do not prove this exact source commit. Dispatch Quality on the branch containing this commit."}
        return {**common, "status": "passed", "reason": "The latest eligible push or workflow_dispatch Quality run passed for this exact commit."}
    if provider == "auto" and conclusion == "failure" and billing_blocked(run, root):
        backup = {**common, "status": "selected", "provider": "ubuntu", "source": "github-billing-block",
                  "github_billing_observed_at": run.get("updated_at")}
        if recent_billing_run(run, now):
            return {**backup, "reason": "GitHub explicitly blocked the job for billing before any test steps executed within the last 24 hours and current UTC month."}
        evidence = allowance_evidence(evidence_path, now)
        return {**backup, "allowance_evidence": evidence,
                "reason": "The historic GitHub billing block is corroborated by fresh signed-in dashboard evidence of exhausted allowance."}
    return {**common, "status": "failed",
            "reason": f"The latest Quality run concluded {conclusion!r}; no Ubuntu fallback is permitted."}


def run_ubuntu(root, sha, output_root):
    # Automatic fallback remains the configured Ubuntu host. A Mac validation is
    # an explicit validator run and verified receipt, never an implicit reroute.
    if sys.platform != "linux":
        raise BackendError("Ubuntu fallback requires Linux; run explicit macOS validation separately.")
    args = [sys.executable, str(root / "scripts/ubuntu-quality.py"), "--ref", sha]
    if output_root:
        args += ["--output-root", str(Path(output_root).expanduser())]
    # Progress stays on stderr; stdout must remain machine readable.
    try:
        process = subprocess.run(args, cwd=root, text=True, stdout=subprocess.PIPE)
    except OSError as exc:
        raise BackendError("The Ubuntu validator could not start.") from exc
    try:
        result = json.loads(process.stdout)
    except ValueError as exc:
        raise BackendError("The Ubuntu validator did not return a JSON result.") from exc
    if not isinstance(result, dict) or result.get("sha") != sha:
        raise BackendError("The Ubuntu validator returned a different or missing commit SHA.")
    passed = process.returncode == 0 and result.get("status") == "passed"
    receipt = result.get("receipt")
    if not isinstance(receipt, str) or not Path(receipt).is_absolute() or not Path(receipt).is_file():
        raise BackendError("The Ubuntu validator did not preserve a readable receipt.")
    return {"status": "passed" if passed else "failed", "receipt": receipt, "local_result": result,
            "validator_exit_code": process.returncode}


def atomic_json(path, result):
    destination = Path(path).expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
    try:
        with os.fdopen(descriptor, "w") as handle:
            json.dump(result, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default="HEAD", help="Trusted local/origin branch or its commit (default: HEAD)")
    parser.add_argument("--provider", choices=("auto", "github", "ubuntu"), default="auto")
    parser.add_argument("--allowance-evidence", default="~/.config/rwn-web-quality/allowance.json")
    parser.add_argument("--output", help="Atomically save the same result JSON emitted on stdout")
    parser.add_argument("--output-root", help="Forward the local run storage directory to the Ubuntu validator")
    args = parser.parse_args(argv)
    result = {"schema_version": 1, "repository": REPOSITORY, "requested_provider": args.provider}
    try:
        root, sha, tree = trusted_commit(args.ref, Path(__file__).resolve().parent.parent)
        result.update({"sha": sha, "tree": tree, "source_path": str(root),
                       "checked_at": datetime.now(timezone.utc).isoformat()})
        decision = select_backend(args.provider, sha, root, args.allowance_evidence, datetime.now(timezone.utc))
        result.update(decision)
        if decision["status"] == "selected":
            result.update(run_ubuntu(root, sha, args.output_root))
    except (BackendError, KeyboardInterrupt) as exc:
        result.update({"status": "error", "reason": str(exc) or "Interrupted; no pass was recorded."})
    if args.output:
        try:
            atomic_json(args.output, result)
        except OSError:
            result.update({"status": "error", "reason": "Could not save the requested selector result."})
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "passed" else 2 if result["status"] == "pending" else 1


if __name__ == "__main__":
    raise SystemExit(main())
