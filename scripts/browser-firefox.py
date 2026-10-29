#!/usr/bin/env python3
"""Native Firefox fallback/flow regression against an already running server.

Python standard library only. Firefox and geckodriver must already be installed.
The fresh profile deliberately disables WebGL; normal Firefox may support WebGL.
No build, installation, account, location, clipboard or external-contact actions.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ELEMENT = "element-6066-11e4-a52e-4f735466cecf"
REPO = Path(__file__).resolve().parents[1]


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def timestamp():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def geometry_checks(state):
    """Catch an implicit grid track even when the page has no horizontal overflow."""
    sidebar, stage, search = (state[key] for key in ("sidebar", "stage", "search"))
    return {
        "fallback_visible": state["fallbackVisible"],
        "one_column": abs(sidebar["x"] - stage["x"]) <= 2,
        "equal_width": abs(sidebar["width"] - stage["width"]) <= 2,
        "no_overlap": stage["y"] >= sidebar["bottom"] - 1,
        "sidebar_usable": sidebar["width"] >= min(250, state["width"] - 40),
        "search_usable": search["width"] >= 160,
        "no_horizontal_overflow": state["scrollWidth"] <= state["width"] + 1,
    }


class LocalBidi:
    """Small RFC6455 client for geckodriver's local, unauthenticated BiDi socket."""
    def __init__(self, url):
        parsed = urllib.parse.urlsplit(url)
        require(parsed.scheme == "ws" and parsed.hostname in ("127.0.0.1", "localhost"),
                "BiDi endpoint must be local")
        self.sock = socket.create_connection((parsed.hostname, parsed.port), timeout=20)
        self.buffer = b""
        self.events = []
        self.counter = 0
        key = base64.b64encode(os.urandom(16)).decode()
        target = parsed.path + ("?" + parsed.query if parsed.query else "")
        request = (f"GET {target} HTTP/1.1\r\nHost: {parsed.netloc}\r\n"
                   "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                   f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.sock.sendall(request.encode())
        while b"\r\n\r\n" not in self.buffer:
            block = self.sock.recv(4096)
            require(block, "BiDi handshake closed")
            self.buffer += block
        headers, self.buffer = self.buffer.split(b"\r\n\r\n", 1)
        require(headers.split(b"\r\n", 1)[0].startswith(b"HTTP/1.1 101 "), "BiDi upgrade failed")
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
        fields = {key.lower(): value.strip() for line in headers.split(b"\r\n")[1:] if b":" in line for key, value in [line.split(b":", 1)]}
        require(fields.get(b"sec-websocket-accept", b"") == expected, "Invalid BiDi handshake")

    def read(self, length):
        while len(self.buffer) < length:
            block = self.sock.recv(max(4096, length - len(self.buffer)))
            require(block, "BiDi socket closed")
            self.buffer += block
        result, self.buffer = self.buffer[:length], self.buffer[length:]
        return result

    def send(self, data, opcode=1):
        mask = os.urandom(4)
        size = len(data)
        header = bytes([0x80 | opcode])
        if size < 126:
            header += bytes([0x80 | size])
        elif size < 65536:
            header += bytes([0x80 | 126]) + struct.pack("!H", size)
        else:
            header += bytes([0x80 | 127]) + struct.pack("!Q", size)
        self.sock.sendall(header + mask + bytes(byte ^ mask[i % 4] for i, byte in enumerate(data)))

    def message(self):
        fragments = bytearray()
        while True:
            first, second = self.read(2)
            length = second & 127
            if length == 126:
                length = struct.unpack("!H", self.read(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self.read(8))[0]
            require(length <= 16 * 1024 * 1024, "Oversized BiDi frame")
            mask = self.read(4) if second & 128 else None
            payload = self.read(length)
            if mask:
                payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
            opcode = first & 15
            if opcode == 8:
                raise RuntimeError("BiDi endpoint closed")
            if opcode == 9:
                self.send(payload, 10)
                continue
            if opcode == 10:
                continue
            require(opcode in (0, 1), "Unexpected BiDi frame")
            fragments.extend(payload)
            if first & 128:
                return json.loads(fragments)

    def call(self, method, params):
        self.counter += 1
        request_id = self.counter
        self.send(json.dumps({"id": request_id, "method": method, "params": params}).encode())
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            self.sock.settimeout(max(.1, deadline - time.monotonic()))
            message = self.message()
            if message.get("id") == request_id:
                require(message.get("type") != "error", f"BiDi {method}: {message}")
                return message.get("result")
            if message.get("type") == "event":
                self.events.append(message)
        raise TimeoutError(f"BiDi {method} timed out")

    def flush(self):
        self.call("session.status", {})

    def close(self):
        self.sock.close()


STATE = r"""
const box=selector=>{const element=document.querySelector(selector);if(!element)return null;
 const r=element.getBoundingClientRect(),s=getComputedStyle(element);
 return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,display:s.display,
 gridColumn:s.gridColumn,gridRow:s.gridRow,gridTemplateColumns:s.gridTemplateColumns};};
const fallback=document.querySelector('#globeFallback');
return {url:location.href,title:document.title,width:innerWidth,height:innerHeight,
 scrollWidth:document.documentElement.scrollWidth,bodyClass:document.body.className,
 visibility:document.visibilityState,grid:box('.finder__grid'),sidebar:box('.finder-sidebar'),
 stage:box('.globe-stage'),search:box('#resourceSearch'),canvas:box('#globeCanvas'),
 fallbackVisible:Boolean(fallback&&!fallback.hidden&&fallback.getBoundingClientRect().height),
 resultCount:document.querySelector('#resultCount')?.innerText,
 queryValue:document.querySelector('[data-directory-query]')?.value,
 directoryCount:document.querySelector('[data-directory-count]')?.innerText,
 resultRows:[...document.querySelectorAll('.directory-global-result')].map(e=>({href:e.href,text:e.innerText})),
 heading:document.querySelector('h1')?.innerText,
 sheets:[...document.styleSheets].map(s=>s.href).filter(Boolean)};
"""


class FirefoxAudit:
    def __init__(self, args, output):
        self.args, self.output = args, output
        self.session = self.driver = self.bidi = self.profile = self.log = None
        self.steps = []
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def command(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.endpoint + path, data=data, method=method,
                                         headers={"Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=90) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"WebDriver {method} {path}: {error.read().decode()}") from error
        value = result.get("value")
        if isinstance(value, dict) and value.get("error"):
            raise RuntimeError(str(value))
        return value

    def wd(self, method, path, body=None):
        return self.command(method, "/session/" + self.session + path, body)

    def js(self, script, *args):
        return self.wd("POST", "/execute/sync", {"script": script, "args": list(args)})

    def wait(self, script, description, timeout=45, stable_for=0):
        deadline = time.monotonic() + timeout
        last = None
        stable_since = None
        while time.monotonic() < deadline:
            try:
                value = self.js(script)
                if value:
                    stable_since = stable_since or time.monotonic()
                    if time.monotonic() - stable_since >= stable_for:
                        return value
                else:
                    stable_since = None
            except RuntimeError as error:
                stable_since = None
                last = error
            time.sleep(.15)
        raise TimeoutError(f"Timed out waiting for {description}: {last or 'condition false'}")

    def start(self):
        ports = []
        for _ in range(2):
            with socket.socket() as temporary:
                temporary.bind(("127.0.0.1", 0))
                ports.append(temporary.getsockname()[1])
        require(ports[0] != ports[1], "Driver port allocation collided; rerun")
        self.endpoint = f"http://127.0.0.1:{ports[0]}"
        profile_parent = self.args.profile_root
        if profile_parent is None:
            snap_parent = Path.home() / "snap/firefox/common"
            profile_parent = snap_parent if snap_parent.is_dir() else Path(tempfile.gettempdir())
        self.profile = Path(tempfile.mkdtemp(prefix="rwn-firefox-", dir=profile_parent))
        self.log = (self.output / "geckodriver.log").open("wb")
        env = {key: value for key, value in os.environ.items() if key in (
            "PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TZ", "XDG_RUNTIME_DIR")}
        env["MOZ_HEADLESS"] = "1"
        self.driver = subprocess.Popen([self.args.geckodriver, "--host", "127.0.0.1", "--port", str(ports[0]),
            "--websocket-port", str(ports[1]), "--profile-root", str(self.profile), "--log", "info"],
            stdout=self.log, stderr=self.log, stdin=subprocess.DEVNULL, start_new_session=True, env=env)
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            require(self.driver.poll() is None, "geckodriver exited; inspect geckodriver.log")
            try:
                self.command("GET", "/status")
                break
            except (OSError, urllib.error.URLError):
                time.sleep(.1)
        else:
            raise TimeoutError("geckodriver startup timed out")
        firefox_options = {"args": ["-headless"], "prefs": {"webgl.disabled": True,
            "browser.shell.checkDefaultBrowser": False, "privacy.donottrackheader.enabled": True}}
        if self.args.firefox:
            firefox_options["binary"] = self.args.firefox
        created = self.command("POST", "/session", {"capabilities": {"alwaysMatch": {
            "browserName": "firefox", "acceptInsecureCerts": False, "webSocketUrl": True,
            "moz:firefoxOptions": firefox_options}}})
        self.session = created["sessionId"]
        capabilities = created["capabilities"]
        atomic_json(self.output / "capabilities.json", capabilities)
        self.bidi = LocalBidi(capabilities["webSocketUrl"])
        self.bidi.call("session.subscribe", {"events": ["log.entryAdded", "network.responseCompleted"]})
        self.context = self.bidi.call("browsingContext.getTree", {})["contexts"][0]["context"]
        self.wd("POST", "/timeouts", {"implicit": 0, "pageLoad": 60000, "script": 20000})
        return capabilities

    def viewport(self, width):
        self.bidi.call("browsingContext.setViewport", {"context": self.context,
            "viewport": {"width": width, "height": 1000 if width == 1440 else 844}, "devicePixelRatio": 1})
        require(self.js("return innerWidth;") == width, "Firefox did not apply exact viewport width")

    def navigate(self, path):
        self.wd("POST", "/url", {"url": self.args.base_url + path})
        self.wait("return document.readyState==='complete';", "page load")

    def element(self, selector):
        return self.wd("POST", "/element", {"using": "css selector", "value": selector})[ELEMENT]

    def click(self, selector):
        self.wd("POST", "/element/" + self.element(selector) + "/click", {})

    def type(self, selector, text):
        element = self.element(selector)
        self.wd("POST", "/element/" + element + "/clear", {})
        self.wd("POST", "/element/" + element + "/value", {"text": text})

    def snapshot(self, label, extra=None):
        state = self.js(STATE)
        self.bidi.flush()
        data = base64.b64decode(self.wd("GET", "/screenshot"), validate=True)
        (self.output / (label + ".png")).write_bytes(data)
        item = {"name": label, "at": timestamp(), "state": state, **(extra or {})}
        self.steps.append(item)
        atomic_json(self.output / "steps.json", self.steps)
        print(label, flush=True)
        return state

    def directory_results(self):
        expected = self.args.expected_boston_results
        return self.wait(f"const rows=[...document.querySelectorAll('.directory-global-result')];"
                         f"return rows.length==={expected} && "
                         "document.querySelector('[data-directory-query]').value==='Boston' && "
                         "!document.querySelector('[data-directory-count]').innerText.includes('Searching') && "
                         "rows.some(e=>e.innerText.includes('Boston Homeless Services Directory')) && "
                         "rows.every(e=>new URL(e.href).pathname.startsWith('/service/'));",
                         f"{expected} Boston results with known service and permanent links", stable_for=.45)

    def run(self):
        for width in (1440, 390, 320):
            self.viewport(width)
            self.navigate("/")
            self.wait("return document.querySelector('.is-globe-unavailable') && "
                      "document.querySelector('#resourceSearch');", "forced WebGL fallback")
            state = self.snapshot(f"home-fallback-{width}")
            checks = geometry_checks(state)
            self.steps[-1]["checks"] = checks
            atomic_json(self.output / "steps.json", self.steps)
            require(all(checks.values()), f"Fallback geometry failed at {width}: {checks}")
            self.type("#resourceSearch", "Boston")
            self.wait("return (/Showing [1-9]/.test(document.querySelector('#resultCount')?.innerText||'') && "
                      "[...document.querySelectorAll('.resource-row,.resource-card')].some(e=>/Boston/i.test(e.innerText)));",
                      "homepage Boston results")
            require(self.js("return !location.search.includes('Boston') && !location.hash.includes('Boston');"),
                    "Homepage exposed the query in its URL")
            self.snapshot(f"home-search-{width}")
            if width < 500:
                self.js("scrollTo(0,0);")
                self.click(".site-menu > summary")
                self.wait("return document.querySelector('.site-menu').open;", "mobile menu open")
                self.snapshot(f"home-menu-{width}")
                self.wd("POST", "/actions", {"actions": [{"type": "key", "id": "keyboard", "actions": [
                    {"type": "keyDown", "value": "\ue00c"}, {"type": "keyUp", "value": "\ue00c"}]}]})
                self.wait("return !document.querySelector('.site-menu').open && "
                          "document.activeElement===document.querySelector('.site-menu > summary');",
                          "Escape closes menu and restores focus")
            self.navigate("/directory")
            self.wait("return document.querySelector('[data-directory-query]');", "directory input")
            self.type("[data-directory-query]", "Boston")
            self.directory_results()
            before = self.snapshot(f"directory-search-{width}")
            require(before["scrollWidth"] <= width + 1, "Directory overflows viewport")
            require(not urllib.parse.urlsplit(before["url"]).query, "Directory exposed search URL query")
            self.js("const select=document.querySelector('[data-directory-country]');"
                    "const option=[...select.options].find(o=>o.textContent==='United States');"
                    "if(!option)throw new Error('Missing US country option');"
                    "select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));")
            self.wait("return document.querySelectorAll('.directory-global-result').length>0 && "
                      "[...document.querySelectorAll('.directory-global-result')].every(e=>e.innerText.includes('United States'));",
                      "country filter")
            self.js("const select=document.querySelector('[data-directory-need]');"
                    "const option=[...select.options].find(o=>o.textContent==='Food');"
                    "if(!option)throw new Error('Missing Food need option');"
                    "select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));")
            self.wait("return document.querySelectorAll('.directory-global-result').length>0 && "
                      "[...document.querySelectorAll('.directory-global-result')].every(e=>e.innerText.includes('Food'));",
                      "need filter")
            filtered = self.snapshot(f"directory-filtered-{width}")
            require(len(filtered["resultRows"]) <= len(before["resultRows"]), "Filters increased result count")
            service_url = filtered["resultRows"][0]["href"]
            require(urllib.parse.urlsplit(service_url).netloc == urllib.parse.urlsplit(self.args.base_url).netloc,
                    "Service result unexpectedly leaves the audited origin")
            self.click(".directory-global-result")
            self.wait("return location.pathname.startsWith('/service/') && document.querySelector('[data-service-save]');",
                      "service navigation")
            service = self.snapshot(f"service-{width}")
            require(service["heading"] and service["scrollWidth"] <= width + 1, "Service heading missing or page overflows")
            self.click("[data-service-save]")
            self.wait("return document.querySelector('[data-service-save]').getAttribute('aria-pressed')==='true';",
                      "service saved")
            self.navigate("/directory#saved")
            self.wait("return document.querySelectorAll('[data-saved-remove]').length===1;", "saved service list")
            self.snapshot(f"saved-service-{width}")
            self.wd("POST", "/url", {"url": service_url})
            self.wait("return document.querySelector('[data-service-save]')?.getAttribute('aria-pressed')==='true';",
                      "saved state persists")
            self.click("[data-service-save]")
            self.wait("return document.querySelector('[data-service-save]').getAttribute('aria-pressed')==='false';",
                      "service removed")
            self.navigate("/directory#saved")
            self.wait("return document.body.innerText.includes('No saved services yet');", "empty saved list")
            self.snapshot(f"unsaved-service-{width}")
        self.bidi.flush()
        bad_network = [event for event in self.bidi.events if event.get("method") == "network.responseCompleted"
                       and event.get("params", {}).get("response", {}).get("status", 0) >= 400]
        require(not bad_network, "Browser received failed HTTP responses; inspect browser-events.json")
        errors = [event for event in self.bidi.events if event.get("method") == "log.entryAdded"
                  and event.get("params", {}).get("level") == "error"
                  and not any(text in event.get("params", {}).get("text", "") for text in (
                      "WebGL", "webgl", "THREE.WebGLRenderer"))]
        require(not errors, "Unexpected browser errors; inspect browser-events.json")

    def cleanup(self):
        errors = []

        def attempt(label, operation):
            try:
                operation()
            except Exception as error:
                errors.append(f"{label}: {error}")

        # Evidence failures must never bypass release of our owned resources.
        if self.bidi:
            attempt("save browser events", lambda: atomic_json(self.output / "browser-events.json", [
                event for event in self.bidi.events
                if event.get("method") != "network.responseCompleted" or
                event.get("params", {}).get("response", {}).get("status", 0) >= 400]))
        if self.session:
            attempt("delete browser session", lambda: self.wd("DELETE", ""))
        if self.bidi:
            attempt("close BiDi socket", self.bidi.close)
        if self.driver:
            def stop_driver():
                try:
                    os.killpg(self.driver.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    self.driver.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    pass
                # The leader can exit before its Firefox descendants. Probe only
                # the process group created by this runner, then finish cleanup.
                try:
                    os.killpg(self.driver.pid, 0)
                    os.killpg(self.driver.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                self.driver.wait(timeout=5)
            attempt("stop owned driver group", stop_driver)
        if self.log:
            attempt("close driver log", self.log.close)
        if self.profile:
            attempt("remove private profile", lambda: shutil.rmtree(self.profile))
        if errors:
            raise RuntimeError("; ".join(errors))


def executable_metadata(path):
    resolved = Path(path).resolve()
    return {"path": str(path), "resolved": str(resolved), "sha256": sha256(resolved)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4187")
    parser.add_argument("--output-dir", required=True, type=Path, help="New external evidence directory (required)")
    parser.add_argument("--firefox", help="Actual Firefox executable; default uses geckodriver discovery (supports snap)")
    parser.add_argument("--geckodriver", default=shutil.which("geckodriver") or "/snap/bin/geckodriver")
    parser.add_argument("--expected-boston-results", type=int, default=22, help="Current catalog fixture count; update deliberately after a catalog change")
    parser.add_argument("--profile-root", type=Path, help="Existing parent visible to Firefox; snap default is ~/snap/firefox/common")
    args = parser.parse_args(argv)
    args.base_url = args.base_url.rstrip("/")
    url = urllib.parse.urlsplit(args.base_url)
    parser.error("Base URL must be an HTTP(S) origin without credentials, path, query or fragment") if (
        url.scheme not in ("http", "https") or not url.hostname or url.username or url.password
        or url.path or url.query or url.fragment) else None
    output = args.output_dir.expanduser().resolve()
    if output == REPO or REPO in output.parents:
        parser.error("Evidence must be outside the source checkout")
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    receipt = {"schema_version": 1, "status": "running", "started_at": timestamp(), "base_url": args.base_url,
               "forced_webgl_disabled": True, "note": "This tests deterministic fallback; normal Firefox may support WebGL.",
               "expected_boston_results": args.expected_boston_results, "runner_sha256": sha256(__file__), "output_dir": str(output), "viewports": [1440, 390, 320]}
    audit = FirefoxAudit(args, output)
    code = 1
    def interrupted(signum, _frame):
        raise InterruptedError(f"Interrupted by signal {signum}")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    atomic_json(output / "receipt.json", receipt)
    try:
        receipt["executables"] = {"firefox_launcher": executable_metadata(args.firefox or shutil.which("firefox") or "/usr/bin/firefox"),
                                  "geckodriver_launcher": executable_metadata(args.geckodriver)}
        snap = Path("/snap/firefox/current/usr/lib/firefox")
        if "snap" in str(Path(args.geckodriver).resolve()) and snap.is_dir():
            receipt["executables"].update({name: executable_metadata(snap / name) for name in ("firefox", "geckodriver")})
        git = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True, timeout=10)
        receipt["runner_checkout_sha"] = git.stdout.strip() if git.returncode == 0 else None
        with audit.opener.open(args.base_url + "/data/release.json", timeout=20) as response:
            raw = response.read()
            receipt["served_release"] = {"sha256": hashlib.sha256(raw).hexdigest(), "data": json.loads(raw)}
        capabilities = audit.start()
        receipt["browser_version"] = capabilities.get("browserVersion")
        receipt["geckodriver_version"] = capabilities.get("moz:geckodriverVersion")
        atomic_json(output / "receipt.json", receipt)
        audit.run()
        receipt["status"] = "passed"
        code = 0
    except Exception as error:
        receipt["status"] = "failed"
        receipt["error"] = f"{type(error).__name__}: {error}"
        print(receipt["error"], flush=True)
        if audit.session:
            try:
                audit.snapshot("failure", {"error": receipt["error"]})
            except Exception as capture_error:
                receipt["capture_error"] = str(capture_error)
    finally:
        try:
            audit.cleanup()
        except Exception as error:
            receipt["status"] = "failed"
            receipt["cleanup_error"] = str(error)
            code = 1
        receipt["finished_at"] = timestamp()
        receipt["steps"] = len(audit.steps)
        receipt["artifacts"] = [{"path": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)}
                                for path in sorted(output.iterdir()) if path.is_file() and path.name != "receipt.json"]
        atomic_json(output / "receipt.json", receipt)
    print(json.dumps({"status": receipt["status"], "receipt": str(output / "receipt.json")}))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
