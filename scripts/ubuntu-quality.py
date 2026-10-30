#!/usr/bin/env python3
"""Run RWN-WEB's Quality gates from an immutable, isolated Git export."""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
import platform
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

REPOSITORY = "iamhuvr/RWN-WEB"
STAGES = (
    ("install", ["npm", "ci"], 300),
    ("check", ["/bin/sh", "-c", """set -eu
for test in tests/ubuntu-quality.test.py tests/quality-backend.test.py tests/release-tested.test.py; do
    if [ -f "$test" ]; then
        PYTHONDONTWRITEBYTECODE=1 python3 "$test"
    fi
done
exec npm run check
"""], 900),
    ("touch", ["node", "scripts/browser-globe-touch-v4.mjs"], 420),
    ("browser", ["npm", "run", "test:browser:qa"], 3600),
)
TERMINAL = {"passed", "failed", "error", "interrupted"}
BROWSER_PORTS = {
    "touch": (4178, 9228),
    # Only endpoints actually used by the sequential suite. Unchosen random
    # candidates and unrelated ephemeral connections must not block the gate.
    "browser": (4173, 4175, 4176, 4177, 4178, 4181, 4184, 4185,
                9222, 9224, 9225, 9226, 9228, 9231, 9234, 9235),
}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def digest(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def chrome_executable(system=None):
    system = sys.platform if system is None else system
    if system == "linux":
        return "/usr/bin/google-chrome"
    if system == "darwin":
        return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    raise RuntimeError("Local Quality supports Linux and Darwin only")


def clean_environment(home, temp_root=None):
    home = Path(home)
    home.mkdir(parents=True, exist_ok=True)
    runtime_tmp = Path(temp_root) if temp_root is not None else home / "tmp"
    runtime_tmp.mkdir(parents=True, exist_ok=True)
    user_config = home / "npm-user.conf"
    global_config = home / "npm-global.conf"
    user_config.write_text("")
    global_config.write_text("")
    keep = ("PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "USER", "LOGNAME")
    env = {key: os.environ[key] for key in keep if key in os.environ}
    env.setdefault("PATH", "/usr/local/bin:/usr/bin:/bin")
    env.update({
        "HOME": str(home), "TMPDIR": str(runtime_tmp),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_CACHE_HOME": str(home / ".cache"),
        "XDG_DATA_HOME": str(home / ".local/share"),
        "NPM_CONFIG_USERCONFIG": str(user_config),
        "NPM_CONFIG_GLOBALCONFIG": str(global_config),
        "NPM_CONFIG_CACHE": str(home / ".cache/npm"),
        "CHROME_PATH": chrome_executable(),
        "CI": "true", "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0",
    })
    return env


def git_output(repo, env, *args):
    completed = subprocess.run(
        ["git", "-C", str(repo), *args], env=env, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60,
        check=True,
    )
    return completed.stdout.strip()


def resolve_ref(repo, ref, env):
    if not ref or ref.startswith("-") or any(c in ref for c in "\x00\r\n"):
        raise ValueError("Ref must be a nonempty Git revision, not an option.")
    origin = git_output(repo, env, "remote", "get-url", "origin")
    permitted = {
        "https://github.com/iamhuvr/RWN-WEB.git",
        "https://github.com/iamhuvr/RWN-WEB",
        "git@github.com:iamhuvr/RWN-WEB.git",
        "git@github.com:iamhuvr/RWN-WEB",
        "ssh://git@github.com/iamhuvr/RWN-WEB.git",
        "ssh://git@github.com/iamhuvr/RWN-WEB",
    }
    if origin not in permitted:
        raise ValueError("Source origin does not match " + REPOSITORY)
    root = Path(git_output(repo, env, "rev-parse", "--show-toplevel")).resolve()
    if root != Path(repo).resolve():
        raise ValueError("Validator must run from the source repository root.")
    sha = git_output(repo, env, "rev-parse", "--verify", "--end-of-options", ref + "^{commit}")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Ref did not resolve to an immutable SHA-1 commit.")
    return sha


def allowed_member(member):
    path = PurePosixPath(member.name)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("Unsafe path in source archive: " + member.name)
    if path.parts and path.parts[0] in {"qa-screenshots", ".vercel"}:
        return False
    if any(part in {"node_modules", "dist", ".git"} for part in path.parts):
        return False
    if any((part == ".env" or part.startswith(".env.")) and part != ".env.example"
           for part in path.parts):
        return False
    if not (member.isfile() or member.isdir()):
        raise ValueError("Unsupported link or special file in source archive: " + member.name)
    return True


def stop_process(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=10)
    # The group may still contain grandchildren after its leader has exited.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def read_cpu_topology(cpu):
    root = Path("/sys/devices/system/cpu") / ("cpu" + str(cpu)) / "topology"
    return (int((root / "physical_package_id").read_text()),
            int((root / "core_id").read_text()))


def select_build_cpus(allowed, topology_reader=read_cpu_topology):
    allowed = sorted(set(allowed))
    selected, seen = [], set()
    try:
        for cpu in allowed:
            identity = topology_reader(cpu)
            if identity not in seen:
                seen.add(identity)
                selected.append(cpu)
            if len(selected) == 2:
                break
    except (OSError, ValueError, TypeError):
        return allowed[:2], "logical-fallback-topology-unavailable"
    return selected, "distinct-physical-cores"


def stage_resource_policy(name, topology_reader=read_cpu_topology):
    system = sys.platform
    if system not in {"linux", "darwin"}:
        raise RuntimeError("Local Quality supports Linux and Darwin only")
    inherited_nice = os.getpriority(os.PRIO_PROCESS, 0)
    increment = 0 if name in {"touch", "browser"} else 10
    if system == "darwin":
        # Darwin has no sched_setaffinity API. Do not claim or emulate a CPU cap.
        cpus, selection = None, "os-managed-no-affinity"
    else:
        allowed = sorted(os.sched_getaffinity(0))
        if name in {"touch", "browser"}:
            cpus, selection = allowed, "full-inherited-affinity"
        else:
            cpus, selection = select_build_cpus(allowed, topology_reader)
    return {
        "platform": system, "affinity_supported": system == "linux",
        "cpus": cpus, "cpu_selection": selection,
        "inherited_nice": inherited_nice, "nice_increment": increment,
        "expected_nice": min(19, inherited_nice + increment),
    }


def child_limits(policy=None):
    # Node descendants inherit affinity; browser timing keeps normal host access.
    policy = policy if policy is not None else stage_resource_policy("check")
    if policy["nice_increment"]:
        os.nice(policy["nice_increment"])
    if policy["affinity_supported"]:
        os.sched_setaffinity(0, policy["cpus"])


def export_source(repo, sha, archive, workspace, env):
    excluded = 0
    full_hash = hashlib.sha256()
    class HashingReader:
        def __init__(self, stream):
            self.stream = stream
        def read(self, size=-1):
            block = self.stream.read(size)
            full_hash.update(block)
            return block
    log_path = archive.parent / "archive.log"
    with log_path.open("wb") as log:
        process = subprocess.Popen(
            ["git", "-C", str(repo), "archive", "--format=tar", sha],
            stdout=subprocess.PIPE, stderr=log, env=env, start_new_session=True,
        )
        try:
            reader = HashingReader(process.stdout)
            with tarfile.open(fileobj=reader, mode="r|") as source:
                with tarfile.open(archive, mode="w") as output:
                    for member in source:
                        if not allowed_member(member):
                            excluded += 1
                            continue
                        stream = source.extractfile(member) if member.isfile() else None
                        output.addfile(member, stream)
                        if stream is not None:
                            stream.close()
            while reader.read(1024 * 1024):
                pass
            if process.wait(timeout=30) != 0:
                raise RuntimeError("Git archive failed; see archive.log")
        finally:
            process.stdout.close()
            stop_process(process)
    workspace.mkdir()
    with tarfile.open(archive, mode="r") as source:
        # Every member was checked before writing the retained archive; no links.
        for member in source:
            if not allowed_member(member):
                raise ValueError("Unexpected excluded file in filtered source archive")
        source.extractall(workspace, filter="data")
    return {"excluded_archive_members": excluded, "git_archive_sha256": full_hash.hexdigest()}


def ensure_ports_available(ports):
    occupied = []
    for port in sorted(set(ports)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                occupied.append(port)
    if occupied:
        raise RuntimeError("QA ports are occupied; existing processes were preserved: " +
                           ", ".join(map(str, occupied)))


def run_stage(name, argv, cwd, env, log_path, timeout):
    started = now()
    start = time.monotonic()
    process = None
    status = "error"
    exit_code = None
    detail = None
    resources = stage_resource_policy(name)
    try:
        with Path(log_path).open("wb") as log:
            try:
                ensure_ports_available(BROWSER_PORTS.get(name, ()))
            except Exception as error:
                log.write((str(error) + "\n").encode())
                raise
            process = subprocess.Popen(
                argv, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT,
                start_new_session=True, preexec_fn=lambda: child_limits(resources),
            )
            try:
                exit_code = process.wait(timeout=timeout)
                status = "passed" if exit_code == 0 else "failed"
            except subprocess.TimeoutExpired:
                status, detail = "failed", "timeout"
                stop_process(process)
                exit_code = process.returncode
            except BaseException:
                stop_process(process)
                raise
    except (Interrupted, KeyboardInterrupt):
        raise
    except Exception as error:
        status, detail = "error", str(error)
    finally:
        if process is not None:
            stop_process(process)
    return {
        "name": name, "argv": argv, "status": status, "exit_code": exit_code,
        "resources": resources,
        "detail": detail, "started_at": started, "finished_at": now(),
        "duration_seconds": round(time.monotonic() - start, 3),
        "timeout_seconds": timeout, "log": str(log_path),
        "log_sha256": digest(log_path) if Path(log_path).exists() else None,
    }


def stage_passed(stage):
    return stage.get("status") == "passed" and stage.get("exit_code") == 0


def execute_gates(workspace, env, run_dir, receipt, save, runner=run_stage):
    receipt["stages"] = {}
    save()
    for name, argv, timeout in STAGES:
        if name in {"check", "touch", "browser"}:
            required = ["install"] if name == "check" else ["install", "check"]
            if any(not stage_passed(receipt["stages"].get(key, {})) for key in required):
                receipt["stages"][name] = {"name": name, "status": "skipped", "detail": "prerequisite failed"}
                save()
                continue
        receipt["active_stage"] = name
        save()
        print("Running " + name + " (timeout " + str(timeout) + "s)", file=sys.stderr, flush=True)
        receipt["stages"][name] = runner(
            name, argv, workspace, env, run_dir / (name + ".log"), timeout,
        )
        receipt["active_stage"] = None
        save()
    return "passed" if all(stage_passed(receipt["stages"].get(name, {}))
                           for name, _, _ in STAGES) else "failed"


def collect_artifacts(workspace):
    found = []
    directory = workspace / "qa-screenshots"
    if directory.is_dir():
        for path in sorted(directory.iterdir()):
            if path.is_file() and not path.is_symlink() and path.suffix in {".png", ".json"}:
                stat = path.stat()
                found.append({
                    "path": str(path), "sha256": digest(path), "bytes": stat.st_size,
                    "modified_at": dt.datetime.fromtimestamp(stat.st_mtime, dt.timezone.utc).isoformat(),
                })
    return found


class Interrupted(Exception):
    def __init__(self, signum):
        self.signum = signum
        super().__init__("Interrupted by signal " + str(signum))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default="HEAD")
    parser.add_argument("--output-root", default="~/.local/state/rwn-web-quality/runs")
    options = parser.parse_args(argv)
    repo = Path(__file__).resolve().parents[1]
    root = Path(options.output_root).expanduser().resolve()
    if root == repo or repo in root.parents:
        parser.error("--output-root must be outside the source checkout")
    root.mkdir(parents=True, exist_ok=True)
    run_dir = root / (dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:12])
    run_dir.mkdir(mode=0o700)
    receipt_path = run_dir / "receipt.json"
    receipt = {
        "schema_version": 1, "repository": REPOSITORY, "source_path": str(repo),
        "requested_ref": options.ref, "sha": None, "status": "running",
        "started_at": now(), "finished_at": None, "active_stage": "setup",
        "stages": {}, "artifacts": [], "run_directory": str(run_dir),
        "validator_source_sha256": digest(Path(__file__)),
        "platform": {"system": sys.platform, "machine": platform.machine(),
                     "release": platform.release()},
        "provider": {"linux": "ubuntu", "darwin": "macos"}.get(sys.platform),
        "limits": {},
    }
    save = lambda: atomic_json(receipt_path, receipt)
    save()
    lock = None
    workspace = run_dir / "workspace"
    exit_code = 2
    previous = {}
    def interrupted(signum, frame):
        raise Interrupted(signum)
    try:
        # Populate resource limits inside the receipt boundary so unsupported
        # hosts or unavailable OS APIs still leave a durable failure.
        receipt["limits"] = {"build": stage_resource_policy("check"),
                             "browser": stage_resource_policy("browser")}
        save()
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.signal(signum, interrupted)
        # Chrome SingletonSocket uses TMPDIR and Unix socket paths are limited.
        # Keep HOME and evidence retained, but use a short private runtime path.
        runtime_tmp = Path(tempfile.mkdtemp(prefix="rwn-q-", dir="/tmp"))
        receipt["runtime_tmpdir"] = str(runtime_tmp)
        save()
        env = clean_environment(run_dir / "home", temp_root=runtime_tmp)
        lock_path = Path.home() / ".local/state/rwn-web-quality/validator.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        lock = lock_path.open("a")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Another local Quality validator is running") from error
        receipt["sha"] = resolve_ref(repo, options.ref, env)
        receipt["source_tree"] = git_output(repo, env, "rev-parse", receipt["sha"] + "^{tree}")
        save()
        node = run_stage("node", ["node", "--version"], repo, env, run_dir / "node.log", 15)
        chrome = run_stage("chrome", [env["CHROME_PATH"], "--version"], repo, env, run_dir / "chrome.log", 15)
        receipt["prerequisites"] = {"node": node, "chrome": chrome}
        node_version = (run_dir / "node.log").read_text().strip()
        chrome_version = (run_dir / "chrome.log").read_text().strip()
        if node["status"] != "passed" or not re.fullmatch(r"v24\.\d+\.\d+", node_version):
            raise RuntimeError("Node.js major version 24 is required")
        if chrome["status"] != "passed" or not chrome_version.startswith("Google Chrome "):
            raise RuntimeError(env["CHROME_PATH"] + " did not verify successfully")
        receipt["runtime"] = {"node": node_version, "chrome": chrome_version,
                              "node_path": shutil.which("node", path=env["PATH"]),
                              "chrome_path": env["CHROME_PATH"]}
        archive = run_dir / "source.tar"
        receipt.update(export_source(repo, receipt["sha"], archive, workspace, env))
        receipt["source_archive"] = {"path": str(archive), "sha256": digest(archive), "bytes": archive.stat().st_size}
        save()
        # Fresh exports must not carry old QA evidence or private environment files.
        qa = workspace / "qa-screenshots"
        if qa.exists():
            raise RuntimeError("Source export unexpectedly contains old QA artifacts")
        result = execute_gates(workspace, env, run_dir, receipt, save)
        receipt["artifacts"] = collect_artifacts(workspace)
        receipt["status"] = result
        exit_code = 0 if result == "passed" else 1
    except Interrupted as error:
        receipt["status"] = "interrupted"
        receipt["error"] = str(error)
        exit_code = 128 + error.signum
    except KeyboardInterrupt:
        receipt["status"] = "interrupted"
        receipt["error"] = "Interrupted by keyboard"
        exit_code = 130
    except Exception as error:
        receipt["status"] = "error"
        receipt["error"] = str(error)
        exit_code = 2
    finally:
        if receipt["status"] not in TERMINAL:
            receipt["status"] = "error"
            receipt["error"] = "Validation did not complete"
        receipt["finished_at"] = now()
        receipt["active_stage_at_finish"] = receipt.pop("active_stage", None)
        # Partial output remains useful after a failure or a signal.
        try:
            receipt["artifacts"] = collect_artifacts(workspace)
        except Exception as error:
            receipt["artifact_error"] = str(error)
            receipt["status"], exit_code = "error", 2
        save()
        if lock is not None:
            lock.close()
        for signum, handler in previous.items():
            signal.signal(signum, handler)
    final_status = receipt["status"] if receipt["status"] in {"passed", "failed"} else "error"
    print(json.dumps({"status": final_status, "receipt": str(receipt_path), "sha": receipt["sha"]}), flush=True)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
