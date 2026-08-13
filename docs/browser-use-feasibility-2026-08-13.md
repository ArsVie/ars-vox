# Browser-use feasibility — verdict: ADOPT (text-first, local, no vision)

Research complete — I have ground truth from the source (browser_use 0.13.7, shipped `actor/` package, `session.py`, `dom/service.py`, pyproject, PyPI JSON) plus the docs and the local ars-vox files. Here is the feasibility report.

---

# Feasibility: browser-use as ars-vox's local, text-first browser engine

## 0. Grounding — what ars-vox does today (read first)

- `services/agent/arsvox_agent/browser_state.py`: `BrowserStateStore` + `DomActionResultStore` — in-process mirrors of the **Electron main process** WebContentsView, fed by `PUT /api/browser-state` and `PUT /api/browser-dom-result`; bounded `wait_for_update()` / `wait_for()` (thread-safe, loop-agnostic).
- `services/agent/arsvox_agent/tools/browser_tools.py`: exactly 2 tools — `browser.navigate(url)` (emit wire event → await post-nav state, 10 s bound) and `browser.dom_action(operation=click|scroll|set_value|query, target, value)` (emit → Electron main executes → await result, 10 s bound). Both have a mock path, `PolicyKind.REVERSIBLE`, and honest Spanish errors.
- **Live defect**: "El escritorio no respondió" fires when the *Electron-main round-trip* fails (no Electron, view unattached, blocked page). The agent's browser actions have a hard runtime dependency on a separate desktop process.

**Key architectural fact for the verdict**: the current design executes browser actions *in Electron main* and ships results back over HTTP. Any engine that executes in the *service process* eliminates the failure class. The question is whether browser-use's engine is worth adopting over alternatives for that role.

## 1. Architecture

