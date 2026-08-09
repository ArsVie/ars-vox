"""Local library discovery (GATE-5 W1-MEDIA-LOCAL).

The library dir is a REAL tmp dir populated with REAL audio files generated
in the test (wav via the stdlib wave module, plus structurally-valid mp3 /
ogg / flac / m4a containers), alongside non-audio files that must be
excluded. Honest empty-library result is tested explicitly — never a
fixture list.
"""

import struct
import wave
import zlib
from pathlib import Path

from arsvox_contracts.enums import MediaKind, MediaSource

from arsvox_agent.search.local_library import (
    AUDIO_EXTENSIONS,
    discover_library,
    is_playable_audio,
    resolve_library_file,
)


# ---------------------------------------------------------------------- #
# Real audio file generators (structure-valid, playable by a decoder)
# ---------------------------------------------------------------------- #

def write_wav(path: Path, seconds: float = 0.2, rate: int = 8000) -> None:
    """A REAL wav file via the stdlib wave module (silent PCM tone)."""
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))


def write_mp3(path: Path, frames: int = 3) -> None:
    """A real (silent) MPEG-1 Layer III frame stream — 417-byte frames at
    128kbps/44.1kHz: header 0xFF 0xFB 0x90 0x00 + 413 zero bytes."""
    header = b"\xff\xfb\x90\x00"
    frame = header + b"\x00" * 413
    path.write_bytes(frame * frames)


def write_ogg(path: Path) -> None:
    """A real Ogg page carrying a Vorbis identification header.

    Ogg CRC-32 is the standard zlib CRC over the page with the CRC field
    zeroed — computed here so the page is structurally valid.
    """
    payload = (
        b"\x01vorbis"  # packet type 1 (identification)
        + struct.pack("<I", 0)  # vorbis version
        + struct.pack("<B", 2)  # channels
        + struct.pack("<I", 44100)  # sample rate
        + struct.pack("<i", 0)  # bitrate max
        + struct.pack("<i", 128000)  # bitrate nominal
        + struct.pack("<i", 0)  # bitrate min
        + struct.pack("<B", 0xB8)  # blocksizes
        + b"\x01"  # framing flag
    )
    header = (
        b"OggS"  # capture pattern
        + b"\x00"  # version
        + b"\x02"  # header type: BOS
        + struct.pack("<q", 0)  # granule position
        + struct.pack("<I", 0x12345678)  # serial
        + struct.pack("<I", 0)  # page sequence
        + b"\x00\x00\x00\x00"  # CRC (zeroed for computation)
        + struct.pack("<B", 1)  # page segments
        + struct.pack("<B", len(payload))  # segment table
    )
    crc = zlib.crc32(header + payload) & 0xFFFFFFFF
    page = header[:22] + struct.pack("<I", crc) + header[26:]
    path.write_bytes(page + payload)


def write_flac(path: Path) -> None:
    """A real FLAC file: 'fLaC' magic + one STREAMINFO metadata block."""
    streaminfo = bytearray()
    streaminfo += struct.pack(">HH", 4096, 4096)  # min/max block size
    streaminfo += struct.pack(">I", 0)  # min frame size
    streaminfo += struct.pack(">I", 0)  # max frame size
    # sample rate 44100 (20 bits) | channels-1 (3 bits) | bits-per-sample-1 (5 bits)
    streaminfo += struct.pack(">I", (44100 << 12) | ((2 - 1) << 9) | (16 - 1))
    streaminfo += struct.pack(">Q", 0)  # total samples (36 bits, 0 = unknown)
    streaminfo += b"\x00" * 16  # MD5 (unknown)
    # last-metadata-block flag (0x80) + STREAMINFO type (0) + 34-byte length
    path.write_bytes(b"fLaC" + b"\x80\x00\x00\x22" + bytes(streaminfo))


def write_m4a(path: Path) -> None:
    """A real (minimal) M4A container: ftyp box with the M4A brand."""
    brand = b"M4A "
    ftyp = b"ftyp" + brand + struct.pack("<I", 0) + brand + b"isom"
    path.write_bytes(struct.pack(">I", 8 + len(ftyp)) + ftyp)


