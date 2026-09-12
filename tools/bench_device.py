"""Is the GPU actually being used, and how fast is each device on the same audio?"""

from __future__ import annotations

import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

import ctranslate2  # noqa: E402
from faster_whisper import WhisperModel  # noqa: E402

CLIP = str(REPO_ROOT / "data" / "baseline" / "nxf_MM9Kzkw.m4a")
MODEL_DIR = r"C:\dev\models\whisper\large-v3-turbo"
SMALL_DIR = r"C:\dev\models\whisper\small"


def gpu_once() -> str:
    out = subprocess.run(
        ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used",
         "--format=csv,noheader"],
        capture_output=True, text=True, timeout=20,
    )
    return out.stdout.strip()


def sampler(stop: threading.Event, seen: list[str]) -> None:
    while not stop.is_set():
        try:
            seen.append(gpu_once())
        except Exception as exc:  # noqa: BLE001
            seen.append(f"err {exc}")
        time.sleep(0.4)


def bench(label: str, model_dir: str, device: str, compute_type: str) -> None:
    print(f"\n=== {label}: device={device} compute={compute_type} ===")
    try:
        started = time.perf_counter()
        model = WhisperModel(model_dir, device=device, compute_type=compute_type)
        load = time.perf_counter() - started
    except Exception as exc:  # noqa: BLE001
        print("  LOAD FAILED:", type(exc).__name__, str(exc)[:200])
        return
    saw: list[str] = []
    stop = threading.Event()
    watcher = threading.Thread(target=sampler, args=(stop, saw), daemon=True)
    watcher.start()
    model.transcribe(np.zeros(16000, dtype="float32"), language="es")[0].__iter__()
    durations = []
    for _ in range(2):
        started = time.perf_counter()
        segments, info = model.transcribe(CLIP, language="es", beam_size=5, vad_filter=True)
        list(segments)
        elapsed = time.perf_counter() - started
        durations.append(elapsed)
        print(f"  transcribe {elapsed:5.2f}s  RTF {elapsed / info.duration:5.3f}")
    stop.set()
    watcher.join(timeout=2)
    unique = sorted(set(saw))
    print(f"  load {load:5.2f}s   gpu samples: {unique}")
    del model


print("ct2", ctranslate2.__version__, "cuda devices", ctranslate2.get_cuda_device_count())
print("idle gpu:", gpu_once())
bench("turbo", MODEL_DIR, "cuda", "float16")
bench("turbo", MODEL_DIR, "cpu", "int8")
bench("small", SMALL_DIR, "cpu", "int8")
