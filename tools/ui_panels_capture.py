"""Drive the Ars Vox media panel through its states at 1600x900 and capture PNGs.

Prerequisites (full recipe: ars-vox skill, references/cdp-live-rig-wire-driving.md):
- the throwaway service from the working tree on port 8791 (results/ui/launch-verify-8791.ps1);
- headless Edge on :9224 launched with --mute-audio (driving real playback must never
  open Ars's speakers), pointed at http://127.0.0.1:8791/ (results/ui/launch-edge-verify.ps1);
- websocket-client in the python that runs this (the ~/venvs/arsvox venv has it).

Steps: boot -> real model turn with a real search -> offer cards -> click a card
-> playback (with a retry across the offered videos, because some uploads refuse
embedding, and the onError note is itself a correct outcome to capture) -> pause
-> focus layout -> reload rebuild -> local mp3 -> close -> reload stays closed.

Safety: clicks only #send, offer cards, #ctl-play, #panel-grow, #panel-close via CDP
input events; NEVER touches HABLAR (opens the real microphone) nor «escuchar» (plays
the product voice); no timed reminders; the whole run stays muted.

Usage: python ui_panels_capture.py [service_port=8791] [out_dir=results/uicheck] [cdp_port=9224]
"""

import base64
import json
import sys
import time
import urllib.request
from pathlib import Path

import websocket

SERVICE_PORT = sys.argv[1] if len(sys.argv) > 1 else "8791"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "/mnt/c/dev/ars-vox-v2/results/uicheck")
CDP_PORT = sys.argv[3] if len(sys.argv) > 3 else "9224"
OUT.mkdir(parents=True, exist_ok=True)

LOCAL_AUDIO = r"C:\Users\vruizes\Downloads\10-Media_Audio_Video\cafe.mp3"
TURN_TEXT = "Busca en YouTube música de los Beatles y muéstrame las opciones."
SERVICE = f"http://127.0.0.1:{SERVICE_PORT}"


def http_json(url, timeout=15):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read())


targets = http_json(f"http://127.0.0.1:{CDP_PORT}/json")
print("targets:", [(t.get("type"), t.get("url", "")[:70]) for t in targets])
page = next((t for t in targets if t.get("type") == "page" and SERVICE_PORT in t.get("url", "")), None)
if not page:  # the page may still be on another port; the driver navigates it anyway
    page = next((t for t in targets if t.get("type") == "page" and "127.0.0.1" in t.get("url", "")), None)
if not page:
    page = next((t for t in targets if t.get("type") == "page"), None)
if not page:
    print("PAGE TARGET NOT FOUND")
    sys.exit(1)

ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=120, suppress_origin=True)
_id = 0
states = {}


def cdp(method, **params):
    global _id
    _id += 1
    ws.send(json.dumps({"id": _id, "method": method, "params": params}))
    while True:
        message = json.loads(ws.recv())
        if message.get("id") == _id:
            if "error" in message:
                raise RuntimeError(f"CDP {method}: {message['error']}")
            return message.get("result", {})


