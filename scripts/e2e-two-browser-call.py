"""Real two-browser WebRTC check for MeetLocal (Chromium with fake camera/mic).

Usage (servers must be running: `npm run dev`):
    pip install playwright && playwright install chromium
    python3 scripts/e2e-two-browser-call.py ./screenshots
"""
import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("MEETLOCAL_BASE", "http://localhost:5173")
OUT = sys.argv[1] if len(sys.argv) > 1 else "screenshots"
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS" if ok else "FAIL"), name, detail, flush=True)


def wait_text(page, text, timeout=20000):
    try:
        page.get_by_text(text, exact=True).first.wait_for(timeout=timeout)
        return True
    except Exception:
        return False


def remote_video_info(page, label):
    return page.evaluate(
        """(label) => {
          const v = document.querySelector(`video[aria-label="${label}"]`);
          if (!v || !v.srcObject) return null;
          return {
            w: v.videoWidth, h: v.videoHeight, t: v.currentTime, paused: v.paused,
            audio: v.srcObject.getAudioTracks().length, video: v.srcObject.getVideoTracks().length,
          };
        }""",
        label,
    )


with sync_playwright() as p:
    fake = [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
    ]
    browser = p.chromium.launch(args=fake)
    ctx_a = browser.new_context(permissions=["camera", "microphone"], viewport={"width": 1100, "height": 760})
    ctx_b = browser.new_context(permissions=["camera", "microphone"], viewport={"width": 1100, "height": 760})
    a, b = ctx_a.new_page(), ctx_b.new_page()
    logs = {"A": [], "B": []}
    a.on("console", lambda m: logs["A"].append(f"{m.type}: {m.text}"))
    b.on("console", lambda m: logs["B"].append(f"{m.type}: {m.text}"))
    a.on("pageerror", lambda e: logs["A"].append(f"pageerror: {e}"))
    b.on("pageerror", lambda e: logs["B"].append(f"pageerror: {e}"))

    # --- A creates a meeting ---
    a.goto(BASE)
    a.get_by_role("button", name="New meeting").click()
    a.wait_for_url(re.compile(r".*/join/.+"))
    link = a.locator(".link-box__url").inner_text()
    check("A sees a shareable link", re.search(r"/join/[A-Za-z0-9_-]{22}$", link) is not None, link)
    a.get_by_role("button", name="Turn on camera and microphone").click()
    a.get_by_text("Ready", exact=True).first.wait_for(timeout=10000)
    check("A preview shows camera+mic ready", a.get_by_text("Ready", exact=True).count() == 2)
    a.screenshot(path=os.path.join(OUT, "01_join_preview.png"))
    a.get_by_label("Your name").fill("Alice")
    a.get_by_role("button", name="Start meeting").click()
    check("A is waiting alone", wait_text(a, "Waiting for others to join"))

    # --- B joins from the link ---
    b.goto(link)
    b.get_by_label("Your name").fill("Bob")
    b.get_by_role("button", name="Join meeting").click()

    check("A reaches Connected", wait_text(a, "Connected", 30000))
    check("B reaches Connected", wait_text(b, "Connected", 30000))
    time.sleep(2)

    va, vb = remote_video_info(a, "Bob video"), remote_video_info(b, "Alice video")
    print("A sees Bob:", va, "| B sees Alice:", vb)
    check("A receives Bob's video frames", va and va["w"] > 0 and va["video"] == 1, str(va))
    check("B receives Alice's video frames", vb and vb["w"] > 0 and vb["video"] == 1, str(vb))
    check("Both receive audio tracks", va and vb and va["audio"] == 1 and vb["audio"] == 1)
    time.sleep(1.5)
    va2 = remote_video_info(a, "Bob video")
    check("Remote video is advancing (playing)", va2 and va2["t"] > va["t"] and not va2["paused"], f"{va['t']} -> {va2['t']}")
    check("Names shown on both sides", a.get_by_label("Bob").count() >= 1 and b.get_by_label("Alice").count() >= 1)
    a.screenshot(path=os.path.join(OUT, "02_meeting_connected_A.png"))
    b.screenshot(path=os.path.join(OUT, "03_meeting_connected_B.png"))

    # --- Controls ---
    a.get_by_role("button", name="Mute").click()
    check("Mute toggles to Unmute", a.get_by_role("button", name="Unmute").count() == 1)
    a.get_by_role("button", name="Stop video").click()
    check("Camera toggles to Start video", a.get_by_role("button", name="Start video").count() == 1)
    local_enabled = a.evaluate(
        """() => { const v=document.querySelector('video[aria-label="Alice (you) video"]'); return v ? v.srcObject.getTracks().map(t=>[t.kind,t.enabled]) : null }"""
    )
    check("Local tracks actually disabled", local_enabled and all(not e for _, e in local_enabled), str(local_enabled))
    a.get_by_role("button", name="Unmute").click()
    a.get_by_role("button", name="Start video").click()

    # --- Keyboard shortcuts ---
    a.locator("body").click(position={"x": 5, "y": 5})
    a.keyboard.press("m")
    check("Shortcut m mutes", a.get_by_role("button", name="Unmute").count() == 1)
    a.keyboard.press("m")
    check("Shortcut m unmutes", a.get_by_role("button", name="Mute").count() == 1)
    a.keyboard.press("c")
    check("Shortcut c opens chat", a.get_by_label("Chat message").count() == 1)
    a.get_by_label("Chat message").click()
    a.keyboard.type("mvsc")
    check("Shortcuts are inert while typing", a.get_by_label("Chat message").input_value() == "mvsc" and a.get_by_role("button", name="Mute").count() == 1)
    a.get_by_label("Chat message").fill("")
    a.keyboard.press("Escape")
    a.keyboard.press("?")
    check("Shortcut ? opens the help dialog", a.get_by_role("dialog", name="Keyboard shortcuts").count() == 1)
    a.keyboard.press("Escape")
    check("Escape closes the help dialog", a.get_by_role("dialog").count() == 0)

    # --- B leaves; A returns to waiting ---
    b.get_by_role("button", name="Leave").click()
    check("A returns to waiting after B leaves", wait_text(a, "Waiting for others to join", 15000))
    tracks_stopped = b.evaluate("() => document.querySelectorAll('video').length")
    check("B left the meeting page", tracks_stopped == 0 or b.url.rstrip('/') == BASE)

    # --- B rejoins: a fresh call is established ---
    b.goto(link)
    b.get_by_label("Your name").fill("Bob")
    b.get_by_role("button", name="Join meeting").click()
    check("Rejoin: A reconnects", wait_text(a, "Connected", 30000))
    check("Rejoin: B reconnects", wait_text(b, "Connected", 30000))

    # --- Phase 3: chat, media state, screen share, devices, refresh, viewer ---
    a.get_by_role("button", name="Chat").click()
    a.get_by_label("Chat message").fill("hello from Alice")
    a.get_by_role("button", name="Send").click()
    b.locator(".toolbar__badge").first.wait_for(timeout=10000)
    check("B sees an unread chat badge", b.locator(".toolbar__badge").first.inner_text() == "1")
    b.get_by_role("button", name="Chat").click()
    check("B receives Alice's chat message", b.get_by_text("hello from Alice").count() == 1)
    b.get_by_label("Chat message").fill("<b>hi</b> from Bob")
    b.get_by_role("button", name="Send").click()
    check("A receives Bob's chat message as plain text", wait_text(a, "<b>hi</b> from Bob") or a.get_by_text("<b>hi</b> from Bob").count() == 1)
    a.screenshot(path=os.path.join(OUT, "07_chat.png"))

    a.get_by_role("button", name="People").click()
    check("People list shows both participants", a.get_by_label("Participants").locator("li").count() == 2)
    a.get_by_role("button", name="Stop video").click()
    try:
        b.locator(".tile__placeholder", has_text="Camera off").first.wait_for(timeout=8000)
        camera_off_seen = True
    except Exception:
        camera_off_seen = False
    check("B sees Alice's camera-off state", camera_off_seen)
    a.get_by_role("button", name="Start video").click()

    a.get_by_role("button", name="Share screen").click()
    try:
        a.get_by_role("button", name="Stop sharing").wait_for(timeout=8000)
        sharing = True
    except Exception:
        sharing = False
    check("A can start screen sharing (stop control appears)", sharing)
    if sharing:
        time.sleep(2)
        info = remote_video_info(b, "Alice video")
        check("B receives the shared screen via track replacement", info and info["w"] > 0, str(info))
        b.screenshot(path=os.path.join(OUT, "08_screen_share_B.png"))
        a.get_by_role("button", name="Stop sharing").click()
        check("A can stop sharing", a.get_by_role("button", name="Share screen").count() == 1)
        check("Call stays connected after sharing", wait_text(a, "Connected", 5000) and wait_text(b, "Connected", 5000))

    a.get_by_role("button", name="Devices").click()
    mic_options = a.locator("#device-microphone option").count()
    cam_options = a.locator("#device-camera option").count()
    check("Device lists are populated", mic_options >= 1 and cam_options >= 1, f"mics={mic_options} cams={cam_options}")
    check("Mic level meter is shown", a.get_by_role("meter", name="Microphone level").count() == 1)
    if mic_options >= 2:
        values = a.locator("#device-microphone option").evaluate_all("els => els.map(e => e.value)")
        current = a.locator("#device-microphone").input_value()
        other = next(v for v in values if v != current)
        a.locator("#device-microphone").select_option(other)
        time.sleep(1.5)
        check("Switching microphone keeps the call connected", wait_text(a, "Connected", 5000) and a.locator("#device-microphone").input_value() == other)
    a.screenshot(path=os.path.join(OUT, "09_devices_panel.png"))

    # Refresh: A reloads and rejoins the same meeting.
    a.reload()
    check("After refresh A returns to the call", wait_text(a, "Connected", 30000) and wait_text(b, "Connected", 30000))

    # Viewer with no camera or microphone can still see and hear.
    ctx_v = browser.new_context(viewport={"width": 1100, "height": 760})
    ctx_v.add_init_script("navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('none', 'NotFoundError'))")
    v = ctx_v.new_page()
    # Make room: Bob leaves, then the device-less viewer joins Alice.
    b.get_by_role("button", name="Leave").click()
    wait_text(a, "Waiting for others to join", 15000)
    v.goto(link)
    v.get_by_label("Your name").fill("Viewer")
    v.get_by_role("button", name="Join meeting").click()
    check("Viewer without devices connects", wait_text(v, "Connected", 30000))
    time.sleep(2)
    vv = remote_video_info(v, "Alice video")
    check("Viewer receives Alice's video without sending any", vv and vv["w"] > 0, str(vv))
    v.screenshot(path=os.path.join(OUT, "10_viewer_no_devices.png"))
    ctx_v.close()

    # --- Unknown room ---
    ctx_d = browser.new_context(permissions=["camera", "microphone"])
    d = ctx_d.new_page()
    d.goto(f"{BASE}/join/{'Z' * 22}")
    d.get_by_label("Your name").fill("Dave")
    d.get_by_role("button", name="Join meeting").click()
    check("Unknown room shows 'Meeting not found'", wait_text(d, "Meeting not found") or d.get_by_role("heading", name="Meeting not found").count() == 1)
    d.screenshot(path=os.path.join(OUT, "05_not_found.png"))
    ctx_d.close()

    # --- Signaling server down: clear error ---
    ctx_a_page_logs = list(logs["A"])
    browser.close()

    # --- Permission denied (no fake UI flag, no permission granted) ---
    browser2 = p.chromium.launch(args=["--use-fake-device-for-media-stream"])
    ctx_e = browser2.new_context()
    # Headless Chromium has no permission prompt (it returns NotSupportedError), so simulate what
    # real browsers return when the user clicks "Block".
    ctx_e.add_init_script("navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))")
    e = ctx_e.new_page()
    e.goto(f"{BASE}/join/{'Y' * 22}")
    e.get_by_role("button", name="Turn on camera and microphone").click()
    got_alert = False
    try:
        e.get_by_role("alert").first.wait_for(timeout=10000)
        got_alert = True
    except Exception:
        pass
    alert_text = e.get_by_role("alert").first.inner_text() if got_alert else ""
    check("Denied permission shows a clear message", got_alert and re.search(r"blocked|access", alert_text, re.I) is not None, alert_text.replace("\n", " "))
    e.screenshot(path=os.path.join(OUT, "06_permission_denied.png"))
    browser2.close()

print()
print("console errors/warnings during call:")
for who, entries in logs.items():
    for line in entries:
        if line.startswith(("error", "pageerror", "warning")):
            print(" ", who, line[:200])

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
