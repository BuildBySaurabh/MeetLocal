"""Privacy behaviour audit in real Chromium: what leaves the page, and what the signaling server logs.

Usage: build + preview + signaling running (see scripts/e2e-csp.py), then
    SIGNALING_LOG=/path/to/signaling-stdout.log MEETLOCAL_BASE=http://localhost:4173 \\
      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 -I scripts/e2e-privacy-audit.py
Covers a normal call with chat. It does not cover transcription/assistant/camera-check content, which
need real models (see docs/TESTING.md); their no-network behaviour is covered by their own e2e scripts.
"""
import os
import re
import sys
import time
import urllib.parse

from playwright.sync_api import sync_playwright

BASE = os.environ.get("MEETLOCAL_BASE", "http://localhost:4173")
LOG = os.environ.get("SIGNALING_LOG")
MARKER = "PRIVATE-MARKER-" + str(int(time.time()))
APP = urllib.parse.urlparse(BASE).netloc
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS" if ok else "FAIL"), name, detail, flush=True)


def watch(page, store):
    page.on("request", lambda r: store["http"].append((r.method, r.url, r.post_data or "")))
    def on_ws(ws):
        store["ws_urls"].append(ws.url)
        ws.on("framesent", lambda d: store["sent"].append(str(d)))
    page.on("websocket", on_ws)


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    stores = []
    pages = []
    for _ in range(2):
        ctx = browser.new_context(permissions=["camera", "microphone"], viewport={"width": 1100, "height": 800})
        page = ctx.new_page()
        store = {"http": [], "ws_urls": [], "sent": []}
        watch(page, store)
        stores.append(store)
        pages.append(page)
    a, b = pages

    a.goto(BASE)
    a.get_by_role("button", name="New meeting").click()
    a.wait_for_url(re.compile(r".*/join/.+"))
    link = a.url
    room = link.rstrip("/").split("/")[-1]
    a.get_by_label("Your name").fill("Alice")
    a.get_by_role("button", name="Start meeting").click()
    a.get_by_text("Waiting for others to join", exact=True).wait_for(timeout=15000)
    b.goto(link)
    b.get_by_label("Your name").fill("Bob")
    b.get_by_role("button", name="Join meeting").click()
    a.get_by_text("Connected", exact=True).wait_for(timeout=30000)
    b.get_by_text("Connected", exact=True).wait_for(timeout=30000)

    a.get_by_role("button", name="Chat").click()
    a.get_by_label("Chat message", exact=True).fill(MARKER)
    a.get_by_role("button", name="Send").click()
    b.get_by_role("button", name="Chat").click()
    b.get_by_text(MARKER).wait_for(timeout=10000)
    time.sleep(1)

    for label, store in zip(("A", "B"), stores):
        hosts = {urllib.parse.urlparse(u).netloc for _, u, _ in store["http"] if u.startswith("http")}
        ws_hosts = {urllib.parse.urlparse(u).netloc for u in store["ws_urls"]}
        check(f"{label}: HTTP requests only go to the app's own origin", hosts <= {APP}, str(hosts))
        check(f"{label}: the only WebSocket is the signaling server", ws_hosts == {"localhost:8787"}, str(ws_hosts))
        leaked = [u for _, u, body in store["http"] if MARKER in u or MARKER in body or room in body]
        check(f"{label}: no chat text or room ID in any HTTP request body/URL", not leaked, str(leaked[:1]))

    a_chat_frames = [f for f in stores[0]["sent"] if MARKER in f]
    check("Chat text was sent only as a signaling WebSocket frame (as documented)", len(a_chat_frames) == 1)
    check("No media (SDP/ICE aside) or transcript content in signaling frames", not any(('"transcript"' in f or "landmark" in f.lower() or "gaze" in f.lower()) for s in stores for f in s["sent"]))

    storage = a.evaluate("() => JSON.stringify({...localStorage})")
    check("Chat text is not written to localStorage", MARKER not in storage, storage[:120])
    idb = a.evaluate(
        """async () => {
          const dbs = indexedDB.databases ? await indexedDB.databases() : [];
          return dbs.map(d => d.name);
        }"""
    )
    check("No IndexedDB database holds chat (only transcript/assistant stores may exist, and only after use)", all(n in ("meetlocal-transcripts", "meetlocal-assistant") for n in idb), str(idb))
    browser.close()

if LOG and os.path.exists(LOG):
    text = open(LOG, errors="replace").read()
    check("Signaling server log contains neither the chat text nor the room ID", MARKER not in text and room not in text, f"{len(text)} bytes of log")
else:
    print("SKIP signaling log check (set SIGNALING_LOG)")

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
