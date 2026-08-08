import { useEffect, useRef } from "react";
import { useStore } from "zustand";

import { authHeaders, TTS_URL } from "../endpoints";
import { appStore } from "../store";

/**
 * Plays the store's speak queue: POSTs each phrase to the agent service
 * (/tts, JSON body — never the text in a URL), plays the returned audio,
 * and advances. Playback rate follows the config-driven tts.speed. When
 * the queue is cleared (the stop button) the current playback is
 * interrupted immediately. Never touches the store's voice state — that
 * stays server-owned.
 */
export function TtsPlayer() {
  const speakTexts = useStore(appStore, (s) => s.speakTexts);
  const ttsDone = useStore(appStore, (s) => s.ttsDone);
  const ttsSpeed = useStore(appStore, (s) => s.ttsSpeed);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const text = speakTexts[0];

  useEffect(() => {
    if (!text) {
      audioRef.current?.pause();
      audioRef.current = null;
      return;
    }
    let finished = false;
    let objectUrl: string | null = null;
    const audio = new Audio();
    audio.playbackRate = ttsSpeed > 0 ? ttsSpeed : 1;
    audioRef.current = audio;
    const advance = () => {
      if (finished) return;
      finished = true;
      ttsDone();
    };
    audio.onended = advance;
    audio.onerror = advance; // never block the queue on a failed fetch
    void (async () => {
      try {
        const res = await fetch(TTS_URL, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`tts ${res.status}`);
        const blob = await res.blob();
        if (finished) return; // queue advanced while we were fetching
        objectUrl = URL.createObjectURL(blob);
        audio.src = objectUrl;
        await playWithFallback(audio);
      } catch {
        advance();
      }
    })();
    return () => {
      finished = true;
      audio.pause();
      audioRef.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [text, ttsDone, ttsSpeed]);

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
