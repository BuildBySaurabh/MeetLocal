"""Checks the production build under its Content-Security-Policy (vite preview) in real Chromium.

Usage:
    npm run build
    ALLOWED_ORIGINS=http://localhost:4173 npm run dev:signaling      # signaling must allow the preview origin
    npm run preview -w @meetlocal/web                                # http://localhost:4173
    MEETLOCAL_BASE=http://localhost:4173 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 -I scripts/e2e-csp.py
"""
import os
import re
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("MEETLOCAL_BASE", "http://localhost:4173")
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS" if ok else "FAIL"), name, detail, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    ctx = browser.new_context(permissions=["camera", "microphone"], viewport={"width": 1100, "height": 800})
    page = ctx.new_page()
    violations = []
    page.on("console", lambda m: violations.append(m.text) if "Content Security Policy" in m.text or "Refused to" in m.text else None)

    response = page.goto(BASE)
    headers = {k.lower(): v for k, v in response.headers.items()}
    csp = headers.get("content-security-policy", "")
    check("CSP header present with the key directives", all(d in csp for d in ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "worker-src 'self' blob:"]), csp[:80])
    check("No inline-script allowance in the CSP", "unsafe-inline" not in csp.split("script-src")[1].split(";")[0] and "unsafe-eval'" not in csp.replace("wasm-unsafe-eval", ""))
    check("Other security headers present", headers.get("x-content-type-options") == "nosniff" and headers.get("referrer-policy") == "no-referrer" and "camera=(self)" in headers.get("permissions-policy", ""))

    page.get_by_role("button", name="New meeting").click()
    page.wait_for_url(re.compile(r".*/join/.+"))
    page.get_by_label("Your name").fill("Alice")
    page.get_by_role("button", name="Turn on camera and microphone").click()
    page.get_by_text("Ready", exact=True).first.wait_for(timeout=10000)
    page.get_by_role("button", name="Start meeting").click()
    page.get_by_text("Waiting for others to join", exact=True).wait_for(timeout=15000)
    check("Meeting page loads and signaling connects under the CSP", True)

    page.get_by_role("button", name="Devices").click()
    page.get_by_role("meter", name="Microphone level").wait_for()
    page.wait_for_timeout(500)
    check("Microphone level meter (Web Audio) works under the CSP", True)

    page.get_by_role("button", name="Transcript").click()
    page.get_by_role("button", name="Start transcription").click()
    try:
        page.get_by_role("alert").filter(has_text="speech model could not be loaded").first.wait_for(timeout=60000)
        ok = True
    except Exception:
        ok = False
    check("Transcription worker starts under the CSP (and reports the unreachable model)", ok)

    worklet = page.evaluate(
        """async () => {
          try {
            const ctx = new AudioContext();
            const url = URL.createObjectURL(new Blob(['registerProcessor("t", class extends AudioWorkletProcessor { process(){ return true } })'], { type: 'application/javascript' }));
            await ctx.audioWorklet.addModule(url);
            await ctx.close();
            return 'ok';
          } catch (e) { return String(e); }
        }"""
    )
    check("Blob AudioWorklet (used for transcription capture) is allowed", worklet == "ok", worklet)
    wasm = page.evaluate(
        """async () => {
          try {
            const bytes = new Uint8Array([0,97,115,109,1,0,0,0]);
            await WebAssembly.instantiate(bytes);
            return 'ok';
          } catch (e) { return String(e); }
        }"""
    )
    check("WebAssembly is allowed (speech and face models)", wasm == "ok", wasm)
    inline = page.evaluate(
        """() => new Promise((resolve) => {
          const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.appendChild(s);
          setTimeout(() => resolve(window.__inline === 1), 200);
        })"""
    )
    check("Injected inline script is blocked", inline is False)
    page.screenshot(path=os.path.join(os.environ.get("OUT", "/tmp"), "csp_meeting.png"))
    unexpected = [v for v in violations if "inline" not in v.lower()]
    check("No CSP violations other than the deliberate inline-script probe", not unexpected, str(unexpected[:2]))
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
