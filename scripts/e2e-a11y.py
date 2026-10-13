"""Accessibility and narrow-screen check with axe-core in real Chromium.

Usage: servers running (preview or dev), then
    MEETLOCAL_BASE=http://localhost:4173 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 -I scripts/e2e-a11y.py
Automated checks find only part of the problems (roughly a third); this does not replace keyboard and
screen-reader testing by a person.
"""
import os
import re
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("MEETLOCAL_BASE", "http://localhost:4173")
AXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "node_modules", "axe-core", "axe.min.js")
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS" if ok else "FAIL"), name, detail, flush=True)


def axe(page, label):
    page.add_script_tag(path=AXE)
    found = page.evaluate(
        """async () => {
          const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] });
          return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }));
        }"""
    )
    check(f"axe: {label}", not found, "; ".join(f"{v['id']}({v['impact']}) {v['nodes']}" for v in found))


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    # bypass_csp: axe has to be injected into the page; the CSP itself is tested in e2e-csp.py.
    ctx = browser.new_context(permissions=["camera", "microphone"], viewport={"width": 1100, "height": 800}, bypass_csp=True)
    page = ctx.new_page()

    page.goto(BASE)
    axe(page, "home")
    page.goto(f"{BASE}/settings")
    page.get_by_role("heading", name="Settings").wait_for()
    axe(page, "settings")

    page.goto(BASE)
    page.get_by_role("button", name="New meeting").click()
    page.wait_for_url(re.compile(r".*/join/.+"))
    axe(page, "join page")
    page.get_by_role("button", name="Turn on camera and microphone").click()
    page.get_by_text("Ready", exact=True).first.wait_for(timeout=10000)
    axe(page, "join page with preview")
    page.get_by_label("Your name").fill("Alice")
    page.get_by_role("button", name="Start meeting").click()
    page.get_by_text("Waiting for others to join", exact=True).wait_for(timeout=15000)
    axe(page, "meeting")
    for panel in ["Chat", "People", "Devices", "Transcript", "Assistant", "Camera check"]:
        page.get_by_role("button", name=panel).click()
        page.wait_for_timeout(300)
        axe(page, f"meeting with {panel} panel")
        page.keyboard.press("Escape")
        closed = page.locator("aside.side-panel").count() == 0
        check(f"Escape closes the {panel} panel", closed)
        if not closed:
            page.get_by_role("button", name="Close panel").click()

    # Keyboard: every toolbar button is reachable by Tab and shows a visible focus indicator.
    page.locator(".toolbar button").first.focus()
    outlines = []
    for _ in range(10):
        outlines.append(page.evaluate("() => { const e = document.activeElement; const s = getComputedStyle(e); return [e.getAttribute('aria-label') || e.textContent.trim(), s.outlineStyle, s.outlineWidth, s.boxShadow] }"))
        page.keyboard.press("Tab")
    visible = [o for o in outlines if o[1] != "none" and o[2] != "0px" or o[3] != "none"]
    check("Focused toolbar buttons show a visible focus indicator", len(visible) >= 9, str(outlines[:3]))

    # Narrow screen: no horizontal scroll, controls reachable.
    for width in (390, 320):
        page.set_viewport_size({"width": width, "height": 800})
        page.wait_for_timeout(300)
        overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"No horizontal overflow at {width}px", overflow <= 0, f"overflow={overflow}")
        leave = page.get_by_role("button", name="Leave").bounding_box()
        check(f"Leave button is on screen at {width}px", leave is not None and leave["x"] >= 0 and leave["x"] + leave["width"] <= width + 1, str(leave))
    page.set_viewport_size({"width": 390, "height": 800})
    page.get_by_role("button", name="Chat").click()
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(os.environ.get("OUT", "/tmp"), "a11y_mobile_chat.png"), full_page=True)
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
