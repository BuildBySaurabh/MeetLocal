"""Real-browser check of shared meeting notes, translation and download (Chromium, fake devices).

Needs: `npm run dev` and `node scripts/fake-ollama.mjs` (stand-in for Ollama; it is not a real model).
    MEETLOCAL_BASE=http://localhost:5173 python3 -I scripts/e2e-notes.py

A third "participant" (Carol) is a raw WebSocket client inside page A, because real speech recognition
cannot run where the model host is blocked. This proves the relay, the consent rules and the UI, NOT
speech recognition. Own-line recording is covered by unit tests.
"""
import json
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


with sync_playwright() as p:
    args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
    browser = p.chromium.launch(args=args)
    ctxs = [browser.new_context(permissions=["camera", "microphone"], accept_downloads=True, viewport={"width": 1100, "height": 800}) for _ in range(2)]
    a, b = (c.new_page() for c in ctxs)
    errors = []
    for n, pg in (("A", a), ("B", b)):
        pg.on("pageerror", lambda e, n=n: errors.append(f"{n}: {e}"))
    b.add_init_script("window.localStorage.setItem('meetlocal.assistantModel', 'fake-model')")

    a.goto(BASE)
    a.get_by_role("button", name="New meeting").click()
    a.wait_for_url(re.compile(r".*/join/.+"))
    link = a.locator(".link-box__url").inner_text()
    room = link.rsplit("/", 1)[1]
    a.get_by_label("Your name").fill("Alice")
    a.get_by_role("button", name="Start meeting").click()
    wait_text(a, "Waiting for others to join")
    b.goto(link)
    b.get_by_label("Your name").fill("Bob")
    b.get_by_role("button", name="Join meeting").click()
    check("A and B connected", wait_text(a, "Connected") and wait_text(b, "Connected"))

    a.get_by_role("button", name="Notes").click()
    b.get_by_role("button", name="Notes").click()
    check("Notes panel explains local transcription and consent", a.get_by_text("Audio never leaves it", exact=False).count() >= 1)
    check("Sharing switch is disabled until transcription runs", a.get_by_label("Share my lines with everyone in this meeting").is_disabled())
    check("Nobody sharing at first", a.get_by_text("Nobody else is sharing their lines yet.").count() == 1)

    # Carol: a raw client inside A's page (origin localhost:5173 is allowed by the server).
    a.evaluate(
        """([room]) => new Promise((resolve) => {
          const ws = new WebSocket('ws://localhost:8787');
          window.__carol = { ws, got: [] };
          ws.onmessage = (e) => window.__carol.got.push(JSON.parse(e.data));
          ws.onopen = () => { ws.send(JSON.stringify({type:'join', roomId: room, participantId:'carol-carol-carol-3', displayName:'Carol', intent:'join'})); resolve(true); };
        })""",
        [room],
    )
    time.sleep(1.5)
    a.evaluate("window.__carol.ws.send(JSON.stringify({type:'transcript-segment', text:'sneaky before consent'}))")
    time.sleep(0.5)
    err = a.evaluate("window.__carol.got.filter(m => m.type === 'error').map(m => m.code)")
    check("Server refuses lines before sharing is announced", "invalid-message" in err, str(err))
    check("Nobody received the refused line", a.get_by_text("sneaky before consent").count() == 0 and b.get_by_text("sneaky before consent").count() == 0)

    a.evaluate("window.__carol.ws.send(JSON.stringify({type:'transcript-sharing', enabled:true}))")
    check("B is told Carol is sharing", wait_text(b, "Sharing their lines: Carol.", 10000))
    check("A is told Carol is sharing", wait_text(a, "Sharing their lines: Carol.", 10000))
    check("A sees a notice naming Carol", a.get_by_text("Carol is sharing their transcript lines in the meeting notes.").count() == 1)
    a.evaluate("""() => { const w = window.__carol.ws; w.send(JSON.stringify({type:'transcript-segment', text:'We should ship on Friday.'})); w.send(JSON.stringify({type:'transcript-segment', text:'I will update the docs.'})); }""")
    for name, pg in (("A", a), ("B", b)):
        try:
            pg.locator(".notes__line", has_text="I will update the docs.").wait_for(timeout=10000)
            ok = True
        except Exception:
            ok = False
        lines = pg.locator(".notes__line").all_inner_texts()
        check(f"{name} sees Carol's lines with her name, in order", ok and "Carol" in lines[0] and "We should ship on Friday." in lines[0] and "docs" in lines[1], str(lines))
    check("Lines were not echoed to Carol herself", a.evaluate("window.__carol.got.filter(m => m.type === 'transcript-segment').length") == 0)

    # Translation through the (fake) local model server.
    b.get_by_label("Show translation in").select_option("es")
    try:
        b.locator(".notes__translation").first.wait_for(timeout=15000)
        ok = True
    except Exception:
        ok = False
    tr = b.locator(".notes__translation").all_inner_texts()
    check("B sees translations from the local model", ok and tr and tr[0].startswith("[Spanish] We should ship on Friday."), str(tr))
    check("A (translation off) shows no translations", a.locator(".notes__translation").count() == 0)
    b.get_by_label("Show translation in").select_option("")
    check("Turning translation off removes it", b.locator(".notes__translation").count() == 0)

    # Download.
    with b.expect_download() as d:
        b.get_by_role("button", name="Download .txt").click()
    txt = open(d.value.path(), encoding="utf-8").read()
    check("Text download lists lines with names", "Carol: We should ship on Friday." in txt and "Carol: I will update the docs." in txt and d.value.suggested_filename.endswith(".txt"), txt[:200])
    with b.expect_download() as d:
        b.get_by_role("button", name="Download .md").click()
    md = open(d.value.path(), encoding="utf-8").read()
    check("Markdown download groups by speaker", md.startswith("# MeetLocal meeting notes") and "**Carol**" in md and "**Speakers:** Carol" in md and d.value.suggested_filename.endswith(".md"), md[:200])

    # Carol stops sharing / leaves.
    a.evaluate("window.__carol.ws.send(JSON.stringify({type:'transcript-sharing', enabled:false}))")
    check("Sharing status clears", wait_text(b, "Nobody else is sharing their lines yet.", 10000))
    check("Notes stay until cleared", b.locator(".notes__line").count() == 2)
    b.get_by_role("button", name="Clear").click()
    check("Clear empties the notes", b.locator(".notes__line").count() == 0)

    # Shortcut n toggles the panel.
    b.get_by_role("button", name="Close panel").click()
    b.locator("body").click(position={"x": 5, "y": 5})
    b.keyboard.press("n")
    check("Shortcut n opens Notes", b.get_by_role("complementary", name="Meeting notes").count() == 1)
    check("No page errors", not errors, "; ".join(errors[:3]))
    browser.close()

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
