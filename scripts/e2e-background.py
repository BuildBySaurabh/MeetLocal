"""Real-browser check of the background effect pipeline (Chromium, fake camera).

    npm run dev   # then:
    MEETLOCAL_BASE=http://localhost:5173 python3 -I scripts/e2e-background.py

Uses the production BackgroundProcessor with a SYNTHETIC segmenter (the left half of the picture is
"person", the right half is "background"), because the real model cannot be downloaded where this
runs. It proves the rendering (blur, solid replacement, cut-out edge), that the output is a live video
track, and the model-missing message. It does NOT prove the quality of real segmentation.
Also checks the Background panel UI in a call.
"""
import os
import re
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("MEETLOCAL_BASE", "http://localhost:5173")
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, detail, flush=True)


JS = """
async (modeJson) => {
  const { BackgroundProcessor } = await import('/src/features/background/backgroundProcessor.ts');
  const mode = JSON.parse(modeJson);
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  const source = stream.getVideoTracks()[0];
  const synthetic = {
    async load() {},
    dispose() {},
    segment() {
      const w = 64, h = 48, alpha = new Uint8ClampedArray(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) alpha[y * w + x] = x < w / 2 ? 255 : 0;
      return { width: w, height: h, alpha };
    },
  };
  const events = [];
  const proc = new BackgroundProcessor(() => synthetic);
  const out = proc.start(source, mode, (e) => events.push(e.type));
  await new Promise((r) => setTimeout(r, 1500));
  // Read the output through a video element, like a remote peer would.
  const v = document.createElement('video'); v.muted = true; v.srcObject = new MediaStream([out]); await v.play();
  await new Promise((r) => setTimeout(r, 800));
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  const ctx = c.getContext('2d'); ctx.drawImage(v, 0, 0);
  const px = (x, y) => Array.from(ctx.getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data.slice(0, 3));
  // Roughness: mean absolute difference of horizontal neighbours in a region (sharp > blurred > flat).
  const rough = (x0, x1) => {
    const d = ctx.getImageData(Math.floor(c.width * x0), 0, Math.floor(c.width * (x1 - x0)), c.height).data;
    const w = Math.floor(c.width * (x1 - x0)); let s = 0, n = 0;
    for (let i = 0; i + 4 < d.length; i += 4) { if (((i / 4) % w) === w - 1) continue; s += Math.abs(d[i+1] - d[i+5]); n++; }
    return s / n;
  };
  const info = { w: c.width, h: c.height, live: out.readyState, events, left: px(0.2, 0.5), right: px(0.8, 0.5), leftRough: rough(0.05, 0.4), rightRough: rough(0.6, 0.95) };
  // Raw camera for comparison.
  const raw = document.createElement('video'); raw.muted = true; raw.srcObject = new MediaStream([source]); await raw.play();
  await new Promise((r) => setTimeout(r, 300));
  const rc = document.createElement('canvas'); rc.width = raw.videoWidth; rc.height = raw.videoHeight;
  const rctx = rc.getContext('2d'); rctx.drawImage(raw, 0, 0);
  info.rawLeft = Array.from(rctx.getImageData(Math.floor(rc.width * 0.2), Math.floor(rc.height * 0.5), 1, 1).data.slice(0, 3));
  proc.stop();
  info.stoppedState = out.readyState;
  stream.getTracks().forEach((t) => t.stop());
  return info;
}
"""


def close(a, b, tol=14):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    ctx = browser.new_context(permissions=["camera", "microphone"], viewport={"width": 1100, "height": 800})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE)

    import json
    none = page.evaluate(JS, json.dumps({"kind": "none"}))
    check("Output is a live video track with the camera's size", none["live"] == "live" and none["w"] >= 320, f"{none['w']}x{none['h']}")
    check("Segmenter reports ready", none["events"] == ["ready"], str(none["events"]))
    check("No effect passes the camera picture through", close(none["left"], none["rawLeft"], 40), f"{none['left']} vs {none['rawLeft']}")
    check("Stopping ends the output track", none["stoppedState"] == "ended")

    mini = page.evaluate(JS, json.dumps({"kind": "minimal", "preset": "slate"}))
    check("Minimal: background side is the preset colour", close(mini["right"], [0x24, 0x2c, 0x38], 22), str(mini["right"]))
    check("Minimal: background side is flat (no camera detail)", mini["rightRough"] < 1.5, f"{mini['rightRough']:.2f}")
    check("Minimal: person side still shows the camera", close(mini["left"], mini["rawLeft"], 40), f"{mini['left']} vs {mini['rawLeft']}")

    blur = page.evaluate(JS, json.dumps({"kind": "blur", "strength": "strong"}))
    check("Blur: background side is smoother than the person side", blur["rightRough"] < blur["leftRough"], f"{blur['rightRough']:.2f} < {blur['leftRough']:.2f}")
    check("Blur: person side stays sharp, like the unprocessed picture", close(blur["left"], blur["rawLeft"], 40))

    # Missing model: the real segmenter against this server (no model file there).
    msg = page.evaluate("""async () => {
      const { BackgroundProcessor } = await import('/src/features/background/backgroundProcessor.ts');
      const { createMediaPipeSegmenter, getSegmenterConfig } = await import('/src/features/background/personSegmenter.ts');
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const proc = new BackgroundProcessor(() => createMediaPipeSegmenter(getSegmenterConfig({})));
      const ev = await new Promise((resolve) => { proc.start(stream.getVideoTracks()[0], { kind: 'blur', strength: 'light' }, resolve); });
      proc.stop(); stream.getTracks().forEach((t) => t.stop());
      return ev;
    }""")
    check("Missing model gives a clear message", msg["type"] == "unavailable" and "fetch:segmenter-model" in msg["message"], str(msg))

    # UI inside a call.
    page.goto(BASE)
    page.get_by_role("button", name="New meeting").click()
    page.wait_for_url(re.compile(r".*/join/.+"))
    page.get_by_label("Your name").fill("Alice")
    page.get_by_role("button", name="Start meeting").click()
    page.get_by_text("Waiting for others to join", exact=True).wait_for(timeout=15000)
    page.get_by_role("button", name="Background").click()
    check("Background panel offers none, two blurs and five minimal backgrounds", page.get_by_role("radio").count() == 8)
    check("'None' is selected by default", page.get_by_role("radio", name="None").get_attribute("aria-checked") == "true")
    page.get_by_role("radio", name="Light blur").click()
    try:
        page.get_by_role("alert").filter(has_text="fetch:segmenter-model").first.wait_for(timeout=15000)
        shown = True
    except Exception:
        shown = False
    check("Without the model file the panel explains how to get it", shown)
    check("...and falls back to no effect", page.get_by_role("radio", name="None").get_attribute("aria-checked") == "true")
    check("Own video tile still shows the camera", page.locator('video[aria-label="Alice (you) video"]').evaluate("v => v.videoWidth > 0"))
    page.keyboard.press("Escape")
    page.locator("body").click(position={"x": 5, "y": 5})
    page.keyboard.press("b")
    check("Shortcut b opens Background", page.get_by_role("complementary", name="Background").count() == 1)
    check("No page errors", not errors, "; ".join(errors[:3]))
    browser.close()

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
