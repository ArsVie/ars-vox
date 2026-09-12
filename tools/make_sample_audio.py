"""Generate a spoken Spanish sample with the product voice."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.tts import EdgeTTS  # noqa: E402


def main() -> int:
    text = sys.argv[1] if len(sys.argv) > 1 else "Hola, soy Ars Vox. ¿Qué querés que haga?"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else REPO_ROOT / "results" / "sample.wav"
    print(EdgeTTS().synthesize(text, out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
