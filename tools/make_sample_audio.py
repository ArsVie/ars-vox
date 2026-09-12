from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.tts import WindowsTTS  # noqa: E402

if __name__ == "__main__":
    text = " ".join(sys.argv[1:]) or "Hola, soy Ars Vox."
    out = REPO_ROOT / "results" / "selftest" / "spanish_sample.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    print(WindowsTTS().synthesize(text, out))
