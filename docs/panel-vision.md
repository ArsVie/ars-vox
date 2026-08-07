# Panel vision direction — Ars's spec (2026-08-07, authoritative)

> ⛔ FROZEN DIRECTION — NOT EDITABLE BY AGENTS.
> This file is Ars's specification. Agents must NEVER modify, "ratify",
> "correct", extend, or reinterpret it. Only Ars edits it. If a change
> seems needed, propose it to Ars; do not write it here.

Read this BEFORE any panel work. This is what the panels ARE, per Ars.
Anything in the UI that contradicts this is wrong, not the spec.

## Verbatim — Ars's exact words (2026-08-07, unedited)

> "I want the llm to be able to offer some options to the user on the
> videos he wants to watch in youtube, so an integrated youtube search
> for the agent is crucial, the documents panel should be pdfs, epubs
> and txt reader, it should also have a lightweight agent first document
> editor that can produce docs and both the user and the agent can edit
> it. Idk how you even plan to introduce the news panel, I just wanted an
> integrated broser that the agent could use the search bar and scroll
> through it with DOM and user manipulable too, that could be used among
> other things for news. the task bar should have some to do's but also
> be able to have some constant/permanent reminders, the agent should get
> them injected like cronjobs every certain amount of time in context,
> also, for the agent, messages should have time appeneded to it for
> context. For the media panel it should be able to host the youtube
> videos in case they get send to second view or are music but also music
> from either youtube or local, controls and ui for that should be the
> same. Ideally the agent can know user preferences from memories and
> query the search accordingly"

> "I have yet to see the panels populated by anything useful. Also, I
> didn't state the 8 exit conditions. Honestly dissapointed by the
> current state of it. I expected to find a revamped design in the UI
> that keep the core idea but was extened and had a proper vision for the
> design from the taste skill."

## The panels (what each one means)

- **youtube** — agent-integrated search. The LLM searches YouTube and
  OFFERS the user options (results render as selectable cards). The user
  picks one (click or voice). Playback happens in the media panel.
  Search must be a first-class agent capability.
- **browser** — an INTEGRATED BROWSER (replaces the "news panel" idea;
  Ars never asked for a news panel). The agent can use it: search bar,
  scroll, DOM access. The USER can also manipulate it directly. News is
  just one thing you do in it.
- **document** — reader for PDF, EPUB and TXT **plus** a lightweight
  agent-first document editor. The agent can produce documents; BOTH the
  user and the agent can edit the same document.
- **tasks** — to-do's AND constant/permanent reminders. Reminders get
  INJECTED INTO THE AGENT'S CONTEXT on a cadence, like cronjobs (the
  agent must be reminded periodically, not just shown a list).
- **conversation** — messages must have TIME appended for the agent's
  context (timestamps matter to the agent).
- **media** — hosts YouTube videos (when sent to a second view) and
  music from YouTube or LOCAL files. The controls and UI must be THE
  SAME regardless of source: one unified player.
- **agent behavior** — the agent should know user preferences from
  MEMORIES and query searches (YouTube, browser) accordingly.

## Corrections to prior assumptions (do not reintroduce)

- The "8 exit conditions without a mouse" were NOT stated by Ars. They
  were agent/advisor-authored. Do not attribute them to him.
- There is NO news panel. The browser covers that.
- The agent never sends coordinates; it picks a template + slot
  assignments (unchanged core idea, Ars's design).

## Approved implementation shape (this session)

- Typed wire events per domain: `youtube.search` (results list),
  `browser.navigate` + `browser.snapshot`, `document.load`
  (kind: pdf|epub|txt + content/chapters) + `document.edit`,
  `tasks.update` (todos + reminders), `media.state` extended
  (source: youtube|local, kind: video|audio, position/duration/volume).
- User-side commands: youtube.search/youtube.play, browser.navigate/
  back/forward/refresh, document.save, tasks.toggle, media.play_pause/
  seek. Optimistic local state + send.
- Mock emits a demo scenario populating all four templates.
- Backend follow-ups (spec'd, not built here): cron-style reminder
  injection into agent context, message timestamps in the context
  builder, memory-driven search queries, Electron webview DOM bridge.
- Design pass per taste-skill analysis: typography + tabular figures,
  radius scale, tinted shadows, machined panel inset, tactile press,
  motivated motion gated by reduced-motion, state completeness, copy
  discipline, dial contract (VARIANCE 3 / MOTION 2 / DENSITY 5).
