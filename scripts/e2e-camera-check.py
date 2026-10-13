"""Real-browser check of the camera-check UI plumbing (Chromium, fake camera).

Proves: opt-in only, honest disclaimer, the production frame source gets real video frames from the camera,
the WebAssembly runtime is served from this origin, a missing face model gives a clear message and no
third-party request, and nothing about the camera check goes over the signaling socket.
Does NOT prove face detection or any head/eye numbers: those need the face model file
(`npm run fetch:face-model`) and a real face; the fake camera has none.

Usage: servers running (`npm run dev`); then
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 -I scripts/e2e-camera-check.py ./screenshots
"""
import os
import re
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = os.environ.get("MEETLOCAL_BASE", "http://localhost:5173")
OUT = sys.argv[1] if len(sys.argv) > 1 else "screenshots"
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS" if ok else "FAIL"), name, detail, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    ctx = browser.new_context(permissions=["camera", "microphone"], viewport={"width": 1100, "height": 900})
    page = ctx.new_page()
    urls = []
    ws_frames = []
    page.on("request", lambda r: urls.append(r.url))
    page.on("websocket", lambda ws: ws.on("framesent", lambda d: ws_frames.append(str(d))) if ":8787" in ws.url else None)

    page.goto(BASE)
    page.get_by_role("button", name="New meeting").click()
    page.wait_for_url(re.compile(r".*/join/.+"))
    page.get_by_label("Your name").fill("Alice")
    page.get_by_role("button", name="Start meeting").click()
    page.get_by_text("Waiting for others to join", exact=True).wait_for(timeout=15000)

    page.get_by_role("button", name="Camera check").click()
    check("Disclaimer explains limits and privacy before opting in", page.get_by_text("does not measure attention, honesty, effort or ability", exact=False).count() == 1)
    check("Nothing from MediaPipe is requested before opting in", not any("mediapipe" in u or "face_landmarker" in u for u in urls))
    page.screenshot(path=os.path.join(OUT, "15_camera_check_off.png"))

    frames = page.evaluate(
        """async () => {
          const { createVideoFrameSource } = await import('/src/features/eye-tracking/eyeTrackingSession.ts');
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          const source = await createVideoFrameSource(stream);
          await new Promise((r) => setTimeout(r, 800));
          const info = { w: source.video.videoWidth, h: source.video.videoHeight, t: source.video.currentTime };
          source.dispose();
          const live = stream.getVideoTracks().every((t) => t.readyState === 'live');
          stream.getTracks().forEach((t) => t.stop());
          return { ...info, live };
        }"""
    )
    check("Production frame source plays real camera frames", frames["w"] > 0 and frames["t"] > 0, str(frames))
    check("Disposing the frame source leaves the call's camera track alive", frames["live"])

    for f in ("vision_wasm_internal.wasm", "vision_wasm_internal.js"):
        status = urllib.request.urlopen(f"{BASE}/mediapipe/wasm/{f}").status
        check(f"MediaPipe runtime file {f} is served from this origin", status == 200)

    page.get_by_role("button", name="Turn on camera check").click()
    try:
        page.get_by_role("alert").filter(has_text="face model file is not installed").first.wait_for(timeout=15000)
        shown = True
    except Exception as error:
        print(str(error)[:200])
        shown = False
    check("Missing face model shows a clear message with the fix", shown)
    check("A retry button is offered", page.get_by_role("button", name="Try again").count() == 1)
    page.screenshot(path=os.path.join(OUT, "16_camera_check_model_missing.png"))
    check("No request to Google/CDN hosts", not any(("googleapis" in u or "jsdelivr" in u or "unpkg" in u) for u in urls))
    check("Camera check traffic never touches the signaling socket", not any(("landmark" in f.lower() or "gaze" in f.lower()) for f in ws_frames))
    check("The meeting keeps working", page.get_by_role("button", name="Leave").count() == 1)
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
