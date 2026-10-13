"""Real four-browser group call check (Chromium with fake camera/mic), full mesh.

Usage (servers running): MEETLOCAL_BASE=http://localhost:5173 python3 -I scripts/e2e-group-call.py
"""
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("MEETLOCAL_BASE", "http://localhost:5173")
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, detail, flush=True)


def wait_text(page, text, timeout=30000):
    try:
        page.get_by_text(text, exact=True).first.wait_for(timeout=timeout)
        return True
    except Exception:
        return False


def info(page, label):
    return page.evaluate(
        """(label) => { const v = document.querySelector(`video[aria-label="${label}"]`);
          if (!v || !v.srcObject) return null;
          return {w: v.videoWidth, t: v.currentTime, audio: v.srcObject.getAudioTracks().length}; }""",
        label,
    )


NAMES = ["Alice", "Bob", "Carol", "Dave"]
with sync_playwright() as p:
    args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
    browser = p.chromium.launch(args=args)
    pages, logs = [], []
    for n in NAMES + ["Eve"]:
        ctx = browser.new_context(permissions=["camera", "microphone"], viewport={"width": 1100, "height": 760})
        pg = ctx.new_page()
        pg.on("console", lambda m, n=n: logs.append(f"{n} {m.type}: {m.text}") if m.type == "error" else None)
        pg.on("pageerror", lambda e, n=n: logs.append(f"{n} pageerror: {e}"))
        pages.append(pg)

    a = pages[0]
    a.goto(BASE)
    a.get_by_role("button", name="New meeting").click()
    a.wait_for_url(re.compile(r".*/join/.+"))
    link = a.locator(".link-box__url").inner_text()
    a.get_by_role("button", name="Turn on camera and microphone").click()
    a.get_by_text("Ready", exact=True).first.wait_for(timeout=10000)
    a.get_by_label("Your name").fill("Alice")
    a.get_by_role("button", name="Start meeting").click()
    check("Alice is waiting alone", wait_text(a, "Waiting for others to join"))

    for pg, name in zip(pages[1:4], NAMES[1:]):
        pg.goto(link)
        pg.get_by_label("Your name").fill(name)
        pg.get_by_role("button", name="Join meeting").click()
        check(f"{name} reaches Connected", wait_text(pg, "Connected"))
    time.sleep(4)

    for pg, me in zip(pages[:4], NAMES):
        for other in NAMES:
            if other == me:
                continue
            v = info(pg, f"{other} video")
            check(f"{me} receives {other}'s video and audio", v and v["w"] > 0 and v["audio"] == 1, str(v))
    pages[0].screenshot(path=os.path.join(os.environ.get("OUT", "."), "group_A.png"))
    check("Alice sees 4 tiles", a.locator(".video-grid .tile").count() == 4)

    # Fifth person is refused.
    e = pages[4]
    e.goto(link)
    e.get_by_label("Your name").fill("Eve")
    e.get_by_role("button", name="Join meeting").click()
    check("Fifth participant is refused", wait_text(e, "This meeting is full", 15000))
    check("Call unaffected by refused joiner", wait_text(a, "Connected", 5000))

    # Chat reaches everyone, with the right name.
    a.get_by_role("button", name="Chat").click()
    a.get_by_label("Chat message").fill("hello everyone")
    a.get_by_role("button", name="Send").click()
    for pg, name in zip(pages[1:4], NAMES[1:]):
        pg.get_by_role("button", name="Chat").click()
        pg.get_by_text("hello everyone").first.wait_for(timeout=10000)
        check(f"{name} receives chat from Alice", pg.locator(".chat__msg", has_text="Alice").count() == 1)

    # Dave leaves; the others stay connected with 3 tiles.
    pages[3].get_by_role("button", name="Leave").click()
    time.sleep(2)
    check("Alice drops to 3 tiles", a.locator(".video-grid .tile").count() == 3)
    check("Alice still Connected", wait_text(a, "Connected", 5000))
    v = info(pages[1], "Carol video")
    t1 = v["t"]
    time.sleep(1.5)
    v2 = info(pages[1], "Carol video")
    check("Bob still receives advancing video from Carol", v2 and v2["t"] > t1, f"{t1}->{v2 and v2['t']}")

    bad = [l for l in logs if "WebSocket" not in l]
    check("No console errors", not bad, "; ".join(bad[:3]))
    browser.close()

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