def _library(tmp_path: Path) -> Path:
    """A real library: audio in nested folders + decoys."""
    lib = tmp_path / "library"
    (lib / "Taller de Marta").mkdir(parents=True)
    (lib / "Bricolaje").mkdir()
    write_wav(lib / "Taller de Marta" / "sierra.wav")
    write_mp3(lib / "Taller de Marta" / "banco.mp3")
    write_ogg(lib / "Bricolaje" / "lija.ogg")
    write_flac(lib / "Bricolaje" / "torno.flac")
    write_m4a(lib / "caja.m4a")
    # Decoys that discovery must NEVER return.
    (lib / "notas.txt").write_text("no soy audio", encoding="utf-8")
    (lib / "portada.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    return lib


def test_extension_set_covers_the_documented_formats():
    for ext in (".mp3", ".m4a", ".wav", ".ogg", ".flac"):
        assert ext in AUDIO_EXTENSIONS


def test_is_playable_audio_case_insensitive():
    assert is_playable_audio("tema.MP3")
    assert is_playable_audio(Path("a/b/track.Flac"))
    assert not is_playable_audio("notas.txt")
    assert not is_playable_audio("noext")


def test_discovers_real_audio_files_with_local_source_members(tmp_path):
    lib = _library(tmp_path)

    results = discover_library(lib)

    by_id = {r.id: r for r in results}
    assert set(by_id) == {
        "Taller de Marta/sierra.wav",
        "Taller de Marta/banco.mp3",
        "Bricolaje/lija.ogg",
        "Bricolaje/torno.flac",
        "caja.m4a",
    }
    for r in results:
        # The local-source wire members: every result is LOCAL audio.
        assert r.source == MediaSource.LOCAL
        assert r.kind == MediaKind.AUDIO
        # local_path is absolute and points at the REAL generated file.
        assert Path(r.local_path).is_absolute()
        assert Path(r.local_path).is_file()
        # No fabricated durations: 0 means unknown, the player learns it.
        assert r.duration_s == 0
    # channel = parent folder (artist/album), "" at the root.
    assert by_id["Taller de Marta/sierra.wav"].channel == "Taller de Marta"
    assert by_id["caja.m4a"].channel == ""
    assert by_id["Taller de Marta/sierra.wav"].title == "sierra"
    # Decoys excluded.
    assert not any("notas" in r.id or "portada" in r.id for r in results)


def test_query_filters_case_insensitively_on_title_and_channel(tmp_path):
    lib = _library(tmp_path)

    assert [r.id for r in discover_library(lib, "SIERRA")] == [
        "Taller de Marta/sierra.wav"
    ]
    assert [r.id for r in discover_library(lib, "bricolaje")] == [
        "Bricolaje/lija.ogg",
        "Bricolaje/torno.flac",
    ]
    assert discover_library(lib, "no-existe-esta-cancion") == []


def test_honest_empty_library(tmp_path):
    empty = tmp_path / "empty-library"
    empty.mkdir()
    assert discover_library(empty) == []
    assert discover_library(empty, "algo") == []


def test_missing_library_dir_is_honest_empty(tmp_path):
    missing = tmp_path / "no-such-dir"
    assert discover_library(missing) == []
    assert discover_library(None) == []


def test_resolve_library_file_guards_the_library_boundary(tmp_path):
    lib = _library(tmp_path)
    inside = lib / "Taller de Marta" / "sierra.wav"

    resolved = resolve_library_file(lib, str(inside))
    assert resolved is not None
    assert resolved == inside.resolve()

    # Escaping the library is refused — the agent can only play library files.
    assert resolve_library_file(lib, str(tmp_path / "outside.mp3")) is None
    assert resolve_library_file(lib, "../outside.mp3") is None
    # Missing file inside the library is refused too.
    assert resolve_library_file(lib, str(lib / "no-such.mp3")) is None
    # Unset library dir refuses everything.
    assert resolve_library_file(None, str(inside)) is None
