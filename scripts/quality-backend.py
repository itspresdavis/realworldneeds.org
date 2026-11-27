#!/usr/bin/env python3
"""Verify native GitHub Actions quality for the exact candidate commit.

This command reads GitHub state only. It never pushes, dispatches a workflow,
writes a GitHub check, or deploys. Its stdout is one JSON result.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

REPOSITORY = "itspresdavis/RWN-WEB"
OWNER = "itspresdavis"
WORKFLOW = ".github/workflows/quality.yml"
EXACT_SOURCE_EVENTS = {"push", "workflow_dispatch"}
KNOWN_EVENTS = EXACT_SOURCE_EVENTS | {"pull_request"}
REQUIRED_JOBS = (
    "test", "Native browser / offline and globe", "PostgreSQL permission and migration tests",
    "Cross-browser / chromium", "Cross-browser / firefox", "Cross-browser / webkit",
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
        raise BackendError("GitHub timestamp has a missing or invalid timestamp.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise BackendError("GitHub timestamp has an invalid timestamp.") from exc
    if parsed.tzinfo is None:
        raise BackendError("GitHub timestamps must include a timezone.")
    return parsed.astimezone(timezone.utc)


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


def verify_required_jobs(run, sha, root):
    """Workflow success alone cannot certify missing or skipped required work."""
    attempt = run["run_attempt"]
    payload = api(f"repos/{REPOSITORY}/actions/runs/{run['id']}/attempts/{attempt}/jobs?per_page=100", root)
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise BackendError("GitHub did not return a valid required jobs list.")
    jobs = payload["jobs"]
    if not jobs or type(payload.get("total_count")) is not int or payload["total_count"] != len(jobs):
        raise BackendError("GitHub required jobs results are empty or incomplete.")
    if any(not isinstance(job, dict) or not isinstance(job.get("name"), str) for job in jobs):
        raise BackendError("GitHub required jobs have an invalid identity.")
    names = [job["name"] for job in jobs]
    if len(names) != len(REQUIRED_JOBS) or set(names) != set(REQUIRED_JOBS):
        raise BackendError("GitHub required jobs are missing, duplicated, or unexpected; current contract requires: "
                           + ", ".join(REQUIRED_JOBS) + ".")
    ids = set()
    for job in jobs:
        if type(job.get("id")) is not int or job["id"] < 1 or job["id"] in ids:
            raise BackendError("GitHub required jobs have missing or duplicate job IDs.")
        ids.add(job["id"])
        # run_attempt is optional in GitHub's job schema. The trusted request
        # already selects that attempt; reject a conflicting returned value.
        if (type(job.get("run_id")) is not int or job["run_id"] != run["id"] or job.get("head_sha") != sha
                or "run_attempt" in job and (type(job["run_attempt"]) is not int or job["run_attempt"] != attempt)):
            raise BackendError("GitHub required job identity does not match the selected source/run attempt.")
        if job.get("status") != "completed" or job.get("conclusion") != "success":
            raise BackendError(f"GitHub required job {job['name']!r} did not complete successfully.")
    by_name = {job["name"]: job for job in jobs}
    return [{"name": name, "id": by_name[name]["id"], "head_sha": sha,
             "run_id": run["id"], "run_attempt": attempt, "conclusion": "success"} for name in REQUIRED_JOBS]


def select_backend(provider, sha, root):
    if provider != "github":
        raise BackendError("Only native GitHub Actions qualification is supported.")
    identity = api("user", root)
    if not isinstance(identity, dict) or not isinstance(identity.get("login"), str) or identity["login"].casefold() != OWNER:
        raise BackendError(f"GitHub CLI must be authenticated as {OWNER}.")
    run = latest_run(sha, root)
    if run is None:
        return {"status": "pending", "provider": "github", "source": "github-actions",
                "reason": "No exact-source Quality run exists. Dispatch it on this candidate branch."}
    expected_url = f"https://github.com/{REPOSITORY}/actions/runs/{run['id']}"
    if run.get("html_url") != expected_url:
        raise BackendError("GitHub returned an unexpected workflow URL.")
    common = {"provider": "github", "source": "github-actions", "github_url": expected_url,
              "github_run_id": run["id"], "github_run_attempt": run["run_attempt"], "github_event": run["event"]}
    if run.get("status") in {"queued", "in_progress", "waiting", "requested", "pending"}:
        return {**common, "status": "pending", "reason": "The latest applicable Quality run is still pending; No alternate testing backend is available."}
    if run.get("status") != "completed":
        raise BackendError("GitHub returned an unknown workflow state.")
    conclusion = run.get("conclusion")
    if conclusion == "success":
        if run["event"] not in EXACT_SOURCE_EVENTS:
            return {**common, "status": "pending",
                    "reason": "Only pull-request merge-checkout successes are available; they do not prove this exact source commit. Dispatch Quality on the branch containing this commit."}
        jobs = verify_required_jobs(run, sha, root)
        return {**common, "status": "passed", "github_required_jobs": jobs,
                "reason": "The latest eligible push or workflow_dispatch Quality run and all six required jobs passed for this exact commit."}
    return {**common, "status": "failed",
            "reason": f"The latest Quality run concluded {conclusion!r}; no alternate testing backend is permitted."}


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
    parser.add_argument("--provider", choices=("github",), default="github")
    parser.add_argument("--output", help="Atomically save the same result JSON emitted on stdout")
    args = parser.parse_args(argv)
    result = {"schema_version": 1, "repository": REPOSITORY, "requested_provider": args.provider}
    try:
        root, sha, tree = trusted_commit(args.ref, Path(__file__).resolve().parent.parent)
        result.update({"sha": sha, "tree": tree, "source_path": str(root),
                       "checked_at": datetime.now(timezone.utc).isoformat()})
        decision = select_backend(args.provider, sha, root)
        result.update(decision)
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
