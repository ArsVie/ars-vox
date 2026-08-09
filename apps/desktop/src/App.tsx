import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import type { AdaptiveTemplate, LayoutSpec, SurfaceRole } from "./adaptive/contracts";
import { TEMPLATE_FIXTURES } from "./adaptive/fixtures";
import { registerProductSurfaces } from "./adaptive/surfaces";
import { ConfirmationPanel } from "./components/ConfirmationPanel";
import { ErrorPanel } from "./components/ErrorPanel";
import { PanelHost } from "./components/PanelHost";
import { PersistentRegions, type PersistentSurface } from "./components/PersistentRegions";
import { StatusBar } from "./components/StatusBar";
import { TtsPlayer } from "./components/TtsPlayer";
import { AdaptiveStage } from "./layout/AdaptiveStage";
import { computeAdaptiveGeometry } from "./layout/adaptiveEngine";
import { surfaceRegistry } from "./roles/registry";
import { appStore } from "./store";

// GATE-2 (Wave 2): the five product surfaces (browser/conversation/document/
// tasks/media) become placeable through LayoutSpec and render in the adaptive
// stage. Idempotent — safe on hot reload.
registerProductSurfaces();

/**
 * H7 (GATE-2.5): build the geometry INPUT from the store's role-RESOLVED
 * assignments (applyAdaptiveSpec already ran the requested -> companion ->
 * support fallback ladder) instead of the raw agent spec. The geometry
 * engine stays a pure function of a LayoutSpec; this is the only place the
 * two meet in the live shell.
 */
function resolvedSpecFrom(
  spec: LayoutSpec | null,
  assignments: readonly { surfaceId: string; slot: string; role: SurfaceRole }[],
): LayoutSpec | null {
  if (!spec) return null;
  if (assignments.length === 0) return spec; // defensive: spec without resolution
  return {
    template: spec.template,
    proportion: spec.proportion ?? null,
    assignments: assignments.map((a) => ({
      surfaceId: a.surfaceId,
      slot: a.slot,
      role: a.role,
    })),
  };
}

export default function App() {
  const largeText = useStore(appStore, (s) => s.largeText);
  const highContrast = useStore(appStore, (s) => s.highContrast);
  // Shell demo toggle: renders the frozen template fixtures with placeholder
  // children so the unified shell can be evaluated against all five adaptive
  // templates before UI-102 geometry integration (GATE-1). null = normal mode.
  const [demoTemplate, setDemoTemplate] = useState<AdaptiveTemplate | null>(null);

  const demoSpec = demoTemplate ? TEMPLATE_FIXTURES[demoTemplate] : null;

  // GATE-2: a validated adaptive LayoutSpec (manual via applyAdaptiveSpec —
  // agent planner is Wave 3) renders through the adaptive stage with REAL
  // product surfaces; otherwise the legacy PanelHost path stays.
  const adaptiveSpec = useStore(appStore, (s) => s.adaptive.spec);
  // H7: the role-resolved assignments (fallback ladder output) drive both
  // the geometry and the stage — never the raw spec.
  const adaptiveAssignments = useStore(appStore, (s) => s.adaptive.assignments);
  const viewport = useStore(appStore, (s) => s.viewport);
  const setViewport = useStore(appStore, (s) => s.setViewport);
  const shellRef = useRef<HTMLDivElement>(null);

  // W0 (GATE-3.5): feed the real content-viewport size (px) into the store
  // so the engine can enforce px floors and derive chrome density from
  // actual geometry. The observer lives on the SHELL div (mounted in BOTH
  // the legacy PanelHost branch and the adaptive stage branch) — PanelHost
  // unmounts the moment a composition lands, so an observer there would
  // freeze the viewport at boot size and adaptive geometry would stop
  // following window resizes.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const report = () => {
      const rect = el.getBoundingClientRect();
      setViewport({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [setViewport]);

  // H7: conditional persistent media/notifications. Persistent surfaces are
  // shell-owned infra, NOT always-visible chrome: the media bar renders only
  // while a track is active AND media is not already occupying a template
  // slot (no duplicate media region); the notifications region renders only
  // while there is something to show (a system/notification message).
  const media = useStore(appStore, (s) => s.content.media);
  const mediaActive = !!(
    media &&
    (media.title !== "" || media.videoId !== null || media.url !== null)
  );
  const mediaInLayout = adaptiveAssignments.some((a) => a.surfaceId === "media");
  // GATE-3.5 (A6/R34): the notifications region shows while there is
  // something real to render — restored/live notifications (not merely a
  // system message in the chat).
  const hasNotificationContent = useStore(
    appStore,
    (s) => s.notifications.length > 0,
  );

  const resolvedSpec = useMemo(
    () => resolvedSpecFrom(adaptiveSpec, adaptiveAssignments),
    [adaptiveSpec, adaptiveAssignments],
  );

  // GATE-1 (2026-08-09): final net under the choke guard — a geometry bug
  // must never white-screen the app. With applyAdaptiveSpec rejecting
  // unrenderable specs this branch is unreachable; it degrades to the
  // legacy fallback instead of crashing React.
  const geometry = useMemo(() => {
    const spec = resolvedSpec ?? adaptiveSpec;
    if (!spec) return null;
    try {
      return computeAdaptiveGeometry(
        spec,
        viewport,
        surfaceRegistry.registeredIds(),
      );
    } catch (error) {
      console.warn(
        "[adaptive] geometry failed — legacy fallback:",
        (error as Error).message,
      );
      return null;
    }
  }, [resolvedSpec, adaptiveSpec, viewport]);

  const persistentSurfaces: PersistentSurface[] = (demoSpec || adaptiveSpec)
    ? [
        ...(mediaActive && !mediaInLayout
          ? [{ surfaceId: "placeholder.persistent", kind: "media" as const }]
          : []),
        ...(hasNotificationContent
          ? [{ surfaceId: "shell.notifications", kind: "notifications" as const }]
          : []),
      ]
    : [];

  return (
    <div
      ref={shellRef}
      className="app"
      data-large-text={largeText ? "" : undefined}
      data-high-contrast={highContrast ? "" : undefined}
    >
      <StatusBar demoValue={demoTemplate} onDemoChange={setDemoTemplate} />
      {adaptiveSpec && geometry ? (
        <AdaptiveStage
          geometry={geometry}
          assignments={adaptiveAssignments}
        />
      ) : (
        <PanelHost demoSpec={demoSpec} />
      )}
      <PersistentRegions surfaces={persistentSurfaces} />
      <ConfirmationPanel />
      <ErrorPanel />
      <TtsPlayer />
    </div>
  );
}
