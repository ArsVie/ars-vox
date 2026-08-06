import { ConfirmationPanel } from "./components/ConfirmationPanel";
import { ErrorPanel } from "./components/ErrorPanel";
import { PanelHost } from "./components/PanelHost";
import { StatusBar } from "./components/StatusBar";
import { StopButton } from "./components/StopButton";
import { TtsPlayer } from "./components/TtsPlayer";

export default function App() {
  return (
    <div className="app">
      <PanelHost />
      <StatusBar />
      <StopButton />
      <ConfirmationPanel />
      <ErrorPanel />
      <TtsPlayer />
    </div>
  );
}
