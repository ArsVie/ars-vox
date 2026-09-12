﻿﻿$ErrorActionPreference = "Stop"
$root = "C:\dev\ars-vox-v2"
$py = Join-Path $root ".venv-win\Scripts\python.exe"
$nv = Join-Path $root ".venv-win\Lib\site-packages\nvidia"
$env:PATH = "$nv\cublas\bin;$nv\cudnn\bin;$nv\cuda_nvrtc\bin;$env:PATH"
Set-Location $root

$runArgs = @(
  "tools\w0_session.py",
  "--dry", "--auto",
  "--model", "C:\dev\models\whisper\large-v3-turbo",
  "--device", "cuda", "--compute-type", "float16",
  "--out", "results\w0-dry2"
)
& $py @runArgs 2>&1 | Out-File -Encoding utf8 "results\w0-dry-session.log"
Get-Content "results\w0-dry-session.log" -Tail 30
