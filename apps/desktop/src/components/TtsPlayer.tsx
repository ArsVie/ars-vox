import { useEffect, useRef } from "react";
import { useStore } from "zustand";

import { appStore } from "../store";

const TTS_URL = "http://127.0.0.1:8765/tts";

/**
 * Plays the store's speak queue: fetches each phrase from the agent
 * service (GET /tts), plays it, and advances. When the queue is cleared
 * (the stop button) the current playback is interrupted immediately.
 * Never touches the store's voice state — that stays server-owned.
 */
export function TtsPlayer() {
  const speakTexts = useStore(appStore, (s) => s.speakTexts);
  const ttsDone = useStore(appStore, (s) => s.ttsDone);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const text = speakTexts[0];

  useEffect(() => {
    if (!text) {
      audioRef.current?.pause();
      audioRef.current = null;
      return;
    }
    let finished = false;
    const audio = new Audio(`${TTS_URL}?text=${encodeURIComponent(text)}`);
    audioRef.current = audio;
    const advance = () => {
      if (finished) return;
      finished = true;
      ttsDone();
    };
    audio.onended = advance;
    audio.onerror = advance; // never block the queue on a failed fetch
    void playWithFallback(audio).catch(advance);
    return () => {
      finished = true;
      audio.pause();
      audioRef.current = null;
    };
  }, [text, ttsDone]);

  return null;
}

/**
 * Plays the audio. If the browser blocks unmuted autoplay (no user
 * gesture yet), retry muted and unmute once playback actually starts —
 * Chromium allows muted autoplay anywhere. Electron ships with
 * no-user-gesture-required so this fallback is only for plain browsers.
 */
async function playWithFallback(audio: HTMLAudioElement): Promise<void> {
  try {
    await audio.play();
    return;
  } catch {
    // NotAllowedError (autoplay policy): retry muted, then unmute.
    audio.muted = true;
    await audio.play();
    const unmute = () => {
      audio.muted = false;
    };
    audio.addEventListener("playing", unmute, { once: true });
  }
}
