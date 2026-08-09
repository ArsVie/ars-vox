import { useEffect, useRef } from "react";
import { useStore } from "zustand";

import type { TtsAckMessage } from "../contracts";
import { authenticatedFetch, TTS_URL } from "../endpoints";
import { appStore } from "../store";

/**
 * Plays the store's speak queue: POSTs each phrase to the agent service
 * (/tts, JSON body — never the text in a URL), plays the returned audio,
 * and advances. Playback rate follows the config-driven tts.speed. When
 * the queue is cleared (the stop button) the current playback is
 * interrupted immediately.
 *
 * GATE-3.5 (C4/R08): the renderer is the PHYSICAL playback authority.
 * Every phrase reports its real lifecycle to the service:
 *   - tts.started  when audio actually begins playing,
 *   - tts.finished when it ends (or fails to play — either way no
 *     speech is coming from this item),
 *   - tts.cancelled when playback is interrupted by a queue clear
 *     (STOP button or a spoken-stop state_update) while playing.
 * The service's canonical voice state machine only reaches LISTENING
 * after tts.finished, so the UI never claims to be listening while the
 * speaker is still talking (R05/R06/R07/R08).
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
    const player = new PhrasePlayer({
      text,
      ttsSpeed,
      send: (ack) => {
        try {
          appStore.getState().send(ack);
        } catch {
          // socket down: the service settles pending speech on disconnect
        }
      },
      onDone: ttsDone,
      onError: (message) => {
        // LOUD failure (W0): a transport error must reach the error banner,
        // never render as a silently mute assistant.
        appStore.getState().setError({ message, recoverable: true });
      },
    });
    audioRef.current = player.audio;
    void player.start();
    return () => {
      player.dispose();
      audioRef.current = null;
    };
  }, [text, ttsDone, ttsSpeed]);

  return null;
}

/**
 * One phrase of physical playback: fetch audio, play it, and report the
 * real lifecycle (started/finished/cancelled) to the service. Lives
 * outside the component so the ack contract is testable in a plain node
 * env (repo convention — no jsdom), the same way MicCapture is.
 */
export class PhrasePlayer {
  readonly audio: HTMLAudioElement;
  private finished = false;
  private started = false;
  private objectUrl: string | null = null;

  constructor(
    private readonly opts: {
      text: string;
      ttsSpeed: number;
      send: (ack: TtsAckMessage) => void;
      onDone: () => void;
      /** Transport failures (non-OK / rejected fetch) surface here BEFORE
       *  the settle ack — silence with a finished ack is the W0 defect. */
      onError?: (message: string) => void;
    },
  ) {
    const audio = new Audio();
    audio.playbackRate = opts.ttsSpeed > 0 ? opts.ttsSpeed : 1;
    this.audio = audio;
    audio.onended = () => {
      if (this.started) opts.send({ type: "tts.finished" });
      this.advance();
    };
    audio.onerror = () => {
      // Decode/playback failure mid-phrase: no more speech from this
      // item — ack finished so the machine settles.
      if (this.started) opts.send({ type: "tts.finished" });
      this.advance(); // never block the queue on a failed fetch
    };
  }

  /** Fetch the audio and start playback. Resolves once play() settles. */
  async start(): Promise<void> {
    const { text, send } = this.opts;
    try {
      // GATE-3.5 (W0): the AUTHENTICATED transport — through the Electron
      // bridge (window.arsvox.fetch) when present, so the per-launch token
      // is attached by the main process. A raw fetch() here is the W0
      // defect: unauthenticated in the packaged build (401, silent mute).
      const res = await authenticatedFetch(TTS_URL, {
        method: "POST",
        body: JSON.stringify({ text }),
        contentType: "application/json",
      });
      if (!res.ok) {
        // LOUD failure BEFORE the settle ack: a 401 must show a diagnostic
        // on the error banner, not ack finished and disappear.
        this.opts.onError?.(`El servicio de voz rechazó la solicitud (HTTP ${res.status})`);
        throw new Error(`tts ${res.status}`);
      }
      const blob = await res.blob();
      if (this.finished) return; // queue advanced while we were fetching
      this.objectUrl = URL.createObjectURL(blob);
      this.audio.src = this.objectUrl;
      this.audio.addEventListener(
        "playing",
        () => {
          // Guard: dispose() during the play() await (queue cleared)
          // must not let a stale started ack reach the service.
          if (this.finished) return;
          this.started = true;
          send({ type: "tts.started" });
        },
        { once: true },
      );
      await playWithFallback(this.audio);
    } catch {
      if (!this.finished) {
        // Fetch/play failed before anything played: no speech will come
        // from this phrase — ack finished so the machine settles out of
        // THINKING.
        send({ type: "tts.finished" });
      }
      this.advance();
    }
  }

  /** Interrupt: queue cleared / unmounted. Acks cancelled when playing. */
  dispose(): void {
    const wasPlaying = this.started && !this.finished;
    this.finished = true;
    this.audio.pause();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    if (wasPlaying) this.opts.send({ type: "tts.cancelled" });
  }

  private advance(): void {
    if (this.finished) return;
    this.finished = true;
    this.opts.onDone();
  }
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
