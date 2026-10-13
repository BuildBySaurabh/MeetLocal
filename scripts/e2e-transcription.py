"""Real-browser check of the transcription UI and audio capture (Chromium, fake microphone).

Usage (servers running: `npm run dev`):
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 -I scripts/e2e-transcription.py ./screenshots

What this proves: the opt-in flow, real microphone capture through an AudioWorklet at 16 kHz, that the
worker starts and reports a missing model clearly when the model host cannot be reached, and that no
transcript text goes to the signaling server. What it does NOT prove: real speech recognition, which needs
the model download (about 40 MB from huggingface.co) and cannot run where that host is blocked.
"""
import os
import re
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("MEETLOCAL_BASE", "http://localhost:5173")
OUT = sys.argv[1] if len(sys.argv) > 1 else "screenshots"
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS" if ok else "FAIL"), name, detail, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(
        args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
    )
    ctx = browser.new_context(permissions=["camera", "microphone"], viewport={"width": 1100, "height": 760})
    page = ctx.new_page()
    ws_frames = []
    # Only the signaling socket (port 8787); the Vite dev server has its own HMR socket.
    page.on("websocket", lambda ws: ws.on("framesent", lambda payload: ws_frames.append(str(payload))) if ":8787" in ws.url else None)
    requests = []
    page.on("request", lambda r: requests.append(r.url))

    page.goto(BASE)
    page.get_by_role("button", name="New meeting").click()
    page.wait_for_url(re.compile(r".*/join/.+"))
    page.get_by_label("Your name").fill("Alice")
    page.get_by_role("button", name="Start meeting").click()
    page.get_by_text("Waiting for others to join", exact=True).wait_for(timeout=15000)

    page.get_by_role("button", name="Transcript").click()
    check("Transcript panel explains local processing before anything starts", page.get_by_text("Transcription is off.").count() == 1)
    check("Nothing is transcribed or downloaded before opting in", not any("whisper" in u or "huggingface" in u or "/ort/" in u for u in requests))
    page.screenshot(path=os.path.join(OUT, "11_transcript_off.png"))

    # Real microphone capture through the production audio module (AudioWorklet, 16 kHz).
    stats = page.evaluate(
        """async () => {
          const { startAudioCapture } = await import('/src/features/transcription/audioCapture.ts');
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          let samples = 0, peak = 0;
          const capture = await startAudioCapture(stream, (s) => { samples += s.length; for (const v of s) peak = Math.max(peak, Math.abs(v)); });
          await new Promise((r) => setTimeout(r, 3000));
          capture.stop();
          stream.getTracks().forEach((t) => t.stop());
          return { samples, peak };
        }"""
    )
    check("Real microphone capture delivers ~16 kHz audio", 30000 < stats["samples"] < 60000, str(stats))
    check("Captured audio contains signal (fake mic beeps)", stats["peak"] > 0.01, str(stats))

    page.get_by_role("button", name="Start transcription").click()
    try:
        page.get_by_role("alert").filter(has_text="speech model could not be loaded").first.wait_for(timeout=60000)
        shown = True
    except Exception as error:
        print(str(error)[:300])
        shown = False
    check("Unreachable model host gives a clear 'model could not be loaded' message", shown)
    check("A retry button is offered and the page is still responsive", page.get_by_role("button", name="Try again").count() == 1)
    page.screenshot(path=os.path.join(OUT, "12_transcript_model_unavailable.png"))
    hits = [f[:120] for f in ws_frames if "transcript" in f.lower()]
    check("No transcript content was sent to the signaling server", not hits, str(hits) or f"{len(ws_frames)} frames")
    check("The ONNX runtime was requested from this origin, not a CDN", not any("jsdelivr" in u or "unpkg" in u for u in requests))
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
