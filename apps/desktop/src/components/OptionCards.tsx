/**
 * Leaf D — OptionCards
 *
 * Large tappable reply-option cards rendered inside the chat, under the
 * message that carries them (message.options). Tapping a card sends its
 * text through onPick (the store's sendText in production). Big targets
 * and high contrast for an elderly user — Spanish labels only, no emojis.
 */

import type { ReactElement } from "react";

import "./chat-content.css";

export interface OptionCardsProps {
  options: readonly string[];
  onPick: (option: string) => void;
}

export function OptionCards({ options, onPick }: OptionCardsProps): ReactElement | null {
  if (options.length === 0) return null;
  return (
    <div className="option-cards" aria-label="Opciones de respuesta">
      {options.map((option, index) => (
        <button
          key={`${option}-${index}`}
          type="button"
          className="option-card"
          onClick={() => onPick(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
