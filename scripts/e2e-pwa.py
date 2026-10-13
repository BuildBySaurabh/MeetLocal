"""PWA check on the PRODUCTION build (service workers are registered only in production).

    npm run build; npm run preview -w @meetlocal/web   # port 4173
    MEETLOCAL_BASE=http://localhost:4173 python3 -I scripts/e2e-pwa.py
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("MEETLOCAL_BASE", "http://localhost:4173")
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, detail, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context()
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(BASE)
    page.get_by_role("button", name="New meeting").wait_for()

    link = page.evaluate("document.querySelector('link[rel=manifest]')?.href")
    check("Page links a manifest", link and link.endswith("/manifest.webmanifest"), str(link))
    m = page.evaluate("fetch('/manifest.webmanifest').then(r => r.json())")
    check("Manifest is installable-shaped", m["display"] == "standalone" and m["start_url"] == "/" and any(i["sizes"] == "512x512" for i in m["icons"]))
    for icon in m["icons"]:
        r = page.evaluate("src => fetch(src).then(r => [r.status, r.headers.get('content-type')])", icon["src"])
        check(f"Icon {icon['src']} is served as an image", r[0] == 200 and r[1].startswith("image/"), str(r))

    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    page.reload()
    page.get_by_role("button", name="New meeting").wait_for()
    check("Service worker controls the page", page.evaluate("!!navigator.serviceWorker.controller"))
    keys = page.evaluate("caches.keys()")
    check("Only the shell cache exists", keys == ["meetlocal-shell-v1"], str(keys))

    ctx.set_offline(True)
    page.reload()
    ok = True
    try:
        page.get_by_role("button", name="New meeting").wait_for(timeout=10000)
    except Exception:
        ok = False
    check("App shell opens while offline", ok)
    cached = page.evaluate("caches.open('meetlocal-shell-v1').then(c => c.keys()).then(k => k.map(r => new URL(r.url).pathname))")
    check("Nothing from /ort, /models or /mediapipe is cached", not any(c.startswith(("/ort", "/models", "/mediapipe")) for c in cached), str(cached))
    ctx.set_offline(False)
    check("No console or page errors", not [e for e in errors if "Failed to load resource" not in e], "; ".join(errors[:3]))
    browser.close()

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
