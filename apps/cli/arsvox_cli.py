"""Headless driver for Ars-Vox. This is the primary development surface.

Everything about the product loop is driven from here, without Electron: the
ears, the loop, the tools, the log, and the mouth.

    python apps/cli/arsvox_cli.py transcribe clip.m4a --model small
    python apps/cli/arsvox_cli.py speak "Hola, soy Ars Vox." --play
    python apps/cli/arsvox_cli.py roundtrip "Ponme un video de los Beatles"
    python apps/cli/arsvox_cli.py ask "recordame tomar la pastilla a las ocho" --trace
    python apps/cli/arsvox_cli.py chat --speak
    python apps/cli/arsvox_cli.py talk --seconds 15      # voice in, voice out
    python apps/cli/arsvox_cli.py log --session cli
    python apps/cli/arsvox_cli.py sessions
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.audio import play_wav, write_wav  # noqa: E402
from services.arsvox.tts import EdgeTTS, FakeTTS  # noqa: E402
from services.arsvox.voice import DEFAULT_LANGUAGE, FasterWhisperSTT  # noqa: E402
from tools.stt_baseline import word_error_rate  # noqa: E402

WORK_DIR = REPO_ROOT / "results" / "cli"


def build_tts(engine: str, voice: str | None = None):
    """The product voice is edge-tts. The Windows system voice is banned by ear."""
    return FakeTTS() if engine == "fake" else EdgeTTS(voice=voice)


def build_stt(args: argparse.Namespace) -> FasterWhisperSTT:
    """The configured engine, with a visible fallback when there is no GPU.

    Any command may ask for ears, so the flags are read defensively: serve has no
    --model of its own and must still get the product engine.
    """
    size = getattr(args, "model", None) or "large-v3-turbo"
    device = getattr(args, "device", None) or "cuda"
    compute = getattr(args, "compute_type", None) or "float16"
    if os.environ.get("ARSVOX_DEVICE"):
        device = os.environ["ARSVOX_DEVICE"]
    if os.environ.get("ARSVOX_COMPUTE"):
        compute = os.environ["ARSVOX_COMPUTE"]
    engine = FasterWhisperSTT(model_size=size, device=device, compute_type=compute)
    if device != "cpu":
        try:
            engine.warmup()
        except Exception as exc:  # noqa: BLE001
            print(
                f"aviso: no pude usar {args.device}/{args.compute_type} ({type(exc).__name__}); "
                "sigo en CPU int8",
                file=sys.stderr,
            )
            engine = FasterWhisperSTT(model_size=size, device="cpu", compute_type="int8")
    return engine


# ---- agent -----------------------------------------------------------------

def build_runtime(args: argparse.Namespace):
    from services.arsvox.config import load_settings
    from services.arsvox.model import HttpChatModel
    from services.arsvox.runtime import Runtime
    from services.arsvox.scheduler import TaskScheduler
    from services.arsvox.store import Store

    settings = load_settings(session=args.session)
    store = Store(settings.db_path)
    model = HttpChatModel(
        settings.base_url,
        settings.model,
        settings.api_key,
        temperature=settings.temperature,
        max_tokens=settings.max_tokens,
        timeout_s=settings.timeout_s,
    )
    return Runtime(settings, store, model, scheduler=TaskScheduler(REPO_ROOT)), settings, store


def report_turn(result, args: argparse.Namespace) -> None:
    for trace in result.tools:
        marker = "ok" if trace.ran else "NO"
        print(f"   [{marker}] {trace.name}({json.dumps(trace.arguments, ensure_ascii=False)}) -> {trace.result}")
    if args.trace:
        usage = result.usage.as_dict()
        print(
            f"   {result.steps} paso(s), {result.elapsed_s:.2f}s, "
            f"prompt {usage['prompt_tokens']} (cache {usage['cached_tokens']}, "
            f"hit {usage['cache_hit_rate']:.0%}), salida {usage['completion_tokens']}"
        )
    if result.error:
        print(f"   error: {result.error}", file=sys.stderr)


def speak_reply(text: str, args: argparse.Namespace) -> None:
    if not getattr(args, "speak", False) or not text.strip():
        return
    out = WORK_DIR / "reply.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    build_tts(args.engine).synthesize(text, out)
    play_wav(out)


def cmd_ask(args: argparse.Namespace) -> int:
    runtime, _, _ = build_runtime(args)
    if args.audio:
        stt = build_stt(args)
        heard = stt.transcribe(args.audio)
        print(f"vos: {heard.text}   ({heard.duration_s:.1f}s audio, {heard.elapsed_s:.2f}s engine)")
        if not heard.text.strip():
            print("no entendí el audio", file=sys.stderr)
            return 1
        text = heard.text
    else:
        text = args.text
    result = runtime.turn(args.session, text)
    print(result.text)
    report_turn(result, args)
    speak_reply(result.text, args)
    return 0


def cmd_chat(args: argparse.Namespace) -> int:
    runtime, settings, store = build_runtime(args)
    print(f"Ars Vox — sesión '{args.session}', modelo {settings.model}. Vacío para salir.\n")
    while True:
        try:
            line = input("vos: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not line:
            break
        if line in ("/q", "salir", "chau"):
            break
        if line == "/estado":
            print(f"   {store.state_counts(args.session)}")
            continue
        if line == "/log":
            for event in store.events(args.session)[-8:]:
                print(f"   {event.id} {event.kind} {json.dumps(event.payload, ensure_ascii=False)[:120]}")
            continue
        result = runtime.turn(args.session, line)
        print(f"ars vox: {result.text}")
        report_turn(result, args)
        speak_reply(result.text, args)
    return 0


def cmd_talk(args: argparse.Namespace) -> int:
    """The whole product loop: microphone, ears, model, tools, voice."""
    try:
        from services.arsvox.mic import normalize_gain, record_until_silence
    except ImportError:
        print("la captura necesita el venv de Windows con sounddevice", file=sys.stderr)
        return 2

    runtime, settings, store = build_runtime(args)
    stt = build_stt(args)
    print(f"Ars Vox — hable después del aviso. Modelo {settings.model}. Enter para salir.\n")
    print(f"calentando el reconocedor ... {stt.warmup() if args.device != 'cpu' else 0:.1f}s")

    while True:
        try:
            input("[Enter] para hablar ")
        except (EOFError, KeyboardInterrupt):
            print()
            break
        capture = record_until_silence(max_seconds=args.seconds, device=args.input_device)
        if not capture.has_speech:
            print("   no escuché nada\n")
            continue
        samples = normalize_gain(capture.samples)
        clip = WORK_DIR / f"talk-{int(time.time())}.wav"
        clip.parent.mkdir(parents=True, exist_ok=True)
        write_wav(clip, samples, 16_000)
        heard = stt.transcribe(samples)
        print(f"vos: {heard.text}   ({capture.speech_seconds:.1f}s de voz, {heard.elapsed_s:.2f}s)")
        if not heard.text.strip():
            print("   no entendí, pruebe de nuevo\n")
            continue
        result = runtime.turn(args.session, heard.text)
        print(f"ars vox: {result.text}")
        report_turn(result, args)
        speak_reply(result.text, args)
        print()
    return 0


# ---- the window ------------------------------------------------------------

def cmd_serve(args: argparse.Namespace) -> int:
    """The agent service plus the shell it serves. Also used by the Electron main."""
    from services.arsvox.api import AgentService, serve

    runtime, settings, store = build_runtime(args)
    tts = None if args.no_tts else build_tts(args.engine, settings.voice)
    stt = None if args.no_ears else build_stt(args)
    agent = AgentService(
        runtime,
        store,
        tts=tts,
        stt=stt,
        session=args.session,
        static_dir=REPO_ROOT / "apps" / "desktop",
        listen_seconds=args.seconds,
    )
    httpd = serve(agent, args.host, args.port)
    print(
        f"Ars Vox en http://{args.host}:{args.port}  (sesión {args.session}, modelo {settings.model}, "
        f"voz {'sí' if tts else 'no'}, oídos {'sí' if stt else 'no'})",
        flush=True,
    )
    if stt is not None:
        # loading the model costs seconds; pay it now, not on the first request
        threading.Thread(target=stt.warmup, daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        agent.shutdown()   # a turn in flight must reach the log before the store closes
        httpd.server_close()
        store.close()
    return 0


# ---- reminders -------------------------------------------------------------

def cmd_fire(args: argparse.Namespace) -> int:
    """What a scheduled task runs. Never prints: pythonw has no console."""
    from services.arsvox.store import Store

    store = Store(args.db)
    reminder = store.get_reminder(args.session, args.id)
    log_dir = REPO_ROOT / "results" / "reminders"
    log_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with (log_dir / "fired.log").open("a", encoding="utf-8") as handle:
        if reminder is None:
            handle.write(f"{stamp} id={args.id} no existe\n")
            return 1
        spoken = f"Acuérdese: {reminder['text']}."
        wav = log_dir / f"reminder-{args.id}.wav"
        error = ""
        try:
            build_tts(args.engine).synthesize(spoken, wav)
            if not args.silent:
                play_wav(wav)
        except Exception as exc:  # noqa: BLE001 - a reminder with no voice still happened
            error = f"{type(exc).__name__}: {exc}"[:200]
        store.append(
            args.session,
            "reminder_fired",
            {"id": args.id, "spoken": spoken, "played": not args.silent and not error, "error": error},
        )
        store.mark_fired(args.session, args.id)
        handle.write(
            f"{stamp} id={args.id} repeat={reminder['repeat']} "
            f"played={not args.silent and not error} wav={wav.name} {error}\n"
        )
    return 0


def cmd_reminders(args: argparse.Namespace) -> int:
    from services.arsvox.scheduler import TaskScheduler
    from services.arsvox.store import Store

    store = Store(args.db)
    rows = store.list_reminders(args.session, active_only=not args.all)
    if not rows:
        print(f"sin recordatorios activos en '{args.session}'")
    scheduler = TaskScheduler(REPO_ROOT) if (args.sync or args.query) else None
    for row in rows:
        line = f"{row['id']:3d}  {row['text'][:44]:44s}  {row['when_local'] or 'sin hora':16s}  {row['repeat']}"
        if scheduler and args.query and row["when_local"]:
            info = scheduler.query(int(row["id"]))
            line += f"  tarea: {info.next_run or 'FALTA'}"
        print(line)
    if args.sync:
        print(json.dumps(scheduler.sync(rows, args.session), ensure_ascii=False, indent=2))
    return 0


# ---- log -------------------------------------------------------------------

def cmd_log(args: argparse.Namespace) -> int:
    from services.arsvox.store import Store, project

    store = Store(args.db)
    events = store.events(args.session)
    for event in events[-args.limit :]:
        if args.projected:
            message = project(event)
            if message is None:
                continue
            print(json.dumps(message, ensure_ascii=False))
        else:
            print(f"{event.id:5d} {event.ts[:19]} {event.kind:18s} "
                  f"{json.dumps(event.payload, ensure_ascii=False)[:150]}")
    print(f"-- {len(events)} eventos en '{args.session}'", file=sys.stderr)
    return 0


def cmd_sessions(args: argparse.Namespace) -> int:
    from services.arsvox.store import Store

    for row in Store(args.db).sessions():
        print(f"{row['session']:20s} {row['events']:5d} eventos   último {row['last_ts'][:19]}")
    return 0


# ---- voice only ------------------------------------------------------------

def cmd_transcribe(args: argparse.Namespace) -> int:
    engine = FasterWhisperSTT(model_size=args.model, device=args.device, compute_type=args.compute_type)
    result = engine.transcribe(args.audio, language=args.language)
    if args.json:
        print(json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
    else:
        print(result.text)
        print(
            f"-- {result.duration_s}s audio, {result.elapsed_s}s engine, "
            f"RTF {result.real_time_factor:.2f}, mean logprob {result.mean_logprob:.2f}",
            file=sys.stderr,
        )
    return 0


def cmd_speak(args: argparse.Namespace) -> int:
    out = args.out or WORK_DIR / "speak.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    path = build_tts(args.engine).synthesize(args.text, out)
    print(path)
    if args.play:
        play_wav(path)
    return 0


def cmd_roundtrip(args: argparse.Namespace) -> int:
    """Speak text out loud, listen to it again, compare. The cheapest self-test."""
    audio = WORK_DIR / f"roundtrip-{int(time.time())}.wav"
    audio.parent.mkdir(parents=True, exist_ok=True)
    build_tts(args.engine).synthesize(args.text, audio)
    result = FasterWhisperSTT(model_size=args.model).transcribe(audio)
    error = word_error_rate(args.text, result.text)
    print(f"spoken    {args.text}")
    print(f"heard     {result.text}")
    print(f"WER       {error['wer']}   ({result.elapsed_s}s engine, RTF {result.real_time_factor:.2f})")
    return 0


def cmd_listen(args: argparse.Namespace) -> int:
    """Capture from the real microphone. Runs on the Windows machine, not in WSL."""
    try:
        import sounddevice  # noqa: F401
    except ImportError:
        print("sounddevice is not installed: capture needs the service venv", file=sys.stderr)
        return 2
    import sounddevice as sd

    from services.arsvox.mic import normalize_gain, record_until_silence

    capture = record_until_silence(max_seconds=args.seconds, device=args.input_device)
    if not capture.has_speech:
        print("no escuché nada", file=sys.stderr)
        return 1
    samples = normalize_gain(capture.samples)
    out = WORK_DIR / f"mic-{int(time.time())}.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    write_wav(out, samples, 16_000)
    engine = FasterWhisperSTT(model_size=args.model, device=args.device, compute_type=args.compute_type)
    print(engine.transcribe(samples).text)
    return 0


def add_engine_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--compute-type", default="float16")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ars-Vox headless driver")
    sub = parser.add_subparsers(dest="command", required=True)

    transcribe = sub.add_parser("transcribe", help="transcribe one audio file")
    transcribe.add_argument("audio", type=Path)
    transcribe.add_argument("--model", default="small")
    transcribe.add_argument("--device", default="cpu")
    transcribe.add_argument("--compute-type", default="int8")
    transcribe.add_argument("--language", default=DEFAULT_LANGUAGE)
    transcribe.add_argument("--json", action="store_true")
    transcribe.set_defaults(func=cmd_transcribe)

    speak = sub.add_parser("speak", help="speak text to a wav file")
    speak.add_argument("text")
    speak.add_argument("--engine", default="edge", choices=["edge", "fake"])
    speak.add_argument("--out", type=Path)
    speak.add_argument("--play", action="store_true")
    speak.set_defaults(func=cmd_speak)

    roundtrip = sub.add_parser("roundtrip", help="speak then listen, and compare")
    roundtrip.add_argument("text")
    roundtrip.add_argument("--engine", default="edge", choices=["edge", "fake"])
    roundtrip.add_argument("--model", default="small")
    roundtrip.set_defaults(func=cmd_roundtrip)

    for name, func, help_text in (
        ("ask", cmd_ask, "one request through the loop, typed or from an audio file"),
        ("chat", cmd_chat, "typed conversation"),
    ):
        node = sub.add_parser(name, help=help_text)
        if name == "ask":
            node.add_argument("text", nargs="?")
            node.add_argument("--audio", type=Path, help="a recorded request instead of typed text")
            add_engine_flags(node)
        node.add_argument("--session", default="cli")
        node.add_argument("--speak", action="store_true", help="read the answer out loud")
        node.add_argument("--engine", default="edge", choices=["edge", "fake"])
        node.add_argument("--trace", action="store_true")
        node.set_defaults(func=func, db=None)

    talk = sub.add_parser("talk", help="voice in, voice out, real microphone")
    talk.add_argument("--session", default="cli")
    talk.add_argument("--seconds", type=float, default=15.0)
    talk.add_argument("--input-device", type=int)
    talk.add_argument("--engine", default="edge", choices=["edge", "fake"])
    talk.add_argument("--trace", action="store_true")
    talk.add_argument("--speak", action="store_true", default=True)
    talk.set_defaults(func=cmd_talk, db=None)
    add_engine_flags(talk)

    listen = sub.add_parser("listen", help="capture from the microphone and transcribe")
    listen.add_argument("--seconds", type=float, default=15.0)
    listen.add_argument("--input-device", type=int)
    listen.add_argument("--model", default="small")
    listen.add_argument("--device", default="cuda")
    listen.add_argument("--compute-type", default="float16")
    listen.set_defaults(func=cmd_listen)

    log = sub.add_parser("log", help="print the event log")
    log.add_argument("--session", default="cli")
    log.add_argument("--db", type=Path, default=REPO_ROOT / "data" / "arsvox.db")
    log.add_argument("--limit", type=int, default=40)
    log.add_argument("--projected", action="store_true", help="show the model messages instead")
    log.set_defaults(func=cmd_log)

    fire = sub.add_parser("fire", help="fire one reminder: speak it, log it, mark it done")
    fire.add_argument("id", type=int)
    fire.add_argument("--session", default="cli")
    fire.add_argument("--db", type=Path, default=REPO_ROOT / "data" / "arsvox.db")
    fire.add_argument("--engine", default="edge", choices=["edge", "fake"])
    fire.add_argument("--silent", action="store_true", help="write the audio but do not play it")
    fire.set_defaults(func=cmd_fire)

    reminders = sub.add_parser("reminders", help="list reminders and their scheduled tasks")
    reminders.add_argument("--session", default="cli")
    reminders.add_argument("--db", type=Path, default=REPO_ROOT / "data" / "arsvox.db")
    reminders.add_argument("--all", action="store_true", help="include cancelled and fired ones")
    reminders.add_argument("--sync", action="store_true", help="re-register every timed reminder")
    reminders.add_argument("--query", action="store_true", help="ask Windows for the next run time")
    reminders.set_defaults(func=cmd_reminders)

    sessions = sub.add_parser("sessions", help="list sessions in the log")
    sessions.add_argument("--db", type=Path, default=REPO_ROOT / "data" / "arsvox.db")
    sessions.set_defaults(func=cmd_sessions)

    server = sub.add_parser("serve", help="run the agent service and the shell")
    server.add_argument("--host", default="127.0.0.1")
    server.add_argument("--port", type=int, default=8790)
    server.add_argument("--session", default="cli")
    server.add_argument("--engine", default="edge", choices=["edge", "fake"])
    server.add_argument("--no-tts", action="store_true", help="serve without the voice")
    server.add_argument("--no-ears", action="store_true", help="serve without the microphone")
    server.add_argument("--seconds", type=float, default=15.0, help="longest single request")
    server.add_argument("--model", default="large-v3-turbo", help="speech model for the ears")
    server.add_argument("--device", default="cuda", help="cuda or cpu")
    server.add_argument("--compute-type", default="float16", help="float16, int8_float16, int8")
    server.set_defaults(func=cmd_serve, db=None)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
