"""Host facts the runtime needs to know before it promises anything."""

from __future__ import annotations

import subprocess
import sys

BATTERY_DISCHARGING = 1


def power_state() -> dict:
    """Report whether the machine is on battery.

    Measured on this laptop: on battery at 9% the speech engine ran 5 to 15
    times slower than on mains power (GPU at 442 MHz of 3090). A latency
    promise is not honest without this fact.
    """
    if sys.platform != "win32":
        return {"source": "unknown", "note": "power state is read on Windows"}
    script = (
        "$b = Get-CimInstance Win32_Battery | Select-Object -First 1; "
        "if ($b) { "
        "'{0}|{1}' -f $b.BatteryStatus, $b.EstimatedChargeRemaining "
        "} else { 'no-battery|n/a' }"
    )
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True,
            text=True,
            timeout=30,
        )
        status, _, charge = proc.stdout.strip().partition("|")
        discharging = status.strip() == str(BATTERY_DISCHARGING)
        return {
            "source": "battery" if discharging else "mains",
            "charge_percent": charge.strip(),
            "on_battery": discharging,
        }
    except Exception as exc:  # noqa: BLE001
        return {"source": "unknown", "error": str(exc)[:120]}
