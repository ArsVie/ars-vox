import { useState } from "react";
import { useStore } from "zustand";

import type { AdaptiveTemplate } from "./adaptive/contracts";
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
  const viewport = useStore(appStore, (s) => s.viewport);

  // Shell-owned persistent surfaces (contract: persistent = shell-owned, NOT
  // template slots). Wave 1: the demo proves the shell hosts them; Wave 2
  // (UI-204/205) wires the real media/notifications surfaces here.
  const persistentSurfaces: PersistentSurface[] = (demoSpec || adaptiveSpec)
    ? [
        { surfaceId: "placeholder.persistent", kind: "media" },
        { surfaceId: "shell.notifications", kind: "notifications" },
      ]
    : [];

  return (
    <div
      className="app"
      data-large-text={largeText ? "" : undefined}
      data-high-contrast={highContrast ? "" : undefined}
    >
      <StatusBar demoValue={demoTemplate} onDemoChange={setDemoTemplate} />
      {adaptiveSpec ? (
        <AdaptiveStage
          geometry={computeAdaptiveGeometry(
            adaptiveSpec,
            viewport,
            surfaceRegistry.registeredIds(),
          )}
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
