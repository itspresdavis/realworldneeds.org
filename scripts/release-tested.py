#!/usr/bin/env python3
"""Deploy an exact tested RWN-WEB commit; production builds are staged without domains."""
import argparse
import datetime as dt
import hashlib
import io
import json
import pathlib
import subprocess
import sys
import tarfile
import tempfile

REPO = "iamhuvr/RWN-WEB"
PROJECT = "prj_504G7M2lhnU5NlmfSAEyY4UdA4DX"
TEAM = "anlos"
ROOT = pathlib.Path(__file__).resolve().parents[1]

def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, **kwargs)

def git(*args):
    return run(["git", "-C", str(ROOT), *args]).stdout

def verify_receipt(receipt, sha, tree, archive_hash, validator_hash, now=None):
    if receipt.get("schema_version") != 1 or receipt.get("repository") != REPO:
        raise ValueError("Wrong receipt schema or repository")
    if receipt.get("status") != "passed" or receipt.get("sha") != sha:
        raise ValueError("Receipt did not pass for this exact commit")
    if receipt.get("source_tree") != tree or receipt.get("git_archive_sha256") != archive_hash:
        raise ValueError("Receipt source does not match the selected Git commit")
    if receipt.get("validator_source_sha256") != validator_hash:
        raise ValueError("Validator changed since testing; run the tests again")
    stages = receipt.get("stages", {})
    if set(stages) != {"install", "check", "touch", "browser"}:
        raise ValueError("Incomplete test stages")
    for name, stage in stages.items():
        if stage.get("status") != "passed" or stage.get("exit_code") != 0:
            raise ValueError("Test stage did not pass: " + name)
    finished = dt.datetime.fromisoformat(receipt["finished_at"].replace("Z", "+00:00"))
    current = now or dt.datetime.now(dt.timezone.utc)
    if finished.tzinfo is None or not 0 <= (current-finished).total_seconds() <= 86400:
        raise ValueError("Receipt is future-dated or older than 24 hours")
    return True

def verify_project(project):
    if project.get("id") != PROJECT or project.get("name") != "rwn-web" or project.get("owner", {}).get("slug") != TEAM:
        raise ValueError("Vercel project identity mismatch")

def export_source(data, destination):
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as archive:
        members = []
        for member in archive.getmembers():
            path = pathlib.PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or not path.parts:
                raise ValueError("Unsafe source archive path")
            if path.parts[0] in {"node_modules", "dist", ".vercel", "qa-screenshots"}:
                continue
            if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise ValueError("Unsupported source archive entry: " + member.name)
            if any(part == ".env" or (part.startswith(".env.") and part != ".env.example") for part in path.parts):
                raise ValueError("Refusing to upload a tracked environment file")
            members.append(member)
        archive.extractall(destination, members=members, filter="data")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default="HEAD")
    parser.add_argument("--receipt", type=pathlib.Path, help="Passed Ubuntu receipt, at most 24 hours old")
    parser.add_argument("--target", choices=["preview", "production-stage"], default="preview")
    parser.add_argument("--dry-run", action="store_true", help="Validate and inspect deploy input without uploading")
    args = parser.parse_args()
    origin = git("remote", "get-url", "origin").decode().strip().removesuffix(".git").rstrip("/")
    if origin not in {"https://github.com/" + REPO, "git@github.com:" + REPO}:
        raise ValueError("Unexpected repository origin")
    sha = git("rev-parse", "--verify", "--end-of-options", args.ref + "^{commit}").decode().strip()
    tree = git("rev-parse", sha + "^{tree}").decode().strip()
    data = git("archive", "--format=tar", sha)
    archive_hash = hashlib.sha256(data).hexdigest()
    state = pathlib.Path.home() / ".local/state/rwn-web-quality/releases"
    state.mkdir(parents=True, exist_ok=True)
    release = pathlib.Path(tempfile.mkdtemp(prefix=sha[:12]+"-", dir=state))
    quality_file = release / "quality.json"
    if args.receipt:
        receipt = json.loads(args.receipt.read_text())
        validator_hash = hashlib.sha256((ROOT/"scripts/ubuntu-quality.py").read_bytes()).hexdigest()
        verify_receipt(receipt, sha, tree, archive_hash, validator_hash)
        quality = {"status": "passed", "provider": "ubuntu", "sha": sha, "receipt": str(args.receipt.resolve())}
    else:
        print("Checking exact commit before deployment: " + sha, file=sys.stderr, flush=True)
        selected = subprocess.run([sys.executable, str(ROOT/"scripts/quality-backend.py"), "--ref", sha, "--output", str(quality_file)])
        if selected.returncode:
            raise ValueError("Quality gate did not pass; no deployment created")
        quality = json.loads(quality_file.read_text())
        if quality.get("status") != "passed" or quality.get("sha") != sha:
            raise ValueError("Quality result did not pass for the selected commit")
    if quality.get("provider") == "ubuntu":
        local_receipt = json.loads(pathlib.Path(quality["receipt"]).read_text())
        validator_hash = hashlib.sha256((ROOT/"scripts/ubuntu-quality.py").read_bytes()).hexdigest()
        verify_receipt(local_receipt, sha, tree, archive_hash, validator_hash)
    quality_file.write_text(json.dumps(quality, indent=2)+"\n")
    project = json.loads(run(["vercel", "--scope", TEAM, "project", "inspect", PROJECT, "--json", "--non-interactive"]).stdout)
    verify_project(project)
    workspace = release / "workspace"
    workspace.mkdir()
    export_source(data, workspace)
    (release/"source.tar").write_bytes(data)
    argv = ["vercel", "deploy", str(workspace), "--scope", TEAM, "--project", PROJECT,
            "--non-interactive", "--yes", "--json", "--meta", "rwnTestedSha="+sha,
            "--meta", "rwnQualityProvider="+quality["provider"]]
    if args.target == "production-stage":
        argv += ["--prod", "--skip-domain"]
    if args.dry_run:
        argv += ["--dry"]
    else:
        argv += ["--verify"]
    print(("Inspecting" if args.dry_run else "Deploying") + " tested commit to anlos/rwn-web (" + args.target + ")", file=sys.stderr, flush=True)
    with (release/"vercel.stdout.json").open("wb") as output, (release/"vercel.stderr.log").open("wb") as errors:
        deployed = subprocess.run(argv, stdout=output, stderr=errors, timeout=2700)
    result = {"schema_version":1, "sha":sha, "source_tree":tree, "git_archive_sha256":archive_hash,
              "project_id":PROJECT, "team":TEAM, "target":args.target, "dry_run":args.dry_run,
              "quality":quality, "directory":str(release), "exit_code":deployed.returncode,
              "status":"passed" if deployed.returncode == 0 else "failed",
              "finished_at":dt.datetime.now(dt.timezone.utc).isoformat()}
    try:
        result["vercel"] = json.loads((release/"vercel.stdout.json").read_text())
    except json.JSONDecodeError:
        result["vercel_output"] = str(release/"vercel.stdout.json")
    (release/"release.json").write_text(json.dumps(result, indent=2)+"\n")
    print(json.dumps(result))
    return deployed.returncode

if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as exc:
        print(json.dumps({"status":"error","error":str(exc)}), file=sys.stderr)
        sys.exit(1)
