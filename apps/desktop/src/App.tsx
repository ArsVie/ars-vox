import { useStore } from "zustand";

import { ConfirmationPanel } from "./components/ConfirmationPanel";
import { ErrorPanel } from "./components/ErrorPanel";
import { PanelHost } from "./components/PanelHost";
import { StatusBar } from "./components/StatusBar";
import { TtsPlayer } from "./components/TtsPlayer";
import { appStore } from "./store";

export default function App() {
  const largeText = useStore(appStore, (s) => s.largeText);
  const highContrast = useStore(appStore, (s) => s.highContrast);
  return (
    <div
      className="app"
      data-large-text={largeText ? "" : undefined}
      data-high-contrast={highContrast ? "" : undefined}
    >
      <PanelHost />
      <StatusBar />
      <ConfirmationPanel />
      <ErrorPanel />
      <TtsPlayer />
    </div>
  );
}
