---
type: analysis
title: Mining report — spatiotemporal composability paper (Cordis)
source: /mnt/d/paper.pdf ("A Programming Paradigm for Spatiotemporal Composability", Peking University + DeepSeek-AI, 88 pages)
---

# Mining Report: "A Programming Paradigm for Spatiotemporal Composability" → ars-vox

> INTEGRATION NOTE (parent agent, 2026-08-13): report below is the read-only
> analysis leaf's output, shipped verbatim. Spot-verified against the PDF
> text before shipping: §6.1 acquisition/emission + withholding/compensation
> (confirmed verbatim), §5.2.1 per-field reconciliation (confirmed), §5.2.2
> transactional backup+rollback HMR (confirmed), §5.3 Koishi 4,000+ plugins
> (confirmed). Also verified against the repo: `adaptive/planner.ts` (UI-301
> intent→LayoutSpec layer) and `layout/inertia.ts` (UI-207 spatial inertia
> cost policy) both exist exactly as cited. (An intermediate revision of
> this note wrongly claimed those two files were hallucinated — that was a
> false negative from a glob-mode file search; this note is the corrected
> record.)

## 1. The paper in 5 lines

- It formalizes **dynamic composition** — loading, unloading, and reconfiguring components at runtime — along two orthogonal axes: **temporal composability** (a removed component's side effects are completely reversed) and **spatial composability** (inter-component dependencies are declared and re-resolved reactively) (§1.1).
- Its mechanisms: **revertible effects** — every context mutation returns an explicit inverse the runtime accumulates, so teardown is *derived from setup* rather than hand-written (§3.1); and **reactive coeffects** — each context change is classified as activating/deactivating/neutral against a component's declared dependency set, driving its lifecycle (§3.2).
- It gives a **calculus of dynamic composition** (fibers, target-vs-committed views, withdrawal guard, inertia, failure transitions) with metatheory: preservation, recovery exactness, ordering, progress (no deadlock), and confluence — the system always quiesces at the state a static assembly would have produced (§4).
- **Cordis** is the implementation: a language-agnostic TypeScript meta-framework — core library (`ctx.effect` / `ctx.set` / `ctx.use`), plus a declarative component loader with config reconciliation and transactional hot module replacement (§5); validated by Koishi, a chatbot framework with 4,000+ plugins (§5.3).
- The paper's own stated future validation target is **self-evolving agent harnesses** — an AI agent continuously modifying its own runtime components (§1.2.2, §8) — which is precisely ars-vox's situation: an LLM agent that mutates the app's own UI composition at runtime.

## 2. Extracted mechanisms, mapped to ars-vox

### A. Revertible effects (inverse tracking + accumulator)
- **What it buys:** Every state-changing action returns a dispose closure; the runtime composes inverses in LIFO order, so complete cleanup becomes a structural property, not author discipline. Disposal is idempotent (an `armed` flag makes it fire at most once) and composable (a child effect's inverse is prepended to its parent's) (§3.1.1–3.1.2, Algorithm 1 §5.1.1).
- **Maps to:** the agent's `layout.compose` handler; the panel registry; the media surface lifecycle; the recent video-surface bug (model kept a surface the user asked to remove). Concretely: a per-`run_id` **dispose registry** — "open surface" actions return cleanup closures (close media stream, remove panel entry, restore focus role), composed LIFO into a run-level accumulator that runs when the run ends or the user hits STOP.
- **Fit: HIGH.** Directly kills the bug class where surfaces outlive their session; guarantees the UI returns to a known, calm state — the core elderly-user promise.
- **Scope:** surgical — a small `cleanup.ts` registry + discipline on surface open/close; no new deps.

### B. Effect iterators with step-boundary guards (partial rollback)
- **What it buys:** An activation is a *sequence* of effects; between any two steps the runtime can check a guard and stop, applying only the inverses accumulated so far — a reified delimited continuation (§4.3.2, Algorithm 1 §5.1.1).
- **Maps to:** multi-step agent tool calling. Each tool call is an iteration; the guard is "is the user still in this task / did the command change?" — matching the frozen rule *max one major change per command* and *change only when the primary task changes*. A mid-sequence abort rolls back the surfaces opened by earlier calls in that run.
- **Fit: HIGH.**
- **Scope:** surgical — guard checks at tool-call boundaries in the agent runtime + rollback of run-scoped disposers.

### C. Reactive coeffects (dependency-driven recomposition)
- **What it buys:** A component declares `inject` (what it needs); every context change is classified activating/deactivating/neutral against that spec; a component activates only when its dependencies are present and deactivates when they vanish — no optimistic access, no errors from missing deps, no ad-hoc wiring (§3.2.2, Definition 26, Algorithm 3 §5.1.2).
- **Maps to:** the tool registry + panel registry. A panel's *availability spec* (e.g., media panel requires an active media tool + a playing stream; document panel requires an open document context). When the agent closes the tool, notification recomputes the panel's target and removes it — the *correct* fix for the video-surface bug, stated as a general rule.
- **Fit: HIGH.**
- **Scope:** design-level — declare per-surface dependency specs in the panel registry; the planner already recomputes targets, so this is mostly filling in the dependency data.

### D. Target view vs. committed view; refresh loop; quiescence
- **What it buys:** The runtime continuously compares *what should be running* (target, from declarations + current context) against *what was committed* (committed view). Lifecycle fires exactly on their disagreement; `refresh` is idempotent so neutral changes are harmless (§4.2 Definition 46, §5.1.3 Algorithm 5).
- **Maps to:** `adaptive/planner.ts` (target layout) vs. `store.ts` (committed layout) vs. `AdaptiveStage.tsx` (renderer). The paper's discipline: the target is a function of *current state only*, and the diff drives minimal transitions — exactly what the planner should do on each `layout.compose` rather than blindly applying the model's full spec.
- **Fit: HIGH.**
- **Scope:** design-level — codify "target = f(active tools, session state, user mode)"; commit only after a successful transition.

### E. Withdrawal guard (ordered teardown between provider and consumer)
- **What it buys:** A provider may not be torn down while any consumer still resolves a dependency to it; its bindings stay readable throughout its consumers' teardown. The guard always releases (progress theorem) because a fiber stops *providing* the instant it enters UNLOADING — out of service before any inverse runs (§4.3.1, Theorem 63, Algorithm 5 line 10/25 §5.1.3).
- **Maps to:** STOP handling and media teardown. Order: STOP → agent run marks surfaces UNLOADING (stop accepting new commands) → dependents (media panel consuming the stream tool) drain → then dispose the provider. Also: the WebSocket run's tool stream must not be closed while panels still reference it.
- **Fit: HIGH.**
- **Scope:** surgical — an ordering check in the run/STOP teardown path; wait-for-dependents before dispose.

### F. Inertia / asynchronous transitions
- **What it buys:** Once a transition is in flight it *completes* (an iteration in flight lands), then chains into the next transition; a target flip during flight can't abort mid-step — preventing thrash, half-applied states, and flicker (§4.3.3, §5.1.3 "mutual chaining of reload and unload").
- **Maps to:** the frozen movement rules — *short low-motion transitions, keep active content visible during transitions, no layout change during reading*. `layout/inertia.ts` already exists as a cost policy (UI-207); the paper's contribution is the *semantics*: a layout transition, once started, runs to completion before any new `layout.compose` is honored (queue the new one instead of interrupting). This stops rapid-fire LLM commands from causing motion storms.
- **Fit: HIGH.**
- **Scope:** surgical — extend `inertia.ts` with a small transition state machine (IDLE → TRANSITIONING → settle → apply queued target).

### G. Failure transitions (recover-then-record, per-fiber isolation)
- **What it buys:** A failing transition first recovers everything installed up to the failure, records the error on that fiber only, does not auto-retry, and leaves siblings running — a plugin host's semantics (§4.3.4, L-Raise; Theorem 59).
- **Maps to:** a failed tool call mid-composition: roll back the partial layout change (inverses), keep the rest of the UI intact, surface the error through the notification region in plain, accessible language (no modal maze — the elderly-user constraint).
- **Fit: HIGH.**
- **Scope:** surgical — error outcome on the run/surface lifecycle; rollback via the Section A disposers.

### H. Progress & confluence (the system always settles; final state = static assembly)
- **What it buys:** Under acyclic dependencies, the lifecycle always reaches a quiescent state (no deadlock, bounded steps) and the quiescent state is independent of scheduling order — you can reason about the final composition alone, and incremental reconciliation can't diverge from a from-scratch load (§4.4.4, §4.4.5 Theorem 73).
- **Maps to:** validation of the *pure engine* design: `adaptiveEngine.ts`'s "same LayoutSpec → same geometry" is the local, deterministic version of confluence. Engineering takeaway beyond that is thin — it's justification, not code.
- **Fit: MEDIUM** (as validation), **LOW** (as borrowable machinery).
- **Scope:** none — reason about the planner's tests in these terms.

### I. Declarative configuration + incremental reconciliation (loader)
- **What it buys:** The orchestrator declares the desired composition as persistent data; the loader diffs entry fields (`id / url / config / disabled`) and applies the *least disruptive* operation per changed field; groups reconcile as keyed diffs over child ids; `disabled` is retirement (§5.2.1).
- **Maps to:** `layout.compose` as a *config entry update*, not a wholesale layout swap. The handler should diff desired vs. committed per-surfaceId: unchanged surfaces untouched (supports *keep active content visible*, *no change during reading*), removed surfaces disposed via their inverses (the video bug fix), `disabled` = surface toggled off by user or agent. The paper's Theorem 73 guarantee is what makes "diff instead of rebuild" *sound*, not just convenient (§5.2.1).
- **Fit: HIGH — the single most directly applicable section.**
- **Scope:** design-level — the planner becomes a reconciliation engine over `adaptive-layout.schema.json`-shaped desired specs.

### J. Transactional reload / hot module replacement
- **What it buys:** Module-level revertible effects: classify changed modules (accepted/declined), detect stale entries, then swap with **backup + rollback** — if any reload fails, caches are restored and every entry is rebuilt from backup; the system never sits in a half-reloaded state (§5.2.2 Algorithms 8–10).
- **Maps to:** dev-time HMR for the desktop app (Vite already covers the React side — don't rebuild that). The transferable pattern is the **transactional guarantee**: applying a new layout config is all-or-nothing — if a surface/tool fails to materialize mid-apply, roll back to the previous committed spec (and tell the user plainly).
- **Fit:** HMR itself **LOW** (dev-only, no new deps); the transactional-apply pattern **MEDIUM**.
- **Scope:** surgical — wrap the planner's commit step in try/rollback-to-previous-spec.

### K. Coeffect isolation (realms)
- **What it buys:** The same logical key resolves to *different* bindings in different contexts (per-tenant/test/sandbox scoping) via a realm indirection (§3.2.3 Definitions 28–29, §5.2.1 managed realms).
- **Maps to:** nothing today — ars-vox is single-user, no multi-tenancy. A possible future use: per-session test isolation (previewing a layout without touching the live one). 
- **Fit: LOW.**
- **Scope:** none (revisit only if a preview/playground mode is ever wanted).

### L. Coeffect interception (cross-cutting access policy)
- **What it buys:** Metadata merged at dependency access time lets an orchestrator constrain how any component uses a dependency *without modifying the provider*, installable/removable at runtime with zero reloads (§3.2.3 Definitions 30–31, §6.3).
- **Maps to:** constraining the agent's tool access without editing tools: e.g., a "read-only mode" interception on destructive tools, a "no web" interception on the browser surface — enforced at invocation, reversible instantly, independent of the tool's code. This complements (not replaces) the existing two-phase confirmations.
- **Fit: MEDIUM.**
- **Scope:** surgical — an interceptor layer in the tool registry; only if a read-only/safety mode is actually wanted.

### M. Context-access mediation (capability-style proxy)
- **What it buys:** Access is resolved against the *accessing fiber's own committed view*: declared-but-not-committed access fails with INACTIVE_ACCESS; undeclared access fails with UNDECLARED_ACCESS — capabilities granted by declaration, checked at point of use (§5.1.4 Algorithm 6, §6.3).
- **Maps to:** scoping what the agent's tools can read — each tool receives only the context its run declared (run_id-scoped), and an undeclared read fails loudly instead of silently returning stale state. Also maps to panels reading only their declared store slices.
- **Fit: MEDIUM** — the discipline is valuable; a JS `Proxy`-based rewrite of `store.ts` is **not** (over-indirection for a small codebase; explicit slices are more maintainable).
- **Scope:** design-level — declare tool context schemas in the tool registry; enforce at the PydanticAI tool boundary.

### N. System boundary: acquisition vs. emission (withholding & compensation)
- **What it buys:** A crisp taxonomy: effects on locations the system owns exclusively are *tracked and revertible*; operations pushing data out to the world are *emissions* with no inverse, so they need **withholding** (don't emit until the producing state is certain) or **compensation** (a coarser "undo" action) (§6.1).
- **Maps to:** the two-phase confirmation flow, exactly. Destructive actions (delete task, send message) are emissions — no inverse exists — so the UI withholds until the user confirms; reversible UI changes (layout, panels) are acquisitions and can be auto-reverted. Tagging each tool in the tool registry as `revertible | emission` makes the confirmation policy *derived from the registry*, not scattered. Compensation analog: a trash/undo for deleted tasks.
- **Fit: HIGH** as a framing + registry taxonomy; the confirmations themselves **already exist**.
- **Scope:** surgical — add the tag to tool/panel registry entries; route by tag.

### O. Independence / commutativity of effects
- **What it buys:** Effects whose transformations commute can be reverted in *any* order and interleaved safely across components; order-sensitive parts must be carried by declared dependencies instead (§3.1.3, §3.3.2 Theorem 42, §4.4.2).
- **Maps to:** a reasoning discipline for teardown: media panel, tasks panel, and document panel touch disjoint state → safe to tear down in any order; only stream-tool → media-panel ordering needs the declared dependency (Section E). Documented as a checklist, not code.
- **Fit: MEDIUM.**
- **Scope:** design-level documentation + one ordering test.

### P. Component triple (dependencies, provisions, effects) + fiber tree (hierarchical composition)
- **What it buys:** Every component declares what it reads (`inject`), what it writes (`provide`), and what it runs (`effect`); the context tree gives hierarchical, independently loadable/unloadable composition — "plug-in/plug-out" literally (§4.1 Definition 43, §3.3.1). A parent's unload cascades to children it registered (§5.1.3 Algorithm 4).
- **Maps to:** run → tool sessions → surfaces as a tree; STOP = retiring the root run fiber, which cascades retirement down (matching "STOP always visible" and "global controls stay put" — the shell is the root fiber whose provisions are never revoked).
- **Fit: MEDIUM** (conceptual; ars-vox's tree is shallow).
- **Scope:** design-level — model run lifecycle as the fiber tree in the agent runtime.

### Q. Service multiplexing (exclusive binding vs. service broker)
- **What it buys:** Several providers of one interface, either exclusive-bound (switch = unload/reload, perturbing consumers) or behind a broker (provider churn is invisible to consumers; enables rolling updates, load balancing) (§6.2).
- **Maps to:** nothing today — ars-vox has at most one provider per capability (one media player, one browser). A broker would be pure overhead.
- **Fit: LOW.** Engineering takeaway thin for this system.
- **Scope:** none.

### R. Access control & sandboxing
- **What it buys:** Declared dependencies *are* a capability list (reviewable before execution); fine-grained policy via interception; but sandboxing untrusted code requires an execution boundary outside language-level checks (§6.3).
- **Maps to:** ars-vox has no untrusted third-party code — tools are curated and in-repo. The capability mindset (Section M) is the useful fragment; process/container sandboxing of the agent backend is already the deployment's business, not a new borrow.
- **Fit: LOW.**
- **Scope:** none.

### S. Dependency typing & versioning (interface drift, key collision)
- **What it buys:** Diagnosis of the two failure modes of name-keyed linking, plus three remedies: key namespacing (K × P), peer-dependency version constraints, structural compatibility (§6.6).
- **Maps to:** the tool registry: namespace tool/panel keys by package (cheap, prevents future collisions); schema versioning already exists in `packages/contracts/schemas/` — keep `adaptive-layout.schema.json` and `ui-commands.schema.json` versioned and validated at the wire boundary. Structural compatibility is research-only.
- **Fit: MEDIUM** (namespacing + schema validation discipline), **LOW** (the rest).
- **Scope:** trivial hygiene.

### T. Mutual-dependency decomposition + cycle detection at load time
- **What it buys:** A dependency cycle is *predictable from declarations alone* (components stay permanently inactive, no runtime deadlock detection needed); bidirectional couplings decompose into unidirectional bindings via integration components (§6.5).
- **Maps to:** a load-time check in the panel/tool registry that dependency specs are acyclic (one tiny validation function), and a design rule: agent tools and panels must not depend on each other bidirectionally.
- **Fit: MEDIUM.**
- **Scope:** surgical.

### U. Observational equivalence (recovery "up to behavior, not representation")
- **What it buys:** Recovery need not restore byte-identical state — only states no observer can distinguish (§3.3.2). This is what makes *practical* inverses possible (heap layout, generated names need not be restored) and what makes effect independence attainable.
- **Maps to:** a design principle ars-vox already embodies: `adaptiveEngine.ts` keys assignments **by surfaceId, never by instance** — removing and re-adding a surface need not restore instance identity, only the same surface at the same role/slot. This *is* recovery up to an equivalence. No new code.
- **Fit: HIGH** (as confirmation of an existing design), **LOW** (new machinery).
- **Scope:** none — document it.

### V. Vestigial entries / name discipline
- **What it buys:** Registry entries stripped of state are invisible to every rule — removal leaves no trace, and a freed name may be reused safely (Lemma 57, §4.4.1) — because rules only observe committed/installed state, never residue.
- **Maps to:** panel registry hygiene: when a surface is removed, drop its entry entirely (no half-removed panel ghosting, no stale registrations the planner could re-resolve). Matches the video-surface bug's *opposite*: the model's stale committed view survived because nothing reconciled it.
- **Fit: MEDIUM.**
- **Scope:** surgical — removal path already mostly exists; verify completeness.

## 3. Explicit NON-BORROWS

1. **The Cordis library itself / new dependencies.** The whole point of the paper for us is *patterns*, not the package. Adding a meta-framework to a frozen, curated, small codebase violates the no-new-deps and complexity budgets, and the elderly-user product must stay auditable by hand.
2. **Runtime component loading / plugin architecture / HMR engine.** ars-vox's surfaces and tools are fixed and human-curated. Allowing runtime-loaded components trades predictability for extensibility — a bad trade for a vulnerable user's device. (Vite already provides dev HMR.)
3. **Sandboxing untrusted components.** There is no untrusted code in the system; an LLM's tool calls are already gated by the allow-listed tool registry. Building a sandbox boundary would be security theater at real complexity cost.
4. **Coeffect isolation realms / multi-tenancy.** Single user, single machine, no tenancy. YAGNI.
5. **Service broker / load balancing / rolling updates.** One provider per capability; the failure modes §6.2 addresses don't exist at this scale.
6. **Full unified-context rewrite (Γ∞, ctx.effect-everywhere).** `store.ts` + shell + registries already approximate the context; adopting the paradigm literally is a redesign of working, frozen code. Borrow the *discipline*, not the *architecture*.
7. **Proxy-mediated context access.** A `Proxy` over store state adds indirection and debugging pain for marginal capability benefit in a codebase this size; explicit typed slices are more maintainable and more testable.
8. **Dependency versioning machinery (peer deps, structural compatibility).** The registry is small and in-repo; interface drift is controlled by monorepo review. Only key namespacing is worth the trivial cost.
9. **Auto-revert of *world* effects.** Some agent effects (sent messages, completed tasks) are emissions (§6.1) — silently "reverting" something the user watched happen would *create* confusion and erode trust, the opposite of what an elderly user needs. Inverses apply to UI/session state only; world effects keep the existing two-phase confirmation (withholding), not auto-undo.
10. **The formal metatheory itself (definitions, proofs).** Research-only value; what transfers is the engineering reading of each theorem (recovery exactness → disposers; ordering → drain-before-dispose; confluence → diff-is-sound), already captured above.

## 4. What ars-vox ALREADY HAS (don't re-buy)

- **Pure deterministic engine = local confluence/composability** — `adaptiveEngine.ts`: geometry is a pure function of (LayoutSpec, viewport); same spec → same geometry; invalid specs throw `AdaptiveGeometryError` and *never reach layout state* (§4.4.5's "quiescent state is a function of the final configuration" in miniature; §4.2's well-formedness enforced before mutation, preservation-style).
- **surfaceId-keyed assignments = recovery up to observational equivalence + name discipline** — the engine header explicitly keys by `surfaceId`, never by instance (§3.3.2, §4.4.1 Lemma 57).
- **Target vs. committed split = the refresh loop** — `adaptive/planner.ts` (desired) vs. `store.ts` (committed) vs. `AdaptiveStage.tsx` (rendered); the paper's Definition 46 target-view discipline, partially instantiated (§4.2, §5.1.3).
- **Two-phase confirmations for destructive actions = withholding (output-commit)** — exactly §6.1's "withhold an emission until the state that produced it is certain to persist" (§6.1).
- **Role degradation (primary → companion → support) = a coeffect response** — panels responding to changed conditions by role is the paper's activating/deactivating/neutral classification carried by a graded role value (§3.2.2).
- **Frozen movement rules = inertia + tranquility** — "no change during reading; max one major change per command; keep active content visible; short low-motion transitions" are a hand-encoded, stricter version of §4.3.3 inertia and §7.3's quiescence/tranquility discipline (Kramer–Magee, Vandewoude); `layout/inertia.ts` (UI-207) exists.
- **Shell-owned persistent regions + always-visible STOP = root-fiber provisions** — the shell is the never-retired root whose coeffects (media bar, notifications, STOP) are always provided; global controls "stay put" because their provider is never withdrawn (§4.1, §3.3.1 hierarchy).
- **run_id-scoped tool events + SQLite session restore = per-fiber effect attribution + coarse-grained persistence** — the paper's §1.2.3 point that process restart is the coarse-grained substitute, which SQLite-backed session restore already mitigates (§1.2.3).
- **Contract schemas (`adaptive-layout.schema.json`, `ui-commands.schema.json`, `agent-events.schema.json`) = declarative configuration** — the loader/reconciliation data layer exists; what's missing is the reconciliation *engine* (Section I) and the disposal discipline (Section A).

## Execution summary

- **What I did:** Read the entire 88-page PDF at /mnt/d/paper.pdf (all 2,330 extracted lines, §1–§8 + references); loaded the `ars-vox` skill; made 3 bounded read-only repo lookups (layout module list, `adaptiveEngine.ts` header, file searches) to ground surface names; wrote this report to STDOUT only.
- **What I found:** The paper is unusually transferable to ars-vox because §1.2.2 names self-evolving agent harnesses as its motivating future case. The highest-value borrows: (1) inverse/dispose discipline fixing the video-surface bug class, (2) target-vs-committed reconciliation making `layout.compose` a diff, not a swap, (3) withdrawal guard for STOP/teardown ordering, (4) inertia semantics matching the frozen movement rules, (5) the acquisition/emission taxonomy that *justifies* the existing two-phase confirmations. Sections with thin engineering takeaway for us: §4.4 metatheory (validation only), §6.2 multiplexing, §6.4 language independence, §6.6 structural typing.
- **Files created/modified:** none (read-only as instructed; no git).
- **Issues:** the ars-vox skill file was too large for one read (persisted to /tmp — no repo impact); the layout dir listing initially returned 0 hits due to a glob mismatch (resolved with a corrected glob). PDF text extraction was clean with no coverage gaps.