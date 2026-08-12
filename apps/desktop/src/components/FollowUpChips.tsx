/**
 * Leaf D — FollowUpChips
 *
 * Small follow-up suggestion chips rendered inside the chat, under the
 * message that carries them (message.followUps). Tapping a chip sends
 * its text through onPick (the store's sendText in production).
 */

import type { ReactElement } from "react";

import "./chat-content.css";

export interface FollowUpChipsProps {
  followUps: readonly string[];
  onPick: (followUp: string) => void;
}

export function FollowUpChips({ followUps, onPick }: FollowUpChipsProps): ReactElement | null {
  if (followUps.length === 0) return null;
  return (
    <div className="followup-chips" aria-label="Sugerencias para continuar">
      {followUps.map((followUp, index) => (
        <button
          key={`${followUp}-${index}`}
          type="button"
          className="followup-chip"
          onClick={() => onPick(followUp)}
        >
          {followUp}
        </button>
      ))}
    </div>
  );
}