- **Built on Chromium via CDP directly — NOT Playwright.** `AGENTS.md` (https://github.com/browser-use/browser-use/blob/main/AGENTS.md): "navigates web pages using Chromium via CDP, processes HTML". The DOM layer uses `cdp_use.cdp.*` (Accessibility.getFullAXTree, DOM snapshot, layout metrics) — see `browser_use/dom/service.py` on `main` (https://github.com/browser-use/browser-use/blob/main/browser_use/dom/service.py). `pyproject.toml` (https://github.com/browser-use/browser-use/blob/main/pyproject.toml) has **zero playwright dependency**. Playwright appears only as the *binary installer*: `browser-use install` runs `uvx playwright install chromium` (`browser_use/cli.py`, `_run_install_command`).
- **Local mode: yes, first-class.** `BrowserSession` (exported as `Browser`) launches Chromium locally (headless/headful auto-detect, `BrowserSession(headless=True, user_data_dir='./profile')` per its docstring, https://github.com/browser-use/browser-use/blob/main/browser_use/browser/session.py) or attaches to an existing browser via `cdp_url` (AGENTS.md "Browser All Parameters"). Cloud (`use_cloud=True`) is optional and off by default. `browser_use/browser/chrome.py` (`find_chrome_executable`) reuses system Chrome/Chromium on Windows (`%ProgramFiles%\Google\Chrome\...`, `%LocalAppData%\...`) — note **Edge is not searched**, so the reliable path on the ars-vox machine is the installed Chromium.
- Internal split in 0.13.x: engine bits moved to a separate `browser-use-core` wheel (Rust binaries, see below) + `bubus` event bus + `browser-harness` (CLI product). Top-level `browser.py` is gone; module is now `browser_use/browser/` (lazy imports, `browser_use/__init__.py`).

## 2. TEXT-FIRST: yes — the low-level API is DOM-only, zero vision

The headline `Agent` loop is LLM-driven, but the library ships a **deterministic, non-LLM, non-vision API** that is exactly the tool surface you want:

- **`BrowserSession` (`browser_use.Browser`)** — direct control: `new_page(url)`, `get_pages()`, `get_current_page()`, `close_page()`, `navigate_to(url)`, `get_current_page_url()/get_current_page_title()`, `get_state_as_text()`, `get_browser_state_summary()`, `get_selector_map()`, `get_dom_element_by_index(index)`, `get_element_coordinates(backend_node_id)`, `cookies()/export_storage_state()`, `wait_if_captcha_solving()`, `connect(cdp_url)`. Confirmed from `browser_use/browser/session.py` method list (https://github.com/browser-use/browser-use/blob/main/browser_use/browser/session.py).
- **Actor package** (`browser_use/actor/`, shipped in 0.13.7, docs-marked "legacy") — Playwright-like, CDP-based, documented in `browser_use/actor/README.md` (https://github.com/browser-use/browser-use/blob/main/browser_use/actor/README.md): `Page.goto/go_back/go_forward/reload`, `Page.get_elements_by_css_selector(sel)`, `Page.evaluate('() => ...')`, `Page.press('Enter')`, `Page.get_url()/get_title()`, `Element.click()/fill(text)/hover()/focus()/select_option()/get_attribute()/evaluate()`, `Mouse.click(x,y)/scroll(...)`. All text/DOM. AGENTS.md confirms: *"The `Browser` instance also provides all Actor methods for direct browser control."*
- **Page text extraction, no vision**: `browser_use/dom/markdown_extractor.py` (markdownify-based; pyproject comment: "markdownify: used for page text content extraction for passing to LLM") + `DomService.get_serialized_dom_tree()` which returns the **accessibility tree + clickable-element selector map with XPaths and text** (pure DOM/AX, no images — confirmed reading `dom/service.py` source; `detect_pagination_buttons` even ships Spanish patterns "siguiente/anterior").
- **Even the Agent loop can go text-first**: `Agent(use_vision="auto"|True|False)` — per AGENTS.md: `"False" never includes screenshots and excludes screenshot tool`. The `extract` tool is LLM-based but optional; you would not use it (your PydanticAI agent reads returned text directly).
- **Nuance (not guessed)**: nothing in the *low-level* path requires vision or an LLM — `get_element_by_prompt`/`extract_content` are the only LLM-gated Actor methods, and they are optional. Clicking is by CSS selector or selector-map index, both text. `Agent` is unnecessary for this integration.

## 3. Python API: async-native; FastAPI-safe

- Everything is `async` (CDP over websockets via `cdp-use`; `browser_use/__init__.py` even monkeypatches `BaseSubprocessTransport.__del__` to survive loop teardown). There is **no sync API** — `browser_use/sync/` is a *cloud event-sync* module, not a sync wrapper (https://github.com/browser-use/browser-use/blob/main/browser_use/sync/service.py). That's fine for FastAPI: no event-loop handoff hazards like playwright-sync; run `BrowserSession` as an app-lifetime singleton (async context manager) and await its methods inside your tool handlers, exactly like the existing `wait_for()` awaits.
- Two caveats: (a) `DomService` has a source TODO "we start a new websocket connection PER STEP" (sessions are cached per target — acceptable); (b) top-level imports are lazy precisely because `Agent`/`ActionModel` are "very heavy (over 1 second)" — import only `BrowserSession` + `actor` modules to keep FastAPI startup lean.

## 4. Limited-tool surface — 4–6 tools, ~200–300 LOC adapter

| ars-vox tool today | browser-use call (text-first) |
|---|---|
| `browser.navigate(url)` | `session.navigate_to(url)` / `new_page(url)` then `get_current_page_url()/get_current_page_title()` (real post-nav state — same semantics as the current `wait_for_update` round-trip) |
| `browser.dom_action query` | `DomService.get_serialized_dom_tree(...)` or markdown extractor / `get_state_as_text()` → truncated text |
| `browser.dom_action click` | `page.get_elements_by_css_selector(target)` → `element.click()` (or selector-map index → `get_dom_element_by_index`) |
| `browser.dom_action set_value` | `element.fill(text)` |
| `scroll` / `back` (optional) | `Mouse.scroll(delta_y=...)` / `page.go_back()` |

LOC estimate: ~200–300 total — one `browser_engine.py` wrapper (~120 LOC: session lifecycle, bounded CDP timeouts via `TimeoutWrappedCDPClient`, Spanish error mapping, `allowed_domains` mirroring the existing allowlist), plus rewriting the two handlers in `browser_tools.py` (~100 LOC, reusing existing `ToolSpec`/`PolicyKind.REVERSIBLE`/mock path/Spanish strings). The current round-trip plumbing (~80 lines of emit+await) is deleted, not extended.

## 5. Deps / weight / licensing / maturity

- **PyPI**: `browser_use` 0.13.7 wheel **719 KB** (py3-none-any), `requires-python >=3.11,<4.0`; optional `core` extra = `browser-use-core` 0.13.2 **platform wheel with Rust binaries, 22–27 MB** (win_amd64 22.3 MB — https://pypi.org/project/browser-use-core/). **Hard deps are heavy**: aiohttp, httpx, pydantic, cdp-use, bubus, browser-harness, openai/anthropic/google-genai/groq/ollama SDKs, mcp, pypdf, reportlab, pillow, markdownify, posthog, browser-use-sdk, … Realistic installed footprint **~150–300 MB** — the LLM SDKs you will never call are unavoidable (they are hard deps).
- **System requirements**: Chromium binary downloaded separately (`browser-use install`), ~150 MB, one-time; falls back to system Chrome if present (Windows paths in `chrome.py`).
- **License**: MIT (repo LICENSE + pyproject classifier). **Privacy**: PostHog anonymous telemetry **on by default** — must set `ANONYMIZED_TELEMETRY=false` (AGENTS.md "Telemetry"); cloud sync is auth/`BROWSER_USE_CLOUD_SYNC`-gated and no API key means no cloud traffic. Both need explicit handling for an elderly-user app.
- **Maturity**: 109k stars / 12k forks / 10k commits; latest release 0.13.7 (2026-07-27), commits 2 days ago (2026-08-11) — extremely active. Con: fast-moving API with periodic breaking changes (0.9.7 sdist Nov 2025 → 0.13.7 Jul 2026) and the docs are now cloud-first; the Actor API you'd rely on is labeled **legacy** → **pin the version**.

## 6. Alternatives (if wrong fit)

- **raw playwright** — lighter, stable, sync+async, mature; you'd hand-roll selector/clickable-heuristics + `inner_text` extraction (~150 LOC more than browser-use's adapter). Best choice if you want minimal deps and control; browser-use's own binary install already uses playwright's Chromium.
- **crawlee-python** — async scraping framework; fine for extraction pipelines but awkward as an interactive *browser the user can see and the agent drives*.

## 7. VERDICT: **ADOPT** (as the browser surface engine, no vision) — with two conditions

It genuinely satisfies all requirements: local Chromium via CDP, deterministic text/DOM-only low-level API (`BrowserSession` + Actor + `DomService`), async-native for FastAPI, 4–6 tool adapter, MIT, very actively maintained. Conditions: **pin `browser-use==0.13.7`** (fast-moving API; Actor is "legacy" but shipped), and **explicitly disable telemetry + cloud sync** for the privacy surface. The heavy dep tree (~150–300 MB, LLM SDKs) is the main cost; if the packager balks, playwright-raw is the fallback — but browser-use's ready-made DOM-snapshot/selector-map/clickable machinery and `allowed_domains` are worth it.

**5-line integration sketch against the current files**:
1. New `services/agent/arsvox_agent/browser_engine.py`: one `BrowserSession` (headful — the elderly user should *see* the agent's page — `allowed_domains` = existing allowlist, `ANONYMIZED_TELEMETRY=false`) + thin wrapper: `navigate(url)→(url,title)`, `extract()→text`, `click(css)`, `fill(css,text)`, `scroll(dy)`, `back()`, each with the existing 10 s bound → honest Spanish errors.
2. `browser_tools.py`: rewrite `browser_navigate` and `browser_dom_action` to call the engine **directly** — delete the emit→await-Electron-main round-trip (the defect's root cause); keep `ToolSpec`/`PolicyKind.REVERSIBLE`, the `[mock]` path, and Spanish strings unchanged.
3. `browser_state.py`: `BrowserStateStore`/`DomActionResultStore` stop being the agent's execution channel; keep them only if the Electron view stays as the *user's* browser (UI display channel) — agent actions no longer pass through it.
4. Optionally preserve single-authority: if Electron main exposes the WebContentsView's CDP endpoint, `BrowserSession(cdp_url=...)` can drive the *same view* the user sees; otherwise the agent gets its own visible window (product decision, not a technical blocker).
5. `config.agent.mock` path stays byte-for-byte; delete the now-dead `BrowserNavigateEvent`/`BrowserDomActionEvent` round-trip wiring only after the packaged-app verification suite confirms the new path.

---

**Summary of work**: read `browser_state.py` + `browser_tools.py` (ars-vox's Electron-main round-trip design, the defect source), then verified browser-use 0.13.7 against primary sources: GitHub README/releases (109k★, 0.13.7 2026-07-27), `AGENTS.md` SDK reference, `actor/README.md` (low-level CDP API), `browser/session.py` + `dom/service.py` source (method lists, CDP-not-Playwright), `pyproject.toml` (deps, MIT, `core` extra), `cli.py` (`browser-use install` = playwright-chromium download), PyPI JSON (wheel sizes), browser-harness install docs. **Files created/modified: none** (report to STDOUT only, as instructed). **Verdict: adopt** browser-use as a local, text-first engine (vision optional and off by default at the low level; `Agent(use_vision=False)` excludes screenshots entirely); pin 0.13.7, disable telemetry, expect ~150–300 MB deps + a one-time Chromium download; ~200–300 LOC adapter replacing the Electron round-trip that causes "El escritorio no respondió". Ambiguity flag: none on the text-first question — the low-level API is verifiably DOM/AX-only; the main uncertainty is version churn (Actor labeled legacy) and install weight, both manageable.