def js(expression):
    result = cdp("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
    if "exceptionDetails" in result:
        raise RuntimeError(f"JS: {result['exceptionDetails'].get('text')} :: {expression[:60]}")
    return result.get("result", {}).get("value")


def wait_js(expression, timeout=25.0, label=""):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if js(expression):
                return True
        except RuntimeError:
            pass
        time.sleep(0.4)
    print(f"  (timed out waiting for {label or expression[:60]})")
    return False


def click(selector):
    rect = js(
        "(() => { const n = document.querySelector(" + repr(selector) + ");"
        " if (!n) return null; const r = n.getBoundingClientRect();"
        " return [r.x + r.width / 2, r.y + r.height / 2]; })()"
    )
    if not rect:
        raise RuntimeError(f"no element for {selector}")
    x, y = rect
    cdp("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", clickCount=1)
    cdp("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", clickCount=1)
    time.sleep(0.3)


def shot(name):
    data = cdp("Page.captureScreenshot", format="png", captureBeyondViewport=False)["data"]
    path = OUT / f"{name}.png"
    path.write_bytes(base64.b64decode(data))
    raw = path.read_bytes()
    width = int.from_bytes(raw[16:20], "big")
    height = int.from_bytes(raw[20:24], "big")
    print(f"  shot {name}: {path.name} {width}x{height}")
    return path


def state(label):
    snapshot = js(
        """(() => ({
          status: document.getElementById('status-text').textContent,
          bubbles: document.querySelectorAll('.bubble').length,
          panelHidden: document.getElementById('panel').hidden,
          workspace: document.getElementById('workspace').className,
          cards: [...document.querySelectorAll('#offers .card .card-title')].map(n => n.textContent),
          panelTitle: document.getElementById('panel-title').textContent,
          note: (() => { const n = document.getElementById('panel-note'); return n && !n.hidden ? n.textContent : ''; })(),
          iframe: !!document.querySelector('#stage iframe'),
          glyph: document.getElementById('ctl-play').textContent,
          barDisabled: document.getElementById('ctl-play').disabled,
          time: document.getElementById('ctl-time').textContent,
          duration: document.getElementById('ctl-duration').textContent,
          audioPlaying: (() => { const a = document.querySelector('#stage audio'); return a ? !a.paused : null; })(),
          audioTime: (() => { const a = document.querySelector('#stage audio'); return a ? Math.round(a.currentTime * 10) / 10 : null; })(),
          videoTime: (() => { const v = document.querySelector('#stage video'); return v ? Math.round(v.currentTime * 10) / 10 : null; })()
        }))()"""
    )
    states[label] = snapshot
    print(f"  state {label}: {json.dumps(snapshot, ensure_ascii=False)[:230]}")
    return snapshot


def wait_event(kind, after=0, timeout=110):
    deadline = time.time() + timeout
    while time.time() < deadline:
        events = http_json(f"{SERVICE}/events?after={after}")["events"]
        for event in events:
            if event["kind"] == kind:
                return event
        time.sleep(0.5)
    return None


def current_note():
    return js("(() => { const n = document.getElementById('panel-note'); return n && !n.hidden ? n.textContent : ''; })()")


def wait_video_outcome(seconds=16.0):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if js("document.getElementById('ctl-play').textContent") == "❚❚":
            return "playing", current_note()
        note = current_note()
        if note:
            return "note", note
        time.sleep(0.5)
    return "silent", ""


def attempt_video(label):
    wait_js("!!document.querySelector('#stage iframe')", 25, f"{label}: player mount")
    time.sleep(1.5)
    if js("document.getElementById('ctl-play').textContent") != "❚❚" and not current_note():
        click("#ctl-play")  # the tap a real user gives an autoplay-blocked embed
    return wait_video_outcome()


def main():
    cdp("Page.enable")
    cdp("Runtime.enable")
    cdp("Emulation.setDeviceMetricsOverride", width=1600, height=900, deviceScaleFactor=1, mobile=False)

    # boot the page fresh so the whole run is one deterministic sequence
    cdp("Page.navigate", url=SERVICE + "/")
    time.sleep(3.0)
    wait_js("document.readyState === 'complete' && document.getElementById('who').textContent !== '…'", 25, "boot")

    print("== state 1: the window before anything (empty log)")
    state("01-boot")
    shot("panels-01-boot")

    print("== step 2: ask for options through the real UI (real model, real search)")
    js(
        "(() => { const i = document.getElementById('text');"
        f" i.value = {TURN_TEXT!r};"
        " document.getElementById('send').click(); })()"
    )
    offers = wait_event("media_offers")
    if offers is None:
        print("  no media_offers event arrived; the events seen:")
        events = http_json(f"{SERVICE}/events?after=0")["events"]
        for event in events[-10:]:
            print("   ", event["kind"], json.dumps(event["payload"], ensure_ascii=False)[:120])
        state("02-failed")
        shot("panels-02-failed")
        (OUT / "panels-states.json").write_text(json.dumps(states, ensure_ascii=False, indent=2), encoding="utf-8")
        return 1

    items = offers["payload"]["items"]
    urls = [item["url"] for item in items]
    wait_js("document.querySelectorAll('#offers .card').length > 0", 20, "cards render")
    time.sleep(1.0)  # the turn's reply bubble lands a moment later
    print("== state 3: options on cards")
    state("03-offers")
    shot("panels-03-offers")

    print("== step 4: click the first card; if that video cannot embed, try the next")
    attempts = []
    click("#offers .card")
    outcome, note = attempt_video("card 1")
    attempts.append({"url": urls[0], "via": "card click", "outcome": outcome, "note": note})
    if outcome == "note":
        state("04-unavailable")
        shot("panels-04-unavailable")
    if outcome != "playing":
        for item in items[1:]:
            url = item["url"]
            body = json.dumps({"source": "youtube", "url": url, "title": item.get("title") or "video"})
            js(
                f"fetch('/media/play', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }},"
                f" body: {body!r} }}).then(r => r.json())"
            )
            outcome, note = attempt_video(url)
            attempts.append({"url": url, "via": "service", "outcome": outcome, "note": note})
            if outcome == "playing":
                break
    states["attempts"] = attempts
    playing_url = next((a["url"] for a in attempts if a["outcome"] == "playing"), None)
    print(f"  video attempts: {json.dumps(attempts, ensure_ascii=False)}")
    print(f"  playing: {playing_url}")

    first = js("document.getElementById('ctl-time').textContent")
    time.sleep(3.0)
    second = js("document.getElementById('ctl-time').textContent")
    print(f"  video clock: {first} -> {second}")
    print("== state 5: the player")
    state("05-video")
    shot("panels-05-video")

    print("== step 6: pause with our own control")
    click("#ctl-play")
    time.sleep(1.2)
    state("06-paused")
    shot("panels-06-paused")

    print("== step 7: grown (focus) layout, then back")
    click("#panel-grow")
    time.sleep(0.8)
    state("07-focus")
    shot("panels-07-focus")
    click("#panel-grow")
    time.sleep(0.6)

    print("== step 8: reload — the panel rebuilds from the log")
    cdp("Page.reload")
    time.sleep(3.5)
    wait_js("document.readyState === 'complete' && document.getElementById('who').textContent !== '…'", 25, "boot")
    wait_js("!!document.querySelector('#stage iframe')", 15, "player rebuilt")
    time.sleep(0.8)
    state("08-rebuild")
    shot("panels-08-rebuild")

    print("== step 9: a local file (a real mp3) with the same controls")
    js(
        "fetch('/media/play', { method: 'POST', headers: { 'Content-Type': 'application/json' },"
        ' body: JSON.stringify({ source: "local", path: ' + repr(LOCAL_AUDIO) + " }) })"
        ".then(r => r.json())"
    )
    wait_js("!!document.querySelector('#stage audio')", 15, "audio mount")
    time.sleep(2.0)
    playing = js("(() => { const a = document.querySelector('#stage audio'); return a ? !a.paused : null; })()")
    if not playing:
        print("  (autoplay blocked after reload — tapping play like the user would)")
        click("#ctl-play")
        time.sleep(2.0)
    state("09-local")
    shot("panels-09-local")

    print("== step 10: close the panel, reload, and check it stays closed")
    click("#panel-close")
    time.sleep(1.2)
    state("10-closed")
    shot("panels-10-closed")
    cdp("Page.reload")
    time.sleep(3.5)
    wait_js("document.readyState === 'complete'", 20, "boot")
    time.sleep(0.8)
    state("11-reload-after-close")
    shot("panels-11-reload-after-close")

    (OUT / "panels-states.json").write_text(json.dumps(states, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nstates written to {OUT / 'panels-states.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
