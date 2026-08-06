#!/usr/bin/env python3
"""Real voice round trip, no microphone needed:

  edge TTS synthesizes a Spanish phrase  ->  WAV file
  faster-whisper transcribes it          ->  text

This proves the real STT provider works with a real audio file; the
microphone source (Electron renderer capture) plugs into the same
SpeechToText interface later.

Usage:
  .venv/bin/python scripts/demo_voice.py [--text "Hola, abre el documento"]
"""

import argparse
import asyncio
import sys
import tempfile
from pathlib import Path


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text", default="Hola, abre el documento, por favor.")
    parser.add_argument("--voice", default="es-MX-DaliaNeural")
    parser.add_argument("--model", default="tiny")
    args = parser.parse_args()

    try:
        import edge_tts
    except ImportError:
        print("FAIL: edge-tts not installed (.venv/bin/pip install edge-tts)")
        return 1

    tmp = Path(tempfile.mkdtemp())
    mp3_path = tmp / "phrase.mp3"

    print(f"1. synthesizing with edge_tts ({args.voice}): {args.text!r}")
    communicate = edge_tts.Communicate(args.text, args.voice)
    chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])
    if not chunks:
        print("FAIL: edge_tts returned no audio")
        return 1
    mp3_path.write_bytes(b"".join(chunks))
    print(f"   audio: {len(chunks)} chunks -> {mp3_path} ({mp3_path.stat().st_size} bytes)")

    from arsvox_voice.providers import FasterWhisperSTT

    print(f"2. transcribing with faster-whisper ({args.model}, cpu/int8)")
    stt = FasterWhisperSTT(model_size=args.model)
    text = await stt.transcribe(str(mp3_path), language="es")
    print(f"   recognized: {text!r}")

    norm = "".join(c for c in text.lower() if c.isalnum() or c.isspace()).split()
    expected = "".join(c for c in args.text.lower() if c.isalnum() or c.isspace()).split()
    hits = sum(1 for w in expected if w in norm)
    ratio = hits / max(len(expected), 1)
    print(f"3. word overlap: {hits}/{len(expected)} ({ratio:.0%})")
    if ratio >= 0.5:
        print("VOICE_OK")
        return 0
    print("VOICE_FAIL: recognized text does not match the phrase closely enough")
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
