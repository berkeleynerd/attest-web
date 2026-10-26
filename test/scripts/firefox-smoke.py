#!/usr/bin/env python3
"""Live Firefox acceptance test. Uses only Python's standard library.

Requires FIREFOX_BIN, GECKODRIVER_BIN, Go/GPG, and built dist-firefox/.
ATTEST_SOURCE_DIR selects the attest source checkout. All keys/profiles are
disposable; the test key is injected only into a temporary extension copy.
"""
import collections
import gzip
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
import zipfile


ROOT = Path(__file__).resolve().parents[2]


def main():
    firefox = os.environ["FIREFOX_BIN"]
    geckodriver = os.environ["GECKODRIVER_BIN"]
    source = os.environ.get("ATTEST_SOURCE_DIR")
    if not source:
        source = next(str(path) for path in [ROOT.parent / "attest", ROOT.parent / "web-ring/attest"] if (path / "gpg.go").exists())
    with tempfile.TemporaryDirectory(prefix="attest-firefox-") as temp:
        work = Path(temp)
        home = work / "gpg"
        home.mkdir(mode=0o700)
        env = dict(os.environ, GNUPGHOME=str(home))

        def run(args, **kwargs):
            return subprocess.check_output([str(arg) for arg in args], env=env, stderr=subprocess.PIPE, **kwargs)

        tool = work / "attest"
        run(["go", "build", "-o", tool, "."], cwd=source)
        run(["gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase", "", "--quick-generate-key", "Firefox Test <firefox@example.invalid>", "ed25519", "sign", "1d"])
        fields = [line.split(":") for line in run(["gpg", "--batch", "--with-colons", "--with-key-data", "--list-keys"]).decode().splitlines()]
        fingerprint = next(line[9] for line in fields if line[0] == "fpr")
        point = next(line[3] for line in fields if line[:2] == ["pkd", "1"])
        assert re.fullmatch("40[0-9A-Fa-f]{64}", point)
        payload = '<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><meta charset="utf-8" /><title>Firefox Test</title><style>/*<![CDATA[*/p::before{content:"A & B < C"}/*]]>*/</style></head><body><p>Signed page Café 日本語</p></body></html>\n'.encode()
        input_file, signed_file = work / "input.html", work / "signed.html"
        input_file.write_bytes(payload)
        run([tool, "sign", "-k", fingerprint, "-o", signed_file, input_file])
        signed = signed_file.read_bytes()
        altered = signed.replace(b"Signed page", b"Forged page", 1)

        extension = work / "extension"
        shutil.copytree(ROOT / "dist-firefox", extension)
        sources = work / "src"
        shutil.copytree(ROOT / "src", sources)
        background = sources / "extension/background.ts"
        background_text = re.sub(r'const expectedFingerprint = "[A-F0-9]+";', f'const expectedFingerprint = "{fingerprint}";', background.read_text())
        trace = """
const testEvents: unknown[] = [];
for (const name of ['navigate','capture','commit','end','complete','navigationError','unavailable','remove']) {
 const original = delivered[name].bind(delivered);
 delivered[name] = (...args) => { testEvents.push({name,args}); return original(...args); };
}
chrome.runtime.onMessage.addListener((message,_sender,respond) => { if(message?.type==='test-events') respond(testEvents); });
for (const [name, extra] of [['onBeforeRequest', []], ['onHeadersReceived', ['responseHeaders']], ['onErrorOccurred', []]]) {
 const args = [details => testEvents.push({name, details}), {urls:['http://*/*','https://*/*'], types:['main_frame']}];
 if (name !== 'onErrorOccurred') args.push(extra);
 browser.webRequest[name].addListener(...args);
}
"""
        background.write_text(background_text.replace('const delivered = new DeliveredPages(results, badge);', 'const delivered = new DeliveredPages(results, badge);' + trace))
        (sources / "verify-core/trust.ts").write_text("export const TRUSTED_KEYS: Record<string,string> = " + json.dumps({fingerprint: point[2:]}) + ";\n")
        build = "const e=require(process.argv[1]); e.buildSync({entryPoints:[process.argv[2]],outfile:process.argv[3],bundle:true,format:'iife',target:'es2022'});"
        run(["node", "-e", build, ROOT / "node_modules/esbuild", background, extension / "background.js"])
        addon = work / "addon.zip"
        with zipfile.ZipFile(addon, "w") as archive:
            for path in extension.rglob("*"):
                if path.is_file():
                    archive.write(path, str(path.relative_to(extension)))

        counts = collections.Counter()
        mode = {"reload": signed, "headers": []}
        observations = []
        header_cases = {
            "/header-link": [("Link", '</unsigned.css>; rel="stylesheet"')],
            "/header-refresh": [("Refresh", "3; url=/plain")],
            "/header-csp-permissive": [("Content-Security-Policy", "default-src * 'unsafe-inline'")],
            "/header-csp-restrictive": [("Content-Security-Policy", "default-src 'none'; style-src 'none'")],
            "/header-csp-report": [("Content-Security-Policy-Report-Only", "default-src 'none'; report-uri /report")],
            "/header-language": [("Content-Language", "fr")],
            "/header-inline": [("Content-Disposition", "inline")],
        }
        content_types = {
            "/header-plain": "text/plain; charset=utf-8",
            "/header-utf16": "text/html; charset=utf-16le",
            "/header-no-charset": "text/html",
            "/header-no-type": None,
        }

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                counts[self.path] += 1
                if self.path in ["/redirect", "/redirect-unsupported", "/redirect-to-unsupported"]:
                    self.send_response(302)
                    self.send_header("Location", "/header-link" if self.path == "/redirect-to-unsupported" else "/signed")
                    if self.path == "/redirect-unsupported":
                        self.send_header("Link", '</unsigned.css>; rel="stylesheet"')
                        self.send_header("Content-Security-Policy", "default-src 'none'")
                    self.end_headers()
                    return
                if self.path == "/unsigned.css":
                    body = b'p::after{content:"UNSIGNED HEADER TEXT"} p{color:rgb(201,17,88)}'
                    self.send_response(200)
                    self.send_header("Content-Type", "text/css; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                body = altered if self.path == "/alternate" and counts[self.path] == 1 else signed
                if self.path == "/reload": body = mode["reload"]
                if self.path == "/plain": body = payload
                if self.path == "/appended": body = signed + b"<p>Unsigned content</p>"
                if self.path == "/gzip": body = gzip.compress(body)
                self.send_response(200)
                content_type = content_types.get(self.path, "application/xhtml+xml; charset=utf-8" if self.path == "/xml" else "text/html; charset=utf-8")
                if content_type: self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                if self.path == "/gzip": self.send_header("Content-Encoding", "gzip")
                if self.path == "/attachment": self.send_header("Content-Disposition", 'attachment; filename="signed.html"')
                for name, value in header_cases.get(self.path, mode["headers"] if self.path == "/reload" else []):
                    self.send_header(name, value)
                self.end_headers()
                try:
                    for offset in range(0, len(body), 37):
                        self.wfile.write(body[offset:offset + 37])
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def log_message(self, *args): pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        origin = f"http://127.0.0.1:{server.server_port}"
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            driver_port = sock.getsockname()[1]
        driver_log = open(work / "geckodriver.log", "wb")
        driver = subprocess.Popen([geckodriver, "--allow-system-access", "--host", "127.0.0.1", "--port", str(driver_port)], stdout=driver_log, stderr=driver_log, env=env)
        base = f"http://127.0.0.1:{driver_port}"
        session = None

        def api(method, path, body=None):
            request = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    result = json.load(response)
            except urllib.error.HTTPError as error:
                raise RuntimeError(error.read().decode()) from error
            value = result.get("value")
            if isinstance(value, dict) and "error" in value: raise RuntimeError(value)
            return value

        try:
            for _ in range(100):
                try: api("GET", "/status"); break
                except OSError: time.sleep(0.05)
            extension_uuid = str(uuid.uuid4())
            options = {"binary": firefox, "args": ["-headless"], "prefs": {
                "extensions.webextensions.uuids": json.dumps({"attest-web@idril.is": extension_uuid}),
                "network.proxy.type": 0, "browser.shell.checkDefaultBrowser": False,
                "browser.download.folderList": 2, "browser.download.dir": str(work),
                "browser.helperApps.neverAsk.saveToDisk": "text/html,application/octet-stream",
            }}
            session = api("POST", "/session", {"capabilities": {"alwaysMatch": {"browserName": "firefox", "moz:firefoxOptions": options}}})["sessionId"]
            prefix = f"/session/{session}"
            api("POST", prefix + "/moz/addon/install", {"path": str(addon), "temporary": True})
            page_handle = api("GET", prefix + "/window")
            probe_handle = api("POST", prefix + "/window/new", {"type": "tab"})["handle"]
            api("POST", prefix + "/window", {"handle": probe_handle})
            api("POST", prefix + "/url", {"url": f"moz-extension://{extension_uuid}/popup/popup.html"})

            def query(url=None):
                api("POST", prefix + "/window", {"handle": probe_handle})
                script = "const done=arguments[arguments.length-1]; browser.tabs.query({}).then(async tabs=>{const tab=tabs.find(t=>arguments[0] ? t.url===arguments[0] : t.url.startsWith(arguments[1])); if(!tab){done(null);return;} const page=await browser.runtime.sendMessage({type:'get-verification',tabId:tab.id,url:tab.url}); const badge=await browser.browserAction.getBadgeText({tabId:tab.id}); const color=await browser.browserAction.getBadgeBackgroundColor({tabId:tab.id}); const trace=await browser.runtime.sendMessage({type:'test-events'}); done({page,badge,color,trace});}).catch(e=>done({error:String(e)}));"
                return api("POST", prefix + "/execute/async", {"script": script, "args": [url, origin]})

            def check(path, expected=None, green=True):
                api("POST", prefix + "/window", {"handle": page_handle})
                api("POST", prefix + "/url", {"url": origin + path})
                result = None
                for _ in range(100):
                    result = query(origin + path)
                    if result and result.get("page", {}).get("byteSource") == "exact-response": break
                    if expected is None and result and result.get("page", {}).get("result", {}).get("verdict") == "UNKNOWN": break
                    time.sleep(0.05)
                assert result and "page" in result, (path, result)
                verdict = result["page"]["result"]["verdict"]
                if expected:
                    if verdict != expected or expected == "AUTHENTIC" and result["page"].get("responsePolicy", {}).get("allowed") is not green:
                        print(json.dumps([event for event in result["trace"] if event.get("details", {}).get("url") == origin + path], indent=2), flush=True)
                    assert verdict == expected, (path, result)
                    if expected == "AUTHENTIC":
                        assert result["page"].get("responsePolicy", {}).get("allowed") is green, (path, result)
                        assert (result["badge"] == "✓") is green, (path, result)
                        assert (result["color"][:3] == [76, 175, 80]) is green, (path, result)
                        if not green: assert result["color"][:3] == [255, 235, 59], (path, result)
                else: assert verdict != "AUTHENTIC" and result["badge"] != "✓", (path, result)
                observations.append({"path": path, **{k: result[k] for k in ["page", "badge", "color"]}})
                print(path, verdict, result["page"]["byteSource"], "green" if result["badge"] == "✓" else "not green", flush=True)
                return result

            for path in ["/signed", "/gzip", "/xml"]: check(path, "AUTHENTIC")
            for path in [*header_cases, *content_types]:
                check(path, "AUTHENTIC", green=False)
                if path in ["/header-link", "/header-csp-permissive", "/header-csp-restrictive"]:
                    api("POST", prefix + "/window", {"handle": page_handle})
                    display = api("POST", prefix + "/execute/sync", {"script": "const p=document.querySelector('p');return {before:getComputedStyle(p,'::before').content,after:getComputedStyle(p,'::after').content,color:getComputedStyle(p).color,text:p.textContent};", "args": []})
                    if path == "/header-link":
                        assert "UNSIGNED HEADER TEXT" in display["after"] and counts["/unsigned.css"] > 0, display
                        assert display["color"] == "rgb(201, 17, 88)", display
                    if path == "/header-csp-permissive": assert "A & B < C" in display["before"], display
                    if path == "/header-csp-restrictive": assert display["before"] == "none", display
                    observations[-1]["display"] = display
            # Refresh cannot qualify for green before navigation, and the
            # unsigned destination cannot inherit the body's valid signature.
            check("/header-refresh", "AUTHENTIC", green=False)
            for _ in range(100):
                result = query(origin + "/plain")
                if result and result.get("page", {}).get("result", {}).get("verdict") == "UNKNOWN": break
                time.sleep(0.05)
            assert result and result["badge"] != "✓" and result["page"]["result"]["verdict"] == "UNKNOWN", result
            print("/header-refresh destination UNKNOWN", flush=True)
            check("/alternate", "INVALID")
            assert counts["/alternate"] == 1, "Firefox verified a second response instead of delivered bytes"
            check("/appended")
            check("/plain")
            check("/reload", "AUTHENTIC")
            mode["headers"] = [("Link", '</unsigned.css>; rel="stylesheet"')]
            check("/reload", "AUTHENTIC", green=False)
            mode["headers"] = []
            check("/reload", "AUTHENTIC")
            mode["reload"] = altered
            check("/reload", "INVALID")
            # A server redirect must verify the final delivered document.
            for path, target, green in [("/redirect", "/signed", True), ("/redirect-unsupported", "/signed", True), ("/redirect-to-unsupported", "/header-link", False)]:
                api("POST", prefix + "/window", {"handle": page_handle})
                api("POST", prefix + "/url", {"url": origin + path})
                for _ in range(100):
                    result = query(origin + target)
                    if result and result.get("page", {}).get("result", {}).get("verdict") == "AUTHENTIC": break
                    time.sleep(0.05)
                assert result["page"]["result"]["verdict"] == "AUTHENTIC", result
                assert result["page"].get("responsePolicy", {}).get("allowed") is green, result
                assert (result["badge"] == "✓") is green, result
                print(path, "AUTHENTIC", "green" if green else "not green", flush=True)
            check("/signed", "AUTHENTIC")
            check("/plain")
            before = counts["/signed"]
            api("POST", prefix + "/window", {"handle": page_handle})
            api("POST", prefix + "/back", {})
            for _ in range(100):
                result = query(origin + "/signed")
                if result and (counts["/signed"] == before or result.get("page", {}).get("byteSource") == "exact-response"): break
                time.sleep(0.05)
            assert result and "page" in result, result
            if counts["/signed"] == before:
                assert result["page"]["result"]["verdict"] != "AUTHENTIC" and result["badge"] != "✓", result
            else:
                assert result["page"]["result"]["verdict"] == "AUTHENTIC", result
            print("/history", result["page"]["result"]["verdict"], result["page"]["byteSource"], flush=True)
            api("POST", prefix + "/window", {"handle": page_handle})
            api("POST", prefix + "/execute/sync", {"script": "window.location.href=arguments[0]; return null;", "args": [origin + "/attachment"]})
            for _ in range(100):
                if counts["/attachment"]: break
                time.sleep(0.05)
            assert counts["/attachment"], "download request did not start"
            result = query()
            assert result and "page" in result, result
            assert result["page"]["result"]["verdict"] != "AUTHENTIC" and result["badge"] != "✓", result
            print("/attachment UNKNOWN (displayed page not replaced by the signed download)", flush=True)
            report = os.environ.get("ATTEST_SMOKE_REPORT")
            if report: Path(report).write_text(json.dumps(observations, indent=2) + "\n")
            print("Live Firefox response capture and header-policy checks passed.", flush=True)
        except Exception:
            driver_log.flush()
            print((work / "geckodriver.log").read_text(errors="replace")[-6000:])
            raise
        finally:
            if session:
                try: api("DELETE", f"/session/{session}")
                except Exception: pass
            driver.terminate()
            driver.wait(timeout=10)
            driver_log.close()
            server.shutdown()
            subprocess.run(["gpgconf", "--kill", "all"], env=env, check=False)


if __name__ == "__main__": main()